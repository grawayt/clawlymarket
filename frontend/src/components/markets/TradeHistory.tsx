import { useState } from 'react'
import { formatEther } from 'viem'
import { useTradeHistory, useUserTradeHistory } from '../../hooks/useTradeHistory'
import type { TradeEvent } from '../../hooks/useTradeHistory'

const PAGE_SIZE = 50

function TxLink({ hash }: { hash: `0x${string}` }) {
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`
  return (
    <a
      href={`https://arbiscan.io/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-red-400 hover:text-red-300 font-mono text-xs transition-colors"
      title={hash}
    >
      {short}
    </a>
  )
}

function TradeRow({ trade }: { trade: TradeEvent }) {
  const outcome = trade.outcomeIndex === 0n ? 'YES' : 'NO'
  const type = trade.isBuy ? 'Buy' : 'Sell'
  const collateral = parseFloat(formatEther(trade.collateralAmount))
  const tokens = parseFloat(formatEther(trade.tokenAmount))

  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="py-2.5 px-3 text-gray-600 text-xs font-mono tabular-nums">
        #{trade.blockNumber.toString()}
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
          trade.isBuy
            ? 'bg-green-500/10 text-green-400 border-green-500/25'
            : 'bg-red-500/10 text-red-400 border-red-500/25'
        }`}>
          {type}
        </span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs font-bold ${outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
          {outcome}
        </span>
      </td>
      <td className="py-2.5 px-3 text-gray-300 text-xs tabular-nums">
        {collateral.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        <span className="text-gray-600 ml-1">CLAW</span>
      </td>
      <td className="py-2.5 px-3 text-gray-400 text-xs tabular-nums">
        {tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </td>
      <td className="py-2.5 px-3">
        <TxLink hash={trade.transactionHash} />
      </td>
    </tr>
  )
}

interface TradeHistoryProps {
  marketAddress: `0x${string}`
  title?: string
}

export function TradeHistory({ marketAddress, title = 'Trade History' }: TradeHistoryProps) {
  const { trades, isLoading, error } = useTradeHistory(marketAddress)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? trades : trades.slice(0, PAGE_SIZE)
  const hasMore = trades.length > PAGE_SIZE && !showAll

  const tableHeaders = ['Block', 'Type', 'Outcome', 'Amount', 'Tokens', 'Tx']

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-indigo-500/70 block" />
          {title}
        </h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-700 tabular-nums">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-600 text-sm">Loading trades...</p>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load trade history.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-600 text-sm">No trades yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {tableHeaders.map((h) => (
                    <th key={h} className="pb-2.5 px-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <TradeRow key={`${trade.transactionHash}-${trade.outcomeIndex}`} trade={trade} />
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-4 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Show all {trades.length} trades
            </button>
          )}
        </>
      )}
    </div>
  )
}

interface UserTradeHistoryProps {
  marketAddress?: `0x${string}`
  title?: string
}

export function UserTradeHistory({ marketAddress, title = 'Recent Activity' }: UserTradeHistoryProps) {
  const { trades, isLoading, error } = useUserTradeHistory(marketAddress)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? trades : trades.slice(0, PAGE_SIZE)
  const hasMore = trades.length > PAGE_SIZE && !showAll

  const tableHeaders = ['Block', 'Type', 'Outcome', 'Amount', 'Tokens', 'Tx']

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-red-500/70 block" />
          {title}
        </h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-700 tabular-nums">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-600 text-sm">Loading activity...</p>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load activity.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-600 text-sm">No trading activity yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {tableHeaders.map((h) => (
                    <th key={h} className="pb-2.5 px-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <TradeRow key={`${trade.transactionHash}-${trade.outcomeIndex}`} trade={trade} />
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-4 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Show all {trades.length} trades
            </button>
          )}
        </>
      )}
    </div>
  )
}
