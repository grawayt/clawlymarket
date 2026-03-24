import { useState, useEffect } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
// @ts-ignore — snarkjs ships without TS declarations
import * as snarkjs from 'snarkjs'
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { useContractAddresses } from '../hooks/useContracts'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'

// ---------------------------------------------------------------------------
// Static asset paths (served from frontend/public/zk/)
//
// Setup: run `cd circuits && npx ts-node scripts/demo-setup.ts` to deploy
// contracts and populate these files.
// ---------------------------------------------------------------------------
const WASM_PATH = import.meta.env.BASE_URL + 'zk/api-key-email.wasm'
const ZKEY_PATH = import.meta.env.BASE_URL + 'zk/membership.zkey'
const TREE_PATH = import.meta.env.BASE_URL + 'zk/demo-tree.json'

// ---------------------------------------------------------------------------
// Types for the demo tree state exported by demo-setup.ts
// ---------------------------------------------------------------------------
interface DemoTree {
  root: string
  testSecret: string
  proofs: {
    leafIndex: number
    pathElements: string[]
    pathIndices: number[]
  }[]
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

async function generateAndFormatProof(
  secret: string,
  tree: DemoTree
): Promise<{
  pA: [bigint, bigint]
  pB: [[bigint, bigint], [bigint, bigint]]
  pC: [bigint, bigint]
  nullifier: bigint
}> {
  const proof0 = tree.proofs[0]
  if (!proof0) throw new Error('No proof paths in tree state')

  // Build circuit inputs — all as decimal strings for snarkjs
  const input = {
    secret: BigInt(secret).toString(),
    pathElements: proof0.pathElements,
    pathIndices: proof0.pathIndices.map(String),
    root: tree.root,
  }

  // Generate the Groth16 proof entirely in-browser
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  )

