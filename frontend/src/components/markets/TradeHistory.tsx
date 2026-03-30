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
      className="text-red-400 hover:text-red-300 text-xs transition-colors"
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
    <tr className="border-b border-[#1a1a1a] hover:bg-[#111] transition-colors">
      <td className="py-2.5 px-3 text-gray-700 text-xs tabular-nums">
        #{trade.blockNumber.toString()}
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs ${trade.isBuy ? 'text-green-400' : 'text-red-400'}`}>
          {type}
        </span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs ${outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
          {outcome}
        </span>
      </td>
      <td className="py-2.5 px-3 text-gray-400 text-xs tabular-nums">
        {collateral.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        <span className="text-gray-700 ml-1">CLAW</span>
      </td>
      <td className="py-2.5 px-3 text-gray-600 text-xs tabular-nums">
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
    <div className="border border-[#1a1a1a] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xs text-gray-500 uppercase tracking-widest">{title}</h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-700 tabular-nums">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-700 text-xs">Loading trades...</p>
      ) : error ? (
        <p className="text-red-400 text-xs">Failed to load trade history.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-700 text-xs">No trades yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {tableHeaders.map((h) => (
                    <th key={h} className="pb-2.5 px-3 text-left text-xs text-gray-600 uppercase tracking-wide">{h}</th>
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
    <div className="border border-[#1a1a1a] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xs text-gray-500 uppercase tracking-widest">{title}</h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-700 tabular-nums">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-700 text-xs">Loading activity...</p>
      ) : error ? (
        <p className="text-red-400 text-xs">Failed to load activity.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-700 text-xs">No trading activity yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {tableHeaders.map((h) => (
                    <th key={h} className="pb-2.5 px-3 text-left text-xs text-gray-600 uppercase tracking-wide">{h}</th>
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
