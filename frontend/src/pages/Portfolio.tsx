import { useRef, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useIsVerified } from '../hooks/useClawlia'
import { useMarketData, useMarketPositions } from '../hooks/useMarket'
import {
  useMarketStats,
  usePortfolioBase,
  useClawliaTransfers,
  type PositionStats,
  type TransferRecord,
} from '../hooks/usePortfolioStats'
import { UserTradeHistory } from '../components/markets/TradeHistory'

// ---- helpers ----

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtClaw(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// ---- stats bar ----

interface StatsBarProps {
  clawBalance: number
  totalPositionValue: number
  activePositionCount: number
  totalWins: number
  totalLosses: number
  isLoading: boolean
}

function StatsBar({
  clawBalance,
  totalPositionValue,
  activePositionCount,
  totalWins,
  totalLosses,
  isLoading,
}: StatsBarProps) {
  const totalValue = clawBalance + totalPositionValue
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <p className="text-xs text-gray-400 mb-1">Total Value</p>
        <p className="text-xl font-bold text-white">
          {isLoading ? '…' : fmtClaw(totalValue)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">CLAW</p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <p className="text-xs text-gray-400 mb-1">Active Positions</p>
        <p className="text-xl font-bold text-white">{activePositionCount}</p>
        <p className="text-xs text-gray-500 mt-0.5">open markets</p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <p className="text-xs text-gray-400 mb-1">Markets Won</p>
        <p className="text-xl font-bold text-green-400">{totalWins}</p>
        <p className="text-xs text-gray-500 mt-0.5">resolved</p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <p className="text-xs text-gray-400 mb-1">Markets Lost</p>
        <p className="text-xl font-bold text-red-400">{totalLosses}</p>
        <p className="text-xs text-gray-500 mt-0.5">resolved</p>
      </div>
    </div>
  )
}

// ---- active position card ----

function ActivePositionCard({
  marketAddress,
  onStats,
}: {
  marketAddress: `0x${string}`
  onStats: (s: PositionStats) => void
}) {
  const { market } = useMarketData(marketAddress)
  const { yesBalance, noBalance } = useMarketPositions(marketAddress)
  const stats = useMarketStats(marketAddress)

  // Report stats to parent via stable callback (mutates a ref, no re-render loop)
  if (stats) onStats(stats)

  const hasYes = yesBalance != null && yesBalance > 0n
  const hasNo = noBalance != null && noBalance > 0n

  if (!hasYes && !hasNo) return null
  if (market?.resolved) return null // resolved positions shown in separate section

  const yesProbBps = market?.probability?.[0]
  const yesPct = yesProbBps != null ? Number(yesProbBps) / 100 : null
  const currentValue = stats?.currentValue ?? 0

  return (
    <Link
      to={`/markets/${marketAddress}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-4 block hover:border-gray-600 transition-colors"
    >
      <h3 className="text-sm font-medium text-gray-200 mb-3 line-clamp-2">
        {market?.question ?? 'Loading…'}
      </h3>

      <div className="flex gap-3 mb-3">
        {hasYes && (
          <div className="flex-1 rounded bg-green-900/20 border border-green-800/40 px-3 py-2 text-center">
            <p className="text-xs text-green-400">YES</p>
            <p className="text-sm font-bold text-green-300">
              {parseFloat(formatEther(yesBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-500">{yesPct.toFixed(1)}%</p>
            )}
          </div>
        )}
        {hasNo && (
          <div className="flex-1 rounded bg-red-900/20 border border-red-800/40 px-3 py-2 text-center">
            <p className="text-xs text-red-400">NO</p>
            <p className="text-sm font-bold text-red-300">
              {parseFloat(formatEther(noBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-500">{(100 - yesPct).toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-2">
        <span className="text-xs text-gray-500">Est. value</span>
        <span className="text-xs font-semibold text-gray-300">
          {fmtClaw(currentValue)} CLAW
        </span>
      </div>
    </Link>
  )
}

// ---- resolved position card ----

function ResolvedPositionCard({ marketAddress }: { marketAddress: `0x${string}` }) {
  const { market } = useMarketData(marketAddress)
  const { yesBalance, noBalance } = useMarketPositions(marketAddress)

  const hasYes = yesBalance != null && yesBalance > 0n
  const hasNo = noBalance != null && noBalance > 0n

  if (!market?.resolved) return null
  if (!hasYes && !hasNo) return null

  // outcome 0n = YES wins, 1n = NO wins
  const outcomeIsYes = market.outcome === 0n
  const userWon = (outcomeIsYes && hasYes) || (!outcomeIsYes && hasNo)
  const winningBalance = outcomeIsYes ? (yesBalance ?? 0n) : (noBalance ?? 0n)
  const payoutEst = parseFloat(formatEther(winningBalance))

  return (
    <Link
      to={`/markets/${marketAddress}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-4 block hover:border-gray-600 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-200 line-clamp-2 flex-1">
          {market.question ?? 'Loading…'}
        </h3>
        <span
          className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${
            userWon
              ? 'bg-green-900/40 text-green-400 border border-green-700/50'
              : 'bg-red-900/40 text-red-400 border border-red-700/50'
          }`}
        >
          {userWon ? 'WON' : 'LOST'}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>Resolved: {outcomeIsYes ? 'YES' : 'NO'}</span>
        {userWon && payoutEst > 0 && (
          <span className="text-green-400 font-semibold">
            +{fmtClaw(payoutEst)} CLAW
          </span>
        )}
      </div>

      <div className="flex gap-3 text-xs text-gray-500">
        {hasYes && (
          <span>YES: {parseFloat(formatEther(yesBalance)).toLocaleString()}</span>
        )}
        {hasNo && (
          <span>NO: {parseFloat(formatEther(noBalance)).toLocaleString()}</span>
        )}
      </div>
    </Link>
  )
}

// ---- transfer row ----

function TransferRow({ t }: { t: TransferRecord }) {
  const isSent = t.direction === 'sent'
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800 last:border-0">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isSent
            ? 'bg-red-900/30 text-red-400 border border-red-800/40'
            : 'bg-green-900/30 text-green-400 border border-green-800/40'
        }`}
      >
        {isSent ? '↑' : '↓'}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 font-mono">
          {isSent ? (
            <>
              <span className="text-gray-500">To </span>
              {truncateAddr(t.to)}
            </>
          ) : (
            <>
              <span className="text-gray-500">From </span>
              {truncateAddr(t.from)}
            </>
          )}
        </p>
        <p className="text-xs text-gray-600 font-mono truncate">{t.txHash.slice(0, 18)}…</p>
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm font-bold ${isSent ? 'text-red-400' : 'text-green-400'}`}>
          {isSent ? '-' : '+'}
          {t.amount}
        </p>
        <p className="text-xs text-gray-500">CLAW</p>
      </div>
    </div>
  )
}

// ---- main page ----

export default function Portfolio() {
  const { isConnected, address } = useAccount()
  const { isVerified, isLoading: verLoading } = useIsVerified()
  const { clawBalance, markets, isLoading: baseLoading } = usePortfolioBase()
  const { transfers, isLoading: transfersLoading, error: transfersError } = useClawliaTransfers()

  // Collect per-market stats from child cards into a ref so writes don't
  // trigger re-renders. Aggregates are computed in a memo keyed on markets.
  const statsRef = useRef<Map<`0x${string}`, PositionStats>>(new Map())

  useMemo(() => {
    statsRef.current = new Map()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets])

  const handleStats = (s: PositionStats) => {
    statsRef.current.set(s.marketAddress, s)
  }

  const { totalPositionValue, activePositionCount, totalWins, totalLosses } = useMemo(() => {
    let totalPositionValue = 0
    let activePositionCount = 0
    let totalWins = 0
    let totalLosses = 0
    for (const s of statsRef.current.values()) {
      totalPositionValue += s.currentValue
      if (!s.resolved) activePositionCount++
      if (s.isWin === true) totalWins++
      if (s.isWin === false) totalLosses++
    }
    return { totalPositionValue, activePositionCount, totalWins, totalLosses }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets])

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        <p className="text-gray-400">Connect your wallet to view your portfolio.</p>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>

      {/* Stats bar */}
      <StatsBar
        clawBalance={clawBalance}
        totalPositionValue={totalPositionValue}
        activePositionCount={activePositionCount}
        totalWins={totalWins}
        totalLosses={totalLosses}
        isLoading={baseLoading}
      />

      {/* Balance + verification */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <p className="text-sm text-gray-400">CLAW Balance</p>
          <p className="text-3xl font-bold mt-1">
            {baseLoading ? '…' : fmtClaw(clawBalance)}
          </p>
          <p className="text-xs text-gray-500 mt-2 font-mono">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </p>
          {totalPositionValue > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              + {fmtClaw(totalPositionValue)} CLAW in open positions
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <p className="text-sm text-gray-400">Verification Status</p>
          <p
            className={`text-lg font-medium mt-1 ${
              verLoading
                ? 'text-gray-500'
                : isVerified
                  ? 'text-green-400'
                  : 'text-yellow-400'
            }`}
          >
            {verLoading ? 'Checking…' : isVerified ? 'Verified' : 'Not Verified'}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            {isVerified
              ? 'You are verified and can create markets and trade'
              : 'Complete verification to receive 1,000 CLAW'}
          </p>
        </div>
      </div>

      {/* Active positions */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Active Positions</h2>
        {markets.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No markets exist yet.{' '}
            <Link to="/markets" className="text-red-400 underline">
              Create one
            </Link>{' '}
            to get started.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {markets.map((addr) => (
                <ActivePositionCard
                  key={addr}
                  marketAddress={addr}
                  onStats={handleStats}
                />
              ))}
            </div>
            {activePositionCount === 0 && (
              <p className="text-gray-500 text-sm mt-3">
                No open positions found.{' '}
                <Link to="/markets" className="text-red-400 underline">
                  Browse markets
                </Link>{' '}
                to start trading.
              </p>
            )}
          </>
        )}
      </div>

      {/* Resolved positions */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Resolved Positions</h2>
        {markets.length === 0 ? (
          <p className="text-gray-500 text-sm">No resolved markets yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {markets.map((addr) => (
                <ResolvedPositionCard key={addr} marketAddress={addr} />
              ))}
            </div>
            {totalWins === 0 && totalLosses === 0 && (
              <p className="text-gray-500 text-sm mt-3">No resolved positions yet.</p>
            )}
          </>
        )}
      </div>

      {/* Recent CLAW token transfers */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent CLAW Transfers</h2>
          {transfers.length > 0 && (
            <span className="text-xs text-gray-600">last {transfers.length}</span>
          )}
        </div>

        {transfersLoading ? (
          <p className="text-gray-500 text-sm">Loading transfers…</p>
        ) : transfersError ? (
          <p className="text-red-400 text-sm">Failed to load transfer history.</p>
        ) : transfers.length === 0 ? (
          <p className="text-gray-500 text-sm">No CLAW transfer history found.</p>
        ) : (
          <div>
            {transfers.map((t) => (
              <TransferRow key={`${t.txHash}-${t.direction}`} t={t} />
            ))}
          </div>
        )}
      </div>

      {/* User trade activity (all markets) */}
      <UserTradeHistory />
    </div>
  )
}
