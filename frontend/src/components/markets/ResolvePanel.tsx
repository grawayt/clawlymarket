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
      <div className="rounded-lg border border-amber-700 bg-amber-900/20 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-400 mb-3">
          Resolution submitted
        </p>
        <p className="text-2xl font-bold text-amber-200">
          Resolved:{' '}
          <span className={resolvedOutcome === 0 ? 'text-green-400' : 'text-red-400'}>
            {outcomeLabel(resolvedOutcome)}
          </span>
        </p>
        <p className="text-xs text-amber-500 mt-2">
          The market outcome has been recorded on-chain.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-700 bg-amber-900/10 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400 mb-1">
        Resolver controls
      </p>
      <p className="text-sm text-amber-300 mb-4">
        You are the resolver for this market. Select the outcome to record on-chain.
      </p>

      {/* Outcome buttons — show confirmation inline */}
      {pendingOutcome === null ? (
        <div className="flex gap-3">
          <button
            onClick={() => handleClickOutcome(0)}
            disabled={isBusy}
            className="flex-1 rounded border border-green-700 bg-green-900/30 py-3 text-sm font-semibold text-green-300
              hover:bg-green-800/50 hover:border-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve YES
          </button>
          <button
            onClick={() => handleClickOutcome(1)}
            disabled={isBusy}
            className="flex-1 rounded border border-red-700 bg-red-900/30 py-3 text-sm font-semibold text-red-300
              hover:bg-red-800/50 hover:border-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve NO
          </button>
        </div>
      ) : (
        /* Confirmation dialog */
        <div className="rounded border border-amber-600 bg-amber-900/30 p-4">
          <p className="text-sm text-amber-200 mb-1 font-medium">Confirm resolution</p>
          <p className="text-xs text-amber-400 mb-3 leading-relaxed">
            You are about to resolve this market as{' '}
            <span
              className={`font-bold ${pendingOutcome === 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {outcomeLabel(pendingOutcome)}
            </span>
            . This action is{' '}
            <span className="font-bold text-amber-200">irreversible</span>.
          </p>
          <p className="text-xs text-amber-500 mb-4 italic truncate">"{question}"</p>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isBusy}
              className={`flex-1 rounded py-2 text-sm font-semibold text-white transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
                ${pendingOutcome === 0
                  ? 'bg-green-700 hover:bg-green-600'
                  : 'bg-red-700 hover:bg-red-600'
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
              className="rounded border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-400
                hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-900/20 p-2 mt-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <p className="text-xs text-amber-700 mt-3">
        Resolution is permanent and cannot be reversed after submission.
      </p>
    </div>
  )
}
