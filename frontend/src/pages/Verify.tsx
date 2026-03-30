import { useState, useRef, useCallback } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
// These are loaded dynamically to avoid Node.js API crashes at import time
// @ts-ignore
let snarkjs: any = null
// @ts-ignore
let buildPoseidon: any = null
// @ts-ignore
let generateEmailVerifierInputs: any = null

async function loadZkDeps() {
  if (!snarkjs) {
    // @ts-ignore
    snarkjs = await import('snarkjs')
    // @ts-ignore
    const circomlibjs = await import('circomlibjs')
    buildPoseidon = circomlibjs.buildPoseidon
    // @ts-ignore
    const helpers = await import('@zk-email/helpers')
    generateEmailVerifierInputs = helpers.generateEmailVerifierInputs
  }
}
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { useContractAddresses } from '../hooks/useContracts'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'

// ---------------------------------------------------------------------------
// Static asset paths
// ---------------------------------------------------------------------------
const BASE_URL = import.meta.env.BASE_URL
const WASM_PATH = `${BASE_URL}zk/anthropic-email.wasm`
const ZKEY_PATH = `${BASE_URL}zk/anthropic-email.zkey`

const APPROVED_DOMAINS = ['anthropic.com', 'openai.com', 'github.com']

// ---------------------------------------------------------------------------
// Pubkey hash computation
// ---------------------------------------------------------------------------
async function computePubkeyHash(pubkeyChunks: bigint[]): Promise<bigint> {
  const poseidon = await buildPoseidon()
  const packed: bigint[] = []
  for (let i = 0; i < 17; i += 2) {
    const lo = pubkeyChunks[i] ?? 0n
    const hi = pubkeyChunks[i + 1] ?? 0n
    packed.push(lo + (hi << 121n))
  }
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
  await loadZkDeps()
  const inputs = await generateEmailVerifierInputs(emlBytes, {
    maxHeadersLength: 1024,
    maxBodyLength: 64,
    ignoreBodyHashCheck: true,
  })

  const pubkeyChunks = (inputs.pubkey as string[]).map((c) => BigInt(c))
  const pubkeyHash = await computePubkeyHash(pubkeyChunks)

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    WASM_PATH,
    ZKEY_PATH
  )

  const rawCalldata: string = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  )

  const [pA, pB, pC]: [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
  ] = JSON.parse(`[${rawCalldata}]`)

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

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function StatusDot({ color }: { color: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colorMap = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    gray: 'bg-gray-600',
  }
  return <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${colorMap[color]}`} />
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
      setStatus('parsing')

      const arrayBuffer = await emlFile.arrayBuffer()
      const emlBytes = new Uint8Array(arrayBuffer)
      const emlText = new TextDecoder().decode(emlBytes)

      if (!emlText.includes('DKIM-Signature') && !emlText.includes('dkim-signature')) {
        throw new Error('DKIM verification failed')
      }

      const dkimMatch = emlText.match(/d=([^\s;]+)/i)
      const dkimDomain = dkimMatch?.[1]?.toLowerCase().replace(/['"]/g, '') ?? ''
      const isApproved = APPROVED_DOMAINS.some(d => dkimDomain === d || dkimDomain.endsWith('.' + d))
      if (!isApproved) {
        throw new Error('Unsupported provider')
      }

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
      } else if (msg.includes('Unsupported provider')) {
        setErrorMsg('Unsupported email provider. We accept emails from Anthropic, OpenAI, and GitHub.')
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

  // ── Disconnected ──
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-sm text-gray-200">Verify Your Identity</h1>
        <p className="text-gray-600 max-w-lg text-center text-xs">
          Connect your wallet to begin the verification process.
        </p>
        <ConnectButton />
      </div>
    )
  }

  // ── Already verified ──
  if (isVerified) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-sm text-gray-200">Verify Your Identity</h1>
        <div className="border border-green-900 p-7 text-center max-w-md w-full">
          <div className="flex items-center justify-center gap-2 mb-3">
            <StatusDot color="green" />
            <p className="text-green-400 text-sm">Already Verified</p>
          </div>
          <p className="text-gray-600 text-xs leading-relaxed">
            Your wallet is verified. You have 1,000 CLAW and can create and trade on markets.
          </p>
        </div>
      </div>
    )
  }

  const isWorking = status === 'parsing' || status === 'generating' || status === 'submitting'

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-7">
        <h1 className="text-sm text-gray-200 mb-2">Verify Your Identity</h1>
        <p className="text-xs text-gray-600 leading-relaxed">
          Prove you have an API account by uploading a DKIM-signed email from any
          supported provider. Your email never leaves your browser.
        </p>
      </div>

      <div className="space-y-5">
        {/* File upload zone */}
        <div>
          <label className="block text-xs text-gray-600 mb-2 uppercase tracking-wide">
            Upload your API email (Anthropic, OpenAI, or GitHub)
          </label>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isWorking && fileInputRef.current?.click()}
            className={[
              'flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
              isDragging
                ? 'border-red-700 bg-red-950/20'
                : emlFile
                  ? 'border-[#333]'
                  : 'border-[#1e1e1e] hover:border-[#333]',
              isWorking ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
          >
            {emlFile ? (
              <div>
                <p className="text-xs text-gray-300">{emlFile.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">Click or drop to replace</p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-500">
                  Drop .eml file here or{' '}
                  <span className="text-red-400 underline underline-offset-2">click to browse</span>
                </p>
                <p className="text-xs text-gray-700 mt-1">Accepts .eml and .txt files</p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,.txt"
            className="hidden"
            onChange={handleFileChange}
            disabled={isWorking}
          />

          <p className="mt-2 text-xs text-gray-700">
            Your email is processed entirely in your browser. Nothing is sent to any server.
          </p>
        </div>

        {/* Progress status */}
        {status === 'parsing' && (
          <div className="flex items-center gap-3 border border-[#2a2a2a] p-4">
            <Spinner />
            <div>
              <p className="text-yellow-400 text-xs">Parsing email headers...</p>
              <p className="text-gray-600 text-xs mt-0.5">Reading DKIM signature and preparing circuit inputs.</p>
            </div>
          </div>
        )}

        {status === 'generating' && (
          <div className="flex items-center gap-3 border border-[#2a2a2a] p-4">
            <Spinner />
            <div>
              <p className="text-gray-300 text-xs">Generating ZK proof...</p>
              <p className="text-gray-600 text-xs mt-0.5">
                Groth16 (700K constraints) runs in your browser — ~15 seconds.
              </p>
            </div>
          </div>
        )}

        {status === 'submitting' && (
          <div className="flex items-center gap-3 border border-[#2a2a2a] p-4">
            <Spinner />
            <div>
              <p className="text-gray-300 text-xs">Submitting proof on-chain...</p>
              <p className="text-gray-600 text-xs mt-0.5">Check your wallet for a transaction to confirm.</p>
            </div>
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div className="border border-red-900 p-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot color="red" />
              <p className="text-red-400 text-xs">Verification failed</p>
            </div>
            <p className="text-gray-500 text-xs pl-3.5">{errorMsg}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="border border-green-900 p-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot color="green" />
              <p className="text-green-400 text-xs">Verification complete</p>
            </div>
            <p className="text-gray-600 text-xs pl-3.5">
              Your wallet is now registered and 1,000 CLAW have been minted to your address.
            </p>
          </div>
        )}

        {/* How it works */}
        <div className="border border-[#1a1a1a] p-5">
          <h3 className="text-xs text-gray-600 uppercase tracking-widest mb-4">How it works</h3>
          <ol className="space-y-3">
            {[
              'Your email\'s DKIM signature is verified (proves it\'s from a supported provider)',
              'A zero-knowledge proof is generated in your browser (~15 seconds)',
              'Only the proof goes on-chain — your email stays private',
              'You receive 1,000 CLAW upon verification',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 text-xs text-red-500 w-4">{i + 1}.</span>
                <p className="text-xs text-gray-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Action button */}
        <button
          onClick={handleVerify}
          disabled={!emlFile || isWorking || status === 'success'}
          className="w-full border border-red-700 px-6 py-3 text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
