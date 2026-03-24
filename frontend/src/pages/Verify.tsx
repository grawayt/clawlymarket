import { useState, useRef, useCallback } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
// @ts-ignore — snarkjs ships without TS declarations
import * as snarkjs from 'snarkjs'
// @ts-ignore — circomlibjs ships without TS declarations
import { buildPoseidon } from 'circomlibjs'
import { generateEmailVerifierInputs } from '@zk-email/helpers'
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { useContractAddresses } from '../hooks/useContracts'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'

// ---------------------------------------------------------------------------
// Static asset paths (served from frontend/public/zk/)
// ---------------------------------------------------------------------------
const BASE_URL = import.meta.env.BASE_URL
const WASM_PATH = `${BASE_URL}zk/anthropic-email.wasm`
const ZKEY_PATH = `${BASE_URL}zk/anthropic-email.zkey`

const ANTHROPIC_DKIM_DOMAIN = 'anthropic.com'

// ---------------------------------------------------------------------------
// Pubkey hash computation
//
// ZK Email represents the RSA public key as 17 chunks of 121-bit values.
// We pack them into 9 chunks (pairs of 121-bit values, last one padded)
// then Poseidon-hash the result.
// ---------------------------------------------------------------------------
async function computePubkeyHash(pubkeyChunks: bigint[]): Promise<bigint> {
  const poseidon = await buildPoseidon()

  // Pack 17 × 121-bit chunks into 9 × 242-bit chunks
  const packed: bigint[] = []
  for (let i = 0; i < 17; i += 2) {
    const lo = pubkeyChunks[i] ?? 0n
    const hi = pubkeyChunks[i + 1] ?? 0n
    packed.push(lo + (hi << 121n))
  }

  // Poseidon hash the 9 packed chunks
  const hashResult = poseidon(packed)
  return poseidon.F.toObject(hashResult) as bigint
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

async function generateAndFormatProof(emlBytes: Uint8Array): Promise<{
  pA: [bigint, bigint]
  pB: [[bigint, bigint], [bigint, bigint]]
  pC: [bigint, bigint]
  nullifier: bigint
  pubkeyHash: bigint
}> {
  // Parse the email and generate circuit inputs
  const inputs = await generateEmailVerifierInputs(emlBytes, {
    maxHeadersLength: 1024,
    maxBodyLength: 64,
    ignoreBodyHashCheck: true,
  })

  // Compute pubkeyHash from the RSA modulus chunks
  const pubkeyChunks = (inputs.pubkey as string[]).map((c) => BigInt(c))
  const pubkeyHash = await computePubkeyHash(pubkeyChunks)

  // Generate the Groth16 proof entirely in-browser (~15 seconds for 700K constraints)
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    WASM_PATH,
    ZKEY_PATH
  )

  // Format for Solidity — handles G2 coordinate swap for EVM pairing precompile
  const rawCalldata: string = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  )

  // rawCalldata: ["0x...","0x..."],[[...],[...]],["0x...","0x..."],["0x...","0x..."]
  const [pA, pB, pC]: [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
  ] = JSON.parse(`[${rawCalldata}]`)

  // Public signals: nullifier is index 0, pubkeyHash is index 1
  const nullifier = BigInt(publicSignals[0])

  return {
    pA: [BigInt(pA[0]), BigInt(pA[1])],
    pB: [
      [BigInt(pB[0][0]), BigInt(pB[0][1])],
      [BigInt(pB[1][0]), BigInt(pB[1][1])],
    ],
    pC: [BigInt(pC[0]), BigInt(pC[1])],
    nullifier,
    pubkeyHash,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Status = 'idle' | 'parsing' | 'generating' | 'submitting' | 'success' | 'error'

// Simple spinner SVG
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-5 w-5 shrink-0 ${className ?? ''}`}
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
  )
}

export default function Verify() {
  const { isConnected } = useAccount()
  const addrs = useContractAddresses()
  const { isVerified, refetch: refetchVerified } = useIsVerified()
  const { refetch: refetchBalance } = useClawliaBalance()

  const [emlFile, setEmlFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { writeContractAsync } = useWriteContract()

  // ---- Drag-and-drop handlers ----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setEmlFile(file)
      setStatus('idle')
      setErrorMsg('')
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setEmlFile(file)
      setStatus('idle')
      setErrorMsg('')
    }
  }

  const handleVerify = async () => {
    if (!emlFile || !addrs) return
    if (status === 'parsing' || status === 'generating' || status === 'submitting') return

    setErrorMsg('')

    try {
      // Step 1: Read and validate the .eml file
      setStatus('parsing')

      const arrayBuffer = await emlFile.arrayBuffer()
      const emlBytes = new Uint8Array(arrayBuffer)

      // Quick sanity-check: look for DKIM-Signature header referencing anthropic.com
      const emlText = new TextDecoder().decode(emlBytes)

      if (!emlText.includes('DKIM-Signature') && !emlText.includes('dkim-signature')) {
        throw new Error('DKIM verification failed')
      }

      const dkimMatch = emlText.match(/d=([^\s;]+)/i)
      const dkimDomain = dkimMatch?.[1]?.toLowerCase().replace(/['"]/g, '') ?? ''
      if (!dkimDomain.endsWith(ANTHROPIC_DKIM_DOMAIN)) {
        throw new Error('This doesn\'t appear to be an Anthropic email')
      }

      // Step 2: Parse email + generate ZK proof
      setStatus('generating')

      let proofData: Awaited<ReturnType<typeof generateAndFormatProof>>
      try {
        proofData = await generateAndFormatProof(emlBytes)
      } catch (proofErr: any) {
        const msg: string = proofErr?.message ?? ''
        if (msg.includes('Assert Failed') || msg.includes('assert')) {
          throw new Error('DKIM verification failed')
        }
        if (msg.includes('fetch') || msg.includes('404') || msg.includes('NetworkError')) {
          throw new Error(
            'Circuit files not found. Ensure anthropic-email.wasm and anthropic-email.zkey are in public/zk/.'
          )
        }
        if (msg.includes('Invalid email') || msg.includes('parse')) {
          throw new Error('Invalid email format')
        }
        throw proofErr
      }

      // Step 3: Submit proof on-chain
      setStatus('submitting')

      await writeContractAsync({
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'register',
        args: [
          proofData.pA,
          proofData.pB,
          proofData.pC,
          proofData.nullifier,
          proofData.pubkeyHash,
        ],
        gas: 500_000n,
      })

      setStatus('success')
      refetchVerified()
      refetchBalance()
    } catch (err: any) {
      setStatus('error')
      const msg: string = err?.shortMessage || err?.message || 'Unknown error'

      if (msg.includes('Invalid email format')) {
        setErrorMsg('Invalid email format — please upload a valid .eml file.')
      } else if (msg.includes('doesn\'t appear to be an Anthropic email')) {
        setErrorMsg('This doesn\'t appear to be an Anthropic email. The DKIM domain must be anthropic.com.')
      } else if (msg.includes('DKIM verification failed')) {
        setErrorMsg('DKIM verification failed — the email signature is invalid or missing.')
      } else if (msg.includes('AlreadyRegistered')) {
        setErrorMsg('This wallet is already registered.')
      } else if (msg.includes('NullifierAlreadyUsed')) {
        setErrorMsg('This email has already been used to register another wallet.')
      } else if (msg.includes('InvalidProof')) {
        setErrorMsg('Proof rejected on-chain. The circuit verifier may be out of sync.')
      } else if (msg.includes('Circuit files not found')) {
        setErrorMsg(msg)
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
  const isWorking = status === 'parsing' || status === 'generating' || status === 'submitting'

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Verify Your Identity</h1>
      <p className="text-gray-400 mb-8">
        Prove you have an Anthropic email by generating a zero-knowledge proof
        of its DKIM signature. Your email never leaves your browser.
      </p>

      <div className="space-y-6">
        {/* File upload zone */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Upload your Anthropic API key email
          </label>

          {/* Drag-and-drop area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isWorking && fileInputRef.current?.click()}
            className={[
              'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
              isDragging
                ? 'border-red-500 bg-red-900/10'
                : 'border-gray-700 bg-gray-900 hover:border-gray-600 hover:bg-gray-800/50',
              isWorking ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
          >
            {/* Upload icon */}
            <svg
              className="h-10 w-10 text-gray-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5v-9m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-1.5A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
              />
            </svg>

            {emlFile ? (
              <div>
                <p className="text-sm font-medium text-red-400">{emlFile.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click or drop to replace
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400">
                  Drop your Anthropic email here or{' '}
                  <span className="text-red-400 underline underline-offset-2">
                    click to browse
                  </span>
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Accepts .eml and .txt files
                </p>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,.txt"
            className="hidden"
            onChange={handleFileChange}
            disabled={isWorking}
          />

          <p className="mt-1 text-xs text-gray-500">
            Your email is processed entirely in your browser. Nothing is sent to
            any server.
          </p>
        </div>

        {/* How it works */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            How it works:
          </h3>
          <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
            <li>Your email's DKIM signature is verified (proves it's from Anthropic)</li>
            <li>A zero-knowledge proof is generated in your browser (~15 seconds)</li>
            <li>Only the proof goes on-chain — your email stays private</li>
            <li>You receive 1,000 CLAW upon verification</li>
          </ol>
        </div>

        {/* Parsing spinner */}
        {status === 'parsing' && (
          <div className="flex items-center gap-3 rounded-lg border border-yellow-800 bg-yellow-900/20 p-4">
            <Spinner className="text-yellow-400" />
            <div>
              <p className="text-yellow-300 text-sm font-medium">
                Parsing email headers...
              </p>
              <p className="text-yellow-600 text-xs mt-0.5">
                Reading DKIM signature and preparing circuit inputs.
              </p>
            </div>
          </div>
        )}

        {/* Generating spinner */}
        {status === 'generating' && (
          <div className="flex items-center gap-3 rounded-lg border border-orange-800 bg-orange-900/20 p-4">
            <Spinner className="text-orange-400" />
            <div>
              <p className="text-orange-300 text-sm font-medium">
                Clawing through cryptographic constraints...
              </p>
              <p className="text-orange-600 text-xs mt-0.5">
                Groth16 proof generation (700K constraints) runs entirely in your browser — this takes ~15 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Submitting spinner */}
        {status === 'submitting' && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-800 bg-blue-900/20 p-4">
            <Spinner className="text-blue-400" />
            <div>
              <p className="text-blue-300 text-sm font-medium">
                Snapping proof onto the chain...
              </p>
              <p className="text-blue-600 text-xs mt-0.5">
                Check your wallet for a transaction to confirm.
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
          disabled={!emlFile || isWorking || status === 'success'}
          className="w-full rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'idle' || status === 'error'
            ? 'Generate Proof & Verify'
            : status === 'parsing'
              ? 'Parsing Email...'
              : status === 'generating'
                ? 'Generating ZK Proof...'
                : status === 'submitting'
                  ? 'Submitting...'
                  : 'Verified!'}
        </button>
      </div>
    </div>
  )
}
