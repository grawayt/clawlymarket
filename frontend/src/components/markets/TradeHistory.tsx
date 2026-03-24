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
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      <td className="py-2.5 px-3 text-gray-500 text-xs font-mono">
        #{trade.blockNumber.toString()}
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
          trade.isBuy
            ? 'bg-green-900/40 text-green-400 border border-green-800/50'
            : 'bg-red-900/40 text-red-400 border border-red-800/50'
        }`}>
          {type}
        </span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs font-medium ${
          outcome === 'YES' ? 'text-green-400' : 'text-red-400'
        }`}>
          {outcome}
        </span>
      </td>
      <td className="py-2.5 px-3 text-gray-300 text-xs">
        {collateral.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        <span className="text-gray-500 ml-1">CLAW</span>
      </td>
      <td className="py-2.5 px-3 text-gray-300 text-xs">
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

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-400">{title}</h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-600">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading trades...</p>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load trade history.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-500 text-sm">No trades yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Block</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Outcome</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Amount</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Tokens</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Tx</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <TradeRow
                    key={`${trade.transactionHash}-${trade.outcomeIndex}`}
                    trade={trade}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors"
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

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {trades.length > 0 && (
          <span className="text-xs text-gray-600">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading activity...</p>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load activity.</p>
      ) : trades.length === 0 ? (
        <p className="text-gray-500 text-sm">No trading activity yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Block</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Outcome</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Amount</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Tokens</th>
                  <th className="pb-2 px-3 text-left text-xs font-medium text-gray-500">Tx</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <TradeRow
                    key={`${trade.transactionHash}-${trade.outcomeIndex}`}
                    trade={trade}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Show all {trades.length} trades
            </button>
          )}
        </>
      )}
    </div>
  )
}
