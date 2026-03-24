import { useState } from 'react'
import { parseEther, isAddress } from 'viem'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { clawliaTokenAbi } from '../../contracts/ClawliaTokenAbi'
import { useContractAddresses } from '../../hooks/useContracts'
import { useClawliaBalance } from '../../hooks/useClawlia'

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function parseTransferError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)

  if (msg.includes('TransferNotAllowed')) {
    return 'Recipient is not a verified address. Only verified addresses can receive CLAW.'
  }
  if (msg.includes('ERC20InsufficientBalance') || msg.includes('insufficient balance')) {
    return 'Insufficient CLAW balance.'
  }
  if (msg.includes('user rejected') || msg.includes('User rejected')) {
    return 'Transaction rejected in wallet.'
  }
  if (msg.includes('ERC20InvalidReceiver')) {
    return 'Invalid recipient address.'
  }
  return 'Transaction failed. Check that the recipient is a verified address.'
}

interface TransferPanelProps {
  /** Current CLAW balance as a plain number (from usePortfolioBase). Used for the max hint. */
  clawBalance: number
}

export function TransferPanel({ clawBalance }: TransferPanelProps) {
  const addrs = useContractAddresses()
  const { refetch: refetchBalance } = useClawliaBalance()

  const [open, setOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  // Derived validation
  const recipientValid = isAddress(recipient)
  const amountNum = parseFloat(amount)
  const amountValid = !isNaN(amountNum) && amountNum > 0 && amountNum <= clawBalance
  const canSubmit = recipientValid && amountValid

  // Wagmi write + receipt
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const isSubmitting = isWritePending || isConfirming

  // Reset form back to idle
  function handleReset() {
    resetWrite()
    setRecipient('')
    setAmount('')
    setReason('')
    setOpen(false)
  }

  function handleSend() {
    if (!addrs || !canSubmit) return
    writeContract({
      address: addrs.clawliaToken,
      abi: clawliaTokenAbi,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, parseEther(amount)],
    })
  }

  // Refetch balance once the tx confirms
  if (isSuccess) {
    refetchBalance()
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => {
          if (open && (isSuccess || writeError)) handleReset()
          else setOpen((v) => !v)
        }}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Send CLAW</span>
          <span className="text-xs text-gray-500">peer-to-peer transfer</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-6 pb-6 border-t border-gray-800">
          {/* Success state */}
          {isSuccess && txHash && (
            <div className="mt-5">
              <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-4">
                <p className="text-sm font-semibold text-green-400 mb-1">
                  Sent {parseFloat(amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} CLAW
                  {' '}to {truncateAddr(recipient)}
                </p>
                <p className="text-xs text-gray-500 font-mono break-all">
                  tx: {txHash}
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="mt-3 text-xs text-gray-400 underline hover:text-gray-200"
              >
                Send another transfer
              </button>
            </div>
          )}

          {/* Error state */}
          {writeError && !isSuccess && (
            <div className="mt-5">
              <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-4">
                <p className="text-sm font-semibold text-red-400 mb-1">Transfer failed</p>
                <p className="text-xs text-gray-400">{parseTransferError(writeError)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetWrite()
                }}
                className="mt-3 text-xs text-gray-400 underline hover:text-gray-200"
              >
                Try again
              </button>
            </div>
          )}

          {/* Form — hidden once success, shown otherwise */}
          {!isSuccess && (
            <div className="mt-5 space-y-4">
              {/* Recipient */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Recipient address
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  disabled={isSubmitting}
                  className={`w-full rounded-md bg-gray-800 border px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-50 transition-colors ${
                    recipient && !recipientValid
                      ? 'border-red-800'
                      : 'border-gray-700'
                  }`}
                />
                {recipient && !recipientValid && (
                  <p className="text-xs text-red-400 mt-1">Enter a valid 0x address</p>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Amount
                  <span className="ml-2 text-gray-600">
                    max {clawBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} CLAW
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
                    className={`w-full rounded-md bg-gray-800 border px-3 py-2 pr-16 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-50 transition-colors ${
                      amount && !amountValid
                        ? 'border-red-800'
                        : 'border-gray-700'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(String(clawBalance))}
                    disabled={isSubmitting || clawBalance <= 0}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500 hover:text-red-400 font-medium disabled:opacity-30"
                  >
                    MAX
                  </button>
                </div>
                {amount && !amountValid && (
                  <p className="text-xs text-red-400 mt-1">
                    {amountNum <= 0
                      ? 'Amount must be greater than zero'
                      : 'Amount exceeds your balance'}
                  </p>
                )}
              </div>

              {/* Reason (optional, off-chain only) */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Reason
                  <span className="ml-2 text-gray-600">(optional, not stored on-chain)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. For helping debug my inference pipeline"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-50"
                />
              </div>

              {/* Submit */}
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSubmit || isSubmitting}
                className="w-full rounded-md bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm py-2.5 transition-colors"
              >
                {isWritePending
                  ? 'Confirm in wallet…'
                  : isConfirming
                    ? 'Clawing through the chain…'
                    : 'Send CLAW'}
              </button>

              <p className="text-xs text-gray-600">
                Only verified addresses can send and receive CLAW. The transaction will revert if the
                recipient has not completed verification.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
