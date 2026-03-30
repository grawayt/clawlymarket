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
      <div className="border border-yellow-900 p-5">
        <p className="text-xs text-yellow-600 uppercase tracking-widest mb-3">
          Resolution submitted
        </p>
        <p className="text-sm text-gray-300">
          Resolved:{' '}
          <span className={resolvedOutcome === 0 ? 'text-green-400' : 'text-red-400'}>
            {outcomeLabel(resolvedOutcome)}
          </span>
        </p>
        <p className="text-xs text-gray-700 mt-2">
          The market outcome has been recorded on-chain.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-yellow-900 p-5">
      <p className="text-xs text-yellow-600 uppercase tracking-widest mb-1">
        Resolver controls
      </p>
      <p className="text-xs text-gray-600 mb-4 leading-relaxed">
        You are the resolver for this market. Select the outcome to record on-chain.
      </p>

      {pendingOutcome === null ? (
        <div className="flex gap-3">
          <button
            onClick={() => handleClickOutcome(0)}
            disabled={isBusy}
            className="flex-1 border border-green-900 py-2.5 text-xs text-green-400 hover:bg-green-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve YES
          </button>
          <button
            onClick={() => handleClickOutcome(1)}
            disabled={isBusy}
            className="flex-1 border border-red-900 py-2.5 text-xs text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Resolve NO
          </button>
        </div>
      ) : (
        <div className="border border-[#2a2a2a] p-4">
          <p className="text-xs text-gray-300 mb-1">Confirm resolution</p>
          <p className="text-xs text-gray-600 mb-3 leading-relaxed">
            Resolve as{' '}
            <span className={`${pendingOutcome === 0 ? 'text-green-400' : 'text-red-400'}`}>
              {outcomeLabel(pendingOutcome)}
            </span>
            . This action is <span className="text-gray-400">irreversible</span>.
          </p>
          <p className="text-xs text-gray-700 mb-4 truncate">"{question}"</p>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isBusy}
              className={`flex-1 border py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                pendingOutcome === 0
                  ? 'border-green-900 text-green-400 hover:bg-green-900/20'
                  : 'border-red-900 text-red-400 hover:bg-red-900/20'
              }`}
            >
              {isBusy
                ? isConfirming
                  ? 'Confirming...'
                  : 'Submitting...'
                : `Confirm — Resolve ${outcomeLabel(pendingOutcome)}`}
            </button>
            <button
              onClick={() => { setPendingOutcome(null); setError('') }}
              disabled={isBusy}
              className="border border-[#2a2a2a] px-4 py-2 text-xs text-gray-500 hover:text-gray-300 hover:border-[#444] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="border border-red-900 bg-red-950/20 p-3 mt-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <p className="text-xs text-gray-700 mt-3">
        Resolution is permanent and cannot be reversed after submission.
      </p>
    </div>
  )
}
