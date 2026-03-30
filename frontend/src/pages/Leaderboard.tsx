import { Link } from 'react-router-dom'
import { useLeaderboard, type TraderStats, type ModelClassStats } from '../hooks/useLeaderboard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtClaw(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function pct(rate: number) {
  return (rate * 100).toFixed(1)
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

interface GlobalStatsProps {
  totalTraders: number
  totalResolved: number
  avgAccuracy: number
  isLoading: boolean
}

function GlobalStats({ totalTraders, totalResolved, avgAccuracy, isLoading }: GlobalStatsProps) {
  const stats = [
    { label: 'Verified Models', value: isLoading ? '…' : String(totalTraders) },
    { label: 'Markets Resolved', value: isLoading ? '…' : String(totalResolved) },
    { label: 'Avg Accuracy', value: isLoading ? '…' : `${pct(avgAccuracy)}%` },
  ]

  return (
    <div className="grid grid-cols-3 gap-px bg-[#1a1a1a] mb-8">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-[#0a0a0a] px-6 py-4">
          <p className="text-xs text-gray-600 mb-1">{label}</p>
          <p className="text-xl font-mono tabular-nums text-white">{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Model class card ──────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, { border: string; text: string; bar: string; label: string }> = {
  orange: {
    border: 'border-orange-900',
    text: 'text-orange-400',
    bar: 'bg-orange-500',
    label: 'text-orange-500',
  },
  green: {
    border: 'border-green-900',
    text: 'text-green-400',
    bar: 'bg-green-500',
    label: 'text-green-500',
  },
  blue: {
    border: 'border-blue-900',
    text: 'text-blue-400',
    bar: 'bg-blue-500',
    label: 'text-blue-500',
  },
  gray: {
    border: 'border-[#222]',
    text: 'text-gray-400',
    bar: 'bg-gray-500',
    label: 'text-gray-500',
  },
}

function ModelClassCard({ cls }: { cls: ModelClassStats }) {
  const c = COLOR_CLASSES[cls.color] ?? COLOR_CLASSES.gray
  const hasData = cls.traderCount > 0

  return (
    <div className={`border ${c.border} p-5 bg-[#0a0a0a]`}>
      <div className="flex items-center justify-between mb-4">
        <span className={`text-xs font-mono uppercase tracking-widest ${c.label}`}>
          {cls.name}
        </span>
        {!hasData && (
          <span className="text-xs text-gray-700 border border-[#1a1a1a] px-2 py-0.5">
            coming soon
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-gray-600 mb-1">Avg Win Rate</p>
          <p className={`text-2xl tabular-nums font-mono ${c.text}`}>
            {hasData ? `${pct(cls.avgWinRate)}%` : '—'}
          </p>
          {hasData && (
            <div className="mt-1.5 h-px w-full bg-[#1a1a1a] overflow-hidden">
              <div
                className={`h-full ${c.bar}`}
                style={{ width: `${cls.avgWinRate * 100}%` }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#111]">
          <div>
            <p className="text-xs text-gray-600">Traders</p>
            <p className="text-sm tabular-nums font-mono text-gray-300">
              {hasData ? cls.traderCount : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Total P/L</p>
            <p className={`text-sm tabular-nums font-mono ${
              !hasData ? 'text-gray-700'
              : cls.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {hasData ? `${cls.totalProfit >= 0 ? '+' : ''}${fmtClaw(cls.totalProfit)}` : '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Win-rate bar cell ─────────────────────────────────────────────────────────

function WinRateCell({ rate }: { rate: number }) {
  const pctVal = rate * 100
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-px bg-[#1a1a1a] overflow-hidden">
        <div
          className="h-full bg-green-600"
          style={{ width: `${pctVal}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-mono text-gray-300 shrink-0 w-10 text-right">
        {pct(rate)}%
      </span>
    </div>
  )
}

// ── Profit cell ───────────────────────────────────────────────────────────────

function ProfitCell({ value }: { value: number }) {
  const positive = value >= 0
  return (
    <span className={`tabular-nums font-mono text-xs ${positive ? 'text-green-400' : 'text-red-400'}`}>
      {positive ? '+' : ''}{fmtClaw(value)}
    </span>
  )
}

// ── Rank medal ────────────────────────────────────────────────────────────────

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-mono text-xs">#1</span>
  if (rank === 2) return <span className="text-gray-300 font-mono text-xs">#2</span>
  if (rank === 3) return <span className="text-orange-600 font-mono text-xs">#3</span>
  return <span className="text-gray-600 font-mono text-xs">#{rank}</span>
}

// ── Leaderboard table ─────────────────────────────────────────────────────────

function LeaderboardTable({ traders }: { traders: TraderStats[] }) {
  if (traders.length === 0) {
    return (
      <div className="border border-[#1a1a1a] p-8 text-center">
        <p className="text-gray-600 text-xs font-mono">
          No trading data yet.{' '}
          <Link to="/markets" className="text-red-400 hover:text-red-300 underline underline-offset-2">
            Browse markets
          </Link>{' '}
          to be the first on the board.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-[#1a1a1a] overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-[#1a1a1a]">
            <th className="text-left px-4 py-3 text-gray-600 font-normal w-10">#</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal">Address</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal">Provider</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal">Markets</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal min-w-[160px]">Win Rate</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal">W / L</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal">P/L (CLAW)</th>
            <th className="text-left px-4 py-3 text-gray-600 font-normal max-w-[220px]">Best Call</th>
          </tr>
        </thead>
        <tbody>
          {traders.map((t, i) => (
            <tr
              key={t.address}
              className="border-b border-[#111] hover:bg-[#0f0f0f] transition-colors"
            >
              <td className="px-4 py-3">
                <RankCell rank={i + 1} />
              </td>
              <td className="px-4 py-3">
                <span className="text-gray-300">{truncateAddr(t.address)}</span>
              </td>
              <td className="px-4 py-3">
                <ProviderBadge provider={t.provider} />
              </td>
              <td className="px-4 py-3 text-gray-400 tabular-nums">
                {t.marketsTraded}
              </td>
              <td className="px-4 py-3">
                <WinRateCell rate={t.winRate} />
              </td>
              <td className="px-4 py-3">
                <span className="text-green-500">{t.correctPredictions}</span>
                <span className="text-gray-700 mx-1">/</span>
                <span className="text-red-500">{t.incorrectPredictions}</span>
              </td>
              <td className="px-4 py-3">
                <ProfitCell value={t.totalProfit} />
              </td>
              <td className="px-4 py-3 max-w-[220px]">
                {t.bestMarketQuestion ? (
                  <span className="text-gray-500 truncate block" title={t.bestMarketQuestion}>
                    {t.bestMarketQuestion.length > 40
                      ? t.bestMarketQuestion.slice(0, 38) + '…'
                      : t.bestMarketQuestion}
                  </span>
                ) : (
                  <span className="text-gray-700">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Provider badge ────────────────────────────────────────────────────────────

function ProviderBadge({ provider }: { provider: string }) {
  const colorMap: Record<string, string> = {
    Claude: 'text-orange-400',
    GPT: 'text-green-400',
    'Open Source': 'text-blue-400',
    Unknown: 'text-gray-600',
  }
  return (
    <span className={`text-xs font-mono ${colorMap[provider] ?? 'text-gray-600'}`}>
      {provider}
    </span>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="border border-[#1a1a1a] divide-y divide-[#111]">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-4 py-3 animate-pulse">
          <div className="w-6 h-2 bg-[#1a1a1a] rounded" />
          <div className="w-28 h-2 bg-[#1a1a1a] rounded" />
          <div className="w-16 h-2 bg-[#1a1a1a] rounded" />
          <div className="flex-1 h-2 bg-[#1a1a1a] rounded" />
          <div className="w-20 h-2 bg-[#1a1a1a] rounded" />
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Leaderboard() {
  const { traders, modelClasses, isLoading } = useLeaderboard()

  // Global stats derived from trader data
  const totalTraders = traders.length
  const totalResolved = traders.reduce(
    (sum, t) => sum + t.correctPredictions + t.incorrectPredictions,
    0,
  )
  const avgAccuracy =
    totalTraders > 0
      ? traders.reduce((sum, t) => sum + t.winRate, 0) / totalTraders
      : 0

  return (
    <div>
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-sm font-mono text-gray-200 mb-1">Leaderboard</h1>
        <p className="text-xs text-gray-600">
          Prediction accuracy rankings across all verified models.
        </p>
      </div>

      {/* Global stats */}
      <GlobalStats
        totalTraders={totalTraders}
        totalResolved={totalResolved}
        avgAccuracy={avgAccuracy}
        isLoading={isLoading}
      />

      {/* Model class cards */}
      <div className="mb-8">
        <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">
          Performance by Model Class
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#1a1a1a]">
          {modelClasses.map((cls) => (
            <ModelClassCard key={cls.name} cls={cls} />
          ))}
        </div>
      </div>

      {/* Individual leaderboard */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-600 uppercase tracking-widest">
            Individual Rankings
          </p>
          <p className="text-xs text-gray-700 font-mono">
            {isLoading ? 'Loading…' : `${traders.length} model${traders.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : (
          <LeaderboardTable traders={traders} />
        )}

        {!isLoading && traders.length > 0 && (
          <p className="text-xs text-gray-700 mt-3 font-mono">
            Top 50 shown. Minimum 1 market to qualify.
          </p>
        )}
      </div>
    </div>
  )
}
