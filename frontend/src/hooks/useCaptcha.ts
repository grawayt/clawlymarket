import { useState, useCallback } from 'react'
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { captchaGateAbi } from '../contracts/CaptchaGateAbi'
import { useContractAddresses } from './useContracts'

/**
 * Decode a packed problem uint256 and compute the answer.
 *
 * Packing layout (from CaptchaGate.sol):
 *   a = bits 0–13   → packed % 10000
 *   b = bits 14–27  → (packed >> 14) % 10000
 *   c = bits 28–41  → (packed >> 28) % 10000
 *   p = bits 42–55  → (packed >> 42) % 9973 + 7
 *
 * Answer = (a * b + c) % p
 */
function solveProblem(packed: bigint): bigint {
  const a = packed % 10000n
  const b = (packed >> 14n) % 10000n
  const c = (packed >> 28n) % 10000n
  const p = (packed >> 42n) % 9973n + 7n
  return (a * b + c) % p
}

export function useCaptchaSession() {
  const { address } = useAccount()
  const addrs = useContractAddresses()
  const publicClient = usePublicClient()

  const [solving, setSolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read hasValidSession and sessionExpiry in one shot
  const { data, refetch } = useReadContracts({
    contracts: address && addrs?.captchaGate ? [
      {
        address: addrs.captchaGate,
        abi: captchaGateAbi,
        functionName: 'hasValidSession',
        args: [address],
      },
      {
        address: addrs.captchaGate,
        abi: captchaGateAbi,
        functionName: 'sessionExpiry',
        args: [address],
      },
    ] : [],
    query: { enabled: !!address && !!addrs?.captchaGate },
  })

  const hasSession = (data?.[0]?.result as boolean | undefined) ?? false
  const sessionExpiry = Number((data?.[1]?.result as bigint | undefined) ?? 0n)

  // Step 1: requestChallenge
  const {
    writeContractAsync: writeRequest,
    data: requestHash,
  } = useWriteContract()

  const { isLoading: waitingRequest } = useWaitForTransactionReceipt({ hash: requestHash })

  // Step 2: solveChallenge
  const {
    writeContractAsync: writeSolve,
    data: solveHash,
  } = useWriteContract()

  const { isLoading: waitingSolve } = useWaitForTransactionReceipt({ hash: solveHash })

  const ensureSession = useCallback(async () => {
    if (!address || !addrs?.captchaGate || !publicClient) return
    if (hasSession) return

    setSolving(true)
    setError(null)

    try {
      // 1. Request a challenge — this records the current block for the user
      const reqHash = await writeRequest({
        address: addrs.captchaGate,
        abi: captchaGateAbi,
        functionName: 'requestChallenge',
      })

      // 2. Wait for the requestChallenge tx to be confirmed on-chain
      await publicClient.waitForTransactionReceipt({ hash: reqHash })

      // 3. Read the 5 problems from the contract
      const result = await publicClient.readContract({
        address: addrs.captchaGate,
        abi: captchaGateAbi,
        functionName: 'getChallenge',
        args: [address],
      }) as [readonly [bigint, bigint, bigint, bigint, bigint], bigint]

      const [problems] = result

      // 4. Solve all 5 problems locally (pure math, no network)
      const answers: [bigint, bigint, bigint, bigint, bigint] = [
        solveProblem(problems[0]),
        solveProblem(problems[1]),
        solveProblem(problems[2]),
        solveProblem(problems[3]),
        solveProblem(problems[4]),
      ]

      // 5. Submit answers on-chain
      const solveHashResult = await writeSolve({
        address: addrs.captchaGate,
        abi: captchaGateAbi,
        functionName: 'solveChallenge',
        args: [answers],
      })

      // 6. Wait for the solveChallenge tx to confirm
      await publicClient.waitForTransactionReceipt({ hash: solveHashResult })

      // 7. Refresh session status
      await refetch()
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Challenge failed'
      setError(msg)
    } finally {
      setSolving(false)
    }
  }, [address, addrs, publicClient, hasSession, writeRequest, writeSolve, refetch])

  return {
    hasSession,
    sessionExpiry,
    solving: solving || waitingRequest || waitingSolve,
    error,
    ensureSession,
    refetchSession: refetch,
  }
}