  // Format for Solidity using snarkjs's built-in formatter.
  // This handles the G2 coordinate swap for the EVM pairing precompile.
  const rawCalldata: string = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  )

  // rawCalldata looks like: ["0x...","0x..."],[[...],[...]],["0x...","0x..."],["0x...","0x..."]
  // Wrap in [] to make valid JSON, then parse.
  const [pA, pB, pC, pubSignals]: [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    string[]
  ] = JSON.parse(`[${rawCalldata}]`)

  // Public signals order from snarkjs: outputs first, then inputs.
  // Circuit: output nullifier, public input root → [nullifier, root]
  const nullifier = BigInt(pubSignals[0])

  return {
    pA: [BigInt(pA[0]), BigInt(pA[1])],
    pB: [
      [BigInt(pB[0][0]), BigInt(pB[0][1])],
      [BigInt(pB[1][0]), BigInt(pB[1][1])],
    ],
    pC: [BigInt(pC[0]), BigInt(pC[1])],
    nullifier,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Status = 'idle' | 'loading-tree' | 'generating' | 'submitting' | 'confirming' | 'success' | 'error'

export default function Verify() {
  const { isConnected } = useAccount()
  const addrs = useContractAddresses()
  const { isVerified, refetch: refetchVerified } = useIsVerified()
  const { refetch: refetchBalance } = useClawliaBalance()

  const [secretInput, setSecretInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [tree, setTree] = useState<DemoTree | null>(null)
  const [treeError, setTreeError] = useState('')

  const { writeContractAsync } = useWriteContract()

  // Load tree state on mount
  useEffect(() => {
    fetch(TREE_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((data: DemoTree) => setTree(data))
      .catch(() =>
        setTreeError(
          'Tree state not found. Run: cd circuits && npx ts-node scripts/demo-setup.ts'
        )
      )
  }, [])

  const handleVerify = async () => {
    if (!secretInput.trim() || !addrs || !tree) return
    if (status === 'generating' || status === 'submitting' || status === 'confirming') return

    setErrorMsg('')

    try {
      // Validate input is a number
      try {
        BigInt(secretInput.trim())
      } catch {
        throw new Error('Secret must be a number (e.g. 1337)')
      }

      // Step 1: Generate ZK proof in-browser
      setStatus('generating')

      let proofData: Awaited<ReturnType<typeof generateAndFormatProof>>
      try {
        proofData = await generateAndFormatProof(secretInput.trim(), tree)
      } catch (proofErr: any) {
        if (proofErr?.message?.includes('Assert Failed')) {
          throw new Error(
            'Invalid secret — your input does not match any approved entry in the Merkle tree.'
          )
        }
        if (
          proofErr?.message?.includes('fetch') ||
          proofErr?.message?.includes('404')
        ) {
          throw new Error(
            'Circuit files not found in public/zk/. Run the demo setup script first.'
          )
        }
        throw proofErr
      }

      // Step 2: Submit proof on-chain
      setStatus('submitting')

      await writeContractAsync({
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'register',
        args: [proofData.pA, proofData.pB, proofData.pC, proofData.nullifier],
      })

      setStatus('confirming')

      // wagmi writeContractAsync resolves when the tx is submitted.
      // The tx confirms instantly on Anvil, so we can refetch immediately.
      // On real chains, you'd use useWaitForTransactionReceipt.

      setStatus('success')
      refetchVerified()
      refetchBalance()
    } catch (err: any) {
      setStatus('error')
      const msg: string = err?.shortMessage || err?.message || 'Unknown error'
      if (msg.includes('AlreadyRegistered')) {
        setErrorMsg('This wallet is already registered.')
      } else if (msg.includes('NullifierAlreadyUsed')) {
        setErrorMsg('This credential has already been used to register another wallet.')
      } else if (msg.includes('InvalidProof')) {
        setErrorMsg(
          'Proof rejected on-chain. The Merkle root may be stale — re-run the setup script.'
        )
      } else {
        setErrorMsg(msg)
      }
    }
  }

  // ---- Disconnected ----
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Verify Your Identity</h1>
        <p className="text-gray-400 max-w-lg text-center">
          Connect your wallet to begin the verification process.
        </p>
        <ConnectButton />
      </div>
    )
  }

  // ---- Already verified ----
  if (isVerified) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Verify Your Identity</h1>
        <div className="rounded-lg border border-green-800 bg-green-900/20 p-6 text-center max-w-md">
          <p className="text-green-400 text-lg font-medium">Already Verified</p>
          <p className="text-gray-400 text-sm mt-2">
            Your wallet is verified. You have 1,000 CLAW and can create and
            trade on markets.
          </p>
        </div>
      </div>
    )
  }

  // ---- Main form ----
  const isWorking =
    status === 'generating' || status === 'submitting' || status === 'confirming'

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Verify Your Identity</h1>
      <p className="text-gray-400 mb-8">
        Prove you have an approved credential by generating a zero-knowledge
        proof. Your secret never leaves your browser.
      </p>

      {/* Tree state error */}
      {treeError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 mb-6">
          <p className="text-red-400 text-sm font-medium">Setup required</p>
          <p className="text-red-300 text-sm mt-1 font-mono text-xs">
            {treeError}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Secret input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Enter your secret
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-300 font-mono focus:border-red-500 focus:outline-none disabled:opacity-50"
            placeholder={
              tree ? `Hint: try ${tree.testSecret}` : 'Loading tree state...'
            }
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            disabled={isWorking || status === 'success' || !tree}
          />
          <p className="mt-1 text-xs text-gray-500">
            The secret is processed entirely in your browser. Nothing is sent to
            any server.
          </p>
        </div>

        {/* How it works */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            How it works:
          </h3>
          <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
            <li>Your secret is used as a private input to a ZK circuit</li>
            <li>
              A Groth16 proof is generated in your browser (~1-3 seconds)
            </li>
            <li>
              Only the proof is sent on-chain — your secret stays private
            </li>
            <li>The smart contract verifies the proof and mints 1,000 CLAW</li>
          </ol>
        </div>

        {/* Generating spinner */}
        {status === 'generating' && (
          <div className="flex items-center gap-3 rounded-lg border border-yellow-800 bg-yellow-900/20 p-4">
            <svg
              className="animate-spin h-5 w-5 text-yellow-400 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <div>
              <p className="text-yellow-300 text-sm font-medium">
                Clawing through cryptographic constraints...
              </p>
              <p className="text-yellow-600 text-xs mt-0.5">
                Groth16 proof generation runs entirely in your browser.
              </p>
            </div>
          </div>
        )}

        {/* Submitting spinner */}
        {(status === 'submitting' || status === 'confirming') && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-800 bg-blue-900/20 p-4">
            <svg
              className="animate-spin h-5 w-5 text-blue-400 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <div>
              <p className="text-blue-300 text-sm font-medium">
                {status === 'submitting'
                  ? 'Snapping proof onto the chain...'
                  : 'Waiting for confirmation...'}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && errorMsg && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-4">
            <p className="text-red-400 text-sm font-medium mb-1">
              Verification failed
            </p>
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="rounded-lg border border-green-800 bg-green-900/20 p-4">
            <p className="text-green-400 text-sm font-medium">
              Verification complete!
            </p>
            <p className="text-green-600 text-xs mt-1">
              Your wallet is now registered and 1,000 CLAW have been minted to
              your address.
            </p>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={handleVerify}
          disabled={
            !secretInput.trim() ||
            isWorking ||
            status === 'success' ||
            !tree
          }
          className="w-full rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'idle' || status === 'loading-tree'
            ? 'Generate Proof & Verify'
            : status === 'generating'
              ? 'Generating ZK Proof...'
              : status === 'submitting' || status === 'confirming'
                ? 'Submitting...'
                : status === 'success'
                  ? 'Verified!'
                  : 'Retry'}
        </button>
      </div>
    </div>
  )
}
