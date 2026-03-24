import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { predictionMarketAbi } from '../../contracts/PredictionMarketAbi'

interface ResolvePanelProps {
  marketAddress: `0x${string}`
  question: string
  onResolved?: () => void
}

type PendingOutcome = 0 | 1 | null

export default function ResolvePanel({ marketAddress, question, onResolved }: ResolvePanelProps) {
  const [pendingOutcome, setPendingOutcome] = useState<PendingOutcome>(null)
  const [error, setError] = useState('')
  const [resolved, setResolved] = useState(false)
  const [resolvedOutcome, setResolvedOutcome] = useState<0 | 1 | null>(null)

  const { writeContractAsync, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const isBusy = isPending || isConfirming

  const handleClickOutcome = (outcome: 0 | 1) => {
    if (isBusy || resolved) return
    setError('')
    setPendingOutcome(outcome)
  }

  const handleConfirm = async () => {
    if (pendingOutcome === null || isBusy) return
    setError('')

    try {
      await writeContractAsync({
        address: marketAddress,
        abi: predictionMarketAbi,
        functionName: 'resolve',
        args: [BigInt(pendingOutcome)],
      })
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Transaction failed'
      setError(msg)
      setPendingOutcome(null)
    }
  }

  // Sync local resolved state once the tx confirms
  if (isConfirmed && !resolved && pendingOutcome !== null) {
    setResolved(true)
    setResolvedOutcome(pendingOutcome)
    setPendingOutcome(null)
    onResolved?.()
  }

  const outcomeLabel = (o: 0 | 1) => (o === 0 ? 'YES' : 'NO')

  if (resolved && resolvedOutcome !== null) {
    return (
      <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/[0.06] p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-yellow-500 mb-3">
          Resolution submitted
        </p>
        <p className="text-2xl font-bold text-yellow-200">
          Resolved:{' '}
          <span className={resolvedOutcome === 0 ? 'text-green-400' : 'text-red-400'}>
            {outcomeLabel(resolvedOutcome)}
          </span>
        </p>
        <p className="text-xs text-yellow-700 mt-2">
          The market outcome has been recorded on-chain.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-yellow-500 mb-1">
        Resolver controls
      </p>
      <p className="text-sm text-yellow-300/70 mb-4 leading-relaxed">
        You are the resolver for this market. Select the outcome to record on-chain.
      </p>

      {pendingOutcome === null ? (
        <div className="flex gap-3">
          <button
            onClick={() => handleClickOutcome(0)}
            disabled={isBusy}
            className="flex-1 rounded-lg border border-green-500/30 bg-green-500/[0.08] py-3 text-sm font-semibold text-green-300 hover:bg-green-500/15 hover:border-green-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve YES
          </button>
          <button
            onClick={() => handleClickOutcome(1)}
            disabled={isBusy}
            className="flex-1 rounded-lg border border-red-500/30 bg-red-500/[0.08] py-3 text-sm font-semibold text-red-300 hover:bg-red-500/15 hover:border-red-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve NO
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/[0.07] p-4">
          <p className="text-sm text-yellow-200 mb-1 font-semibold">Confirm resolution</p>
          <p className="text-xs text-yellow-400/70 mb-3 leading-relaxed">
            You are about to resolve this market as{' '}
            <span className={`font-bold ${pendingOutcome === 0 ? 'text-green-400' : 'text-red-400'}`}>
              {outcomeLabel(pendingOutcome)}
            </span>
            . This action is <span className="font-bold text-yellow-200">irreversible</span>.
          </p>
          <p className="text-xs text-yellow-600 mb-4 italic truncate">"{question}"</p>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isBusy}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                pendingOutcome === 0
                  ? 'bg-green-600 hover:bg-green-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {isBusy
                ? isConfirming
                  ? 'Confirming on-chain...'
                  : 'Submitting...'
                : `Confirm — Resolve ${outcomeLabel(pendingOutcome)}`}
            </button>
            <button
              onClick={() => { setPendingOutcome(null); setError('') }}
              disabled={isBusy}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-gray-400 hover:bg-white/[0.08] hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] p-3 mt-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <p className="text-xs text-yellow-700/60 mt-3">
        Resolution is permanent and cannot be reversed after submission.
      </p>
    </div>
  )
}
