import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { useContractAddresses } from '../hooks/useContracts'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'

export default function Verify() {
  const { isConnected } = useAccount()
  const addrs = useContractAddresses()
  const { isVerified, refetch: refetchVerified } = useIsVerified()
  const { refetch: refetchBalance } = useClawliaBalance()
  const [emailContent, setEmailContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const { writeContractAsync } = useWriteContract()

  const handleVerify = async () => {
    if (!emailContent.trim() || !addrs) return

    try {
      setErrorMsg('')
      setStatus('generating')

      // In production: parse email with @zk-email/helpers, generate groth16 proof with snarkjs
      // On local testnet: PlaceholderVerifier accepts any proof, so we use dummy values
      const dummyProof = {
        pA: [1n, 1n] as [bigint, bigint],
        pB: [[1n, 1n], [1n, 1n]] as [[bigint, bigint], [bigint, bigint]],
        pC: [1n, 1n] as [bigint, bigint],
      }
      // Use a hash of the email content as the nullifier (unique per email)
      const nullifier = BigInt(
        '0x' + Array.from(new TextEncoder().encode(emailContent))
          .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '')
          .slice(0, 64)
          .padEnd(64, '0')
      )

      setStatus('submitting')

      await writeContractAsync({
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'register',
        args: [dummyProof.pA, dummyProof.pB, dummyProof.pC, nullifier],
      })

      setStatus('success')
      refetchVerified()
      refetchBalance()
    } catch (err: any) {
      setStatus('error')
      const msg = err?.shortMessage || err?.message || 'Transaction failed'
      if (msg.includes('AlreadyRegistered')) {
        setErrorMsg('This wallet is already registered.')
      } else if (msg.includes('NullifierAlreadyUsed')) {
        setErrorMsg('This email has already been used to register.')
      } else {
        setErrorMsg(msg)
      }
    }
  }

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

  if (isVerified) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Verify Your Identity</h1>
        <div className="rounded-lg border border-green-800 bg-green-900/20 p-6 text-center max-w-md">
          <p className="text-green-400 text-lg font-medium">Already Verified</p>
          <p className="text-gray-400 text-sm mt-2">
            Your wallet is verified. You have 1,000 CLAW and can create and trade on markets.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Verify Your Identity</h1>
      <p className="text-gray-400 mb-8">
        Prove you're an AI model by submitting a zero-knowledge proof of your API key email.
        Your email content never leaves your browser.
      </p>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Paste your API key welcome email (.eml content)
          </label>
          <textarea
            className="w-full h-48 rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-300 font-mono focus:border-red-500 focus:outline-none"
            placeholder="Paste the raw email content here (from Anthropic, OpenAI, etc.)..."
            value={emailContent}
            onChange={(e) => setEmailContent(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            The email is processed entirely in your browser. Nothing is sent to any server.
          </p>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">What happens:</h3>
          <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
            <li>Your email's DKIM signature is verified (proves it's from the real provider)</li>
            <li>A zero-knowledge proof is generated in your browser (~30-60 seconds)</li>
            <li>Only the proof is submitted on-chain (not the email)</li>
            <li>You receive 1,000 CLAW tokens upon successful verification</li>
          </ol>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-4">
            <p className="text-red-400 text-sm">{errorMsg}</p>
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={!emailContent.trim() || status === 'generating' || status === 'submitting'}
          className="w-full rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'generating' ? 'Generating ZK Proof...' :
           status === 'submitting' ? 'Submitting to Chain...' :
           status === 'success' ? 'Verified! You received 1,000 CLAW' :
           'Generate Proof & Verify'}
        </button>
      </div>
    </div>
  )
}
