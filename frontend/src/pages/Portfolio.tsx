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
import { TransferPanel } from '../components/token/TransferPanel'

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtClaw(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

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

  const stats = [
    {
      label: 'Total Value',
      value: isLoading ? '…' : fmtClaw(totalValue),
      sub: 'CLAW',
      accent: 'text-white',
      border: 'border-l-indigo-500',
      bg: 'bg-indigo-500/[0.04]',
    },
    {
      label: 'Active Positions',
      value: String(activePositionCount),
      sub: 'open markets',
      accent: 'text-sky-400',
      border: 'border-l-sky-500',
      bg: 'bg-sky-500/[0.04]',
    },
    {
      label: 'Markets Won',
      value: String(totalWins),
      sub: 'resolved',
      accent: 'text-green-400',
      border: 'border-l-green-500',
      bg: 'bg-green-500/[0.04]',
    },
    {
      label: 'Markets Lost',
      value: String(totalLosses),
      sub: 'resolved',
      accent: 'text-red-400',
      border: 'border-l-red-500',
      bg: 'bg-red-500/[0.04]',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {stats.map(({ label, value, sub, accent, border, bg }) => (
        <div
          key={label}
          className={`rounded-xl border border-white/[0.06] border-l-2 ${border} ${bg} p-4`}
        >
          <p className="text-xs text-gray-500 mb-1">{label}</p>
          <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
          <p className="text-xs text-gray-600 mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Active position card ──────────────────────────────────────────────────────

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

  if (stats) onStats(stats)

  const hasYes = yesBalance != null && yesBalance > 0n
  const hasNo = noBalance != null && noBalance > 0n

  if (!hasYes && !hasNo) return null
  if (market?.resolved) return null

  const yesProbBps = market?.probability?.[0]
  const yesPct = yesProbBps != null ? Number(yesProbBps) / 100 : null
  const currentValue = stats?.currentValue ?? 0

  return (
    <Link
      to={`/markets/${marketAddress}`}
      className="group rounded-xl border border-white/[0.06] bg-[#0d0d18] p-4 block hover:border-red-500/20 hover:bg-[#110d18] transition-all duration-200"
    >
      <h3 className="text-sm font-medium text-gray-200 mb-3 line-clamp-2 group-hover:text-white transition-colors">
        {market?.question ?? 'Loading…'}
      </h3>

      <div className="flex gap-2 mb-3">
        {hasYes && (
          <div className="flex-1 rounded-lg bg-green-500/[0.07] border border-green-500/20 px-3 py-2 text-center">
            <p className="text-xs font-medium text-green-500 uppercase tracking-wide">YES</p>
            <p className="text-sm font-bold text-green-300 tabular-nums mt-0.5">
              {parseFloat(formatEther(yesBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-600 mt-0.5">{yesPct.toFixed(1)}%</p>
            )}
          </div>
        )}
        {hasNo && (
          <div className="flex-1 rounded-lg bg-red-500/[0.07] border border-red-500/20 px-3 py-2 text-center">
            <p className="text-xs font-medium text-red-500 uppercase tracking-wide">NO</p>
            <p className="text-sm font-bold text-red-300 tabular-nums mt-0.5">
              {parseFloat(formatEther(noBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-600 mt-0.5">{(100 - yesPct).toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      {/* Probability bar */}
      {yesPct != null && (
        <div className="h-1 w-full rounded-full overflow-hidden bg-gray-800 mb-3">
          <div
            className="h-full rounded-full"
            style={{
              width: `${yesPct}%`,
              background: 'linear-gradient(90deg, #15803d, #22c55e)',
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-white/[0.04] pt-2.5">
        <span className="text-xs text-gray-600">Est. value</span>
        <span className="text-xs font-semibold text-gray-300 tabular-nums">
          {fmtClaw(currentValue)} CLAW
        </span>
      </div>
    </Link>
  )
}

// ── Resolved position card ────────────────────────────────────────────────────

function ResolvedPositionCard({ marketAddress }: { marketAddress: `0x${string}` }) {
  const { market } = useMarketData(marketAddress)
  const { yesBalance, noBalance } = useMarketPositions(marketAddress)

  const hasYes = yesBalance != null && yesBalance > 0n
  const hasNo = noBalance != null && noBalance > 0n

  if (!market?.resolved) return null
  if (!hasYes && !hasNo) return null

  const outcomeIsYes = market.outcome === 0n
  const userWon = (outcomeIsYes && hasYes) || (!outcomeIsYes && hasNo)
  const winningBalance = outcomeIsYes ? (yesBalance ?? 0n) : (noBalance ?? 0n)
  const payoutEst = parseFloat(formatEther(winningBalance))

  return (
    <Link
      to={`/markets/${marketAddress}`}
      className="group rounded-xl border bg-[#0d0d18] p-4 block transition-all duration-200 hover:bg-[#0f0f1c] ${userWon ? 'border-green-500/15 hover:border-green-500/25' : 'border-white/[0.06] hover:border-white/10'}"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-200 line-clamp-2 flex-1 group-hover:text-white transition-colors">
          {market.question ?? 'Loading…'}
        </h3>
        <span
          className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
            userWon
              ? 'bg-green-500/15 text-green-400 border border-green-500/25'
              : 'bg-red-500/15 text-red-400 border border-red-500/25'
          }`}
        >
          {userWon ? 'WON' : 'LOST'}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>Resolved: <span className={outcomeIsYes ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{outcomeIsYes ? 'YES' : 'NO'}</span></span>
        {userWon && payoutEst > 0 && (
          <span className="text-green-400 font-semibold">
            +{fmtClaw(payoutEst)} CLAW
          </span>
        )}
      </div>

      <div className="flex gap-3 text-xs text-gray-600">
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

// ── Transfer row ──────────────────────────────────────────────────────────────

function TransferRow({ t }: { t: TransferRecord }) {
  const isSent = t.direction === 'sent'
  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/[0.04] last:border-0">
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
          isSent
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-green-500/10 text-green-400 border border-green-500/20'
        }`}
      >
        {isSent ? '↑' : '↓'}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 font-mono">
          {isSent ? (
            <><span className="text-gray-600">To </span>{truncateAddr(t.to)}</>
          ) : (
            <><span className="text-gray-600">From </span>{truncateAddr(t.from)}</>
          )}
        </p>
        <p className="text-xs text-gray-700 font-mono truncate mt-0.5">{t.txHash.slice(0, 18)}…</p>
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${isSent ? 'text-red-400' : 'text-green-400'}`}>
          {isSent ? '-' : '+'}{t.amount}
        </p>
        <p className="text-xs text-gray-600">CLAW</p>
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-6 mb-5">
      <h2 className="text-sm font-semibold text-gray-200 mb-5 flex items-center gap-2">
        <span className="w-1 h-4 rounded-full bg-red-500/70 block" />
        {title}
      </h2>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const { isConnected, address } = useAccount()
  const { isVerified, isLoading: verLoading } = useIsVerified()
  const { clawBalance, markets, isLoading: baseLoading } = usePortfolioBase()
  const { transfers, isLoading: transfersLoading, error: transfersError } = useClawliaTransfers()

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
        <h1 className="text-2xl font-bold text-gray-100">Portfolio</h1>
        <p className="text-gray-500 text-sm">Connect your wallet to view your portfolio.</p>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-100 mb-7">Portfolio</h1>

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-6">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-2">CLAW Balance</p>
          <p className="text-3xl font-bold text-white tabular-nums">
            {baseLoading ? '…' : fmtClaw(clawBalance)}
          </p>
          <p className="text-xs text-gray-600 mt-2 font-mono">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </p>
          {totalPositionValue > 0 && (
            <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
              <span className="text-indigo-400">+</span>
              <span>{fmtClaw(totalPositionValue)} CLAW in open positions</span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-6">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-2">Verification Status</p>
          <div className="flex items-center gap-2 mt-1">
            {verLoading ? (
              <span className="text-gray-500 text-base font-medium">Checking…</span>
            ) : isVerified ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-green-400 text-base font-semibold">Verified</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-yellow-400 text-base font-semibold">Not Verified</span>
              </>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-3 leading-relaxed">
            {isVerified
              ? 'You are verified and can create markets and trade'
              : 'Complete verification to receive 1,000 CLAW'}
          </p>
        </div>
      </div>

      {/* Send CLAW */}
      {isVerified && (
        <div className="mb-6">
          <TransferPanel clawBalance={clawBalance} />
        </div>
      )}

      {/* Active positions */}
      <Section title="Active Positions">
        {markets.length === 0 ? (
          <p className="text-gray-600 text-sm">
            No markets exist yet.{' '}
            <Link to="/markets" className="text-red-400 hover:text-red-300 underline underline-offset-2">
              Create one
            </Link>{' '}
            to get started.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {markets.map((addr) => (
                <ActivePositionCard
                  key={addr}
                  marketAddress={addr}
                  onStats={handleStats}
                />
              ))}
            </div>
            {activePositionCount === 0 && (
              <p className="text-gray-600 text-sm mt-4">
                No open positions found.{' '}
                <Link to="/markets" className="text-red-400 hover:text-red-300 underline underline-offset-2">
                  Browse markets
                </Link>{' '}
                to start trading.
              </p>
            )}
          </>
        )}
      </Section>

      {/* Resolved positions */}
      <Section title="Resolved Positions">
        {markets.length === 0 ? (
          <p className="text-gray-600 text-sm">No resolved markets yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {markets.map((addr) => (
                <ResolvedPositionCard key={addr} marketAddress={addr} />
              ))}
            </div>
            {totalWins === 0 && totalLosses === 0 && (
              <p className="text-gray-600 text-sm mt-4">No resolved positions yet.</p>
            )}
          </>
        )}
      </Section>

      {/* Recent CLAW transfers */}
      <Section title="Recent CLAW Transfers">
        {transfersLoading ? (
          <p className="text-gray-600 text-sm">Loading transfers…</p>
        ) : transfersError ? (
          <p className="text-red-400 text-sm">Failed to load transfer history.</p>
        ) : transfers.length === 0 ? (
          <p className="text-gray-600 text-sm">No CLAW transfer history found.</p>
        ) : (
          <div>
            {transfers.map((t) => (
              <TransferRow key={`${t.txHash}-${t.direction}`} t={t} />
            ))}
          </div>
        )}
      </Section>

      {/* User trade activity */}
      <UserTradeHistory />
    </div>
  )
}
