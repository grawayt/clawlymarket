import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useWriteContract } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { useMarkets } from '../hooks/useMarketFactory'
import { useMarketData } from '../hooks/useMarket'
import { useMarketSummary } from '../hooks/useMarketSummary'
import type { MarketSummary } from '../hooks/useMarketSummary'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'
import { useContractAddresses } from '../hooks/useContracts'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { marketFactoryAbi } from '../contracts/MarketFactoryAbi'

// ── Types ────────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'open' | 'resolved'
type SortMode = 'newest' | 'liquidity' | 'ending-soon'

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbabilityBar({ yesPct }: { yesPct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-gray-800">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${yesPct}%`,
          background: `linear-gradient(90deg, #16a34a ${Math.max(0, yesPct - 40)}%, #22c55e)`,
        }}
      />
    </div>
  )
}

// ── MarketCard ───────────────────────────────────────────────────────────────

function MarketCard({ address }: { address: `0x${string}` }) {
  const { market, isLoading } = useMarketData(address)

  if (isLoading || !market?.question) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-5 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-3/4 mb-3" />
        <div className="h-3 bg-gray-800 rounded w-1/2 mb-4" />
        <div className="h-1.5 bg-gray-800 rounded w-full" />
      </div>
    )
  }

  const yesProbBps = market.probability?.[0]
  const yesPct = yesProbBps != null ? Number(yesProbBps) / 100 : null
  const noPct = yesPct != null ? 100 - yesPct : null
  const isResolved = market.resolved
  const resolutionDate = market.resolutionTimestamp
    ? new Date(Number(market.resolutionTimestamp) * 1000)
    : null

  const liquidity =
    market.totalCollateral != null
      ? parseFloat(formatEther(market.totalCollateral))
      : null

  return (
    <Link
      to={`/markets/${address}`}
      className="group rounded-xl border border-white/[0.06] bg-[#0d0d18] p-5 block hover:border-red-500/25 hover:bg-[#110d18] transition-all duration-200"
    >
      {/* Question */}
      <h3 className="text-sm font-semibold text-gray-100 mb-3 leading-snug line-clamp-2 group-hover:text-white transition-colors">
        {market.question}
      </h3>

      {isResolved ? (
        <div className="flex items-center gap-2 mb-4">
          <span className="rounded-full bg-gray-700/60 border border-gray-600/40 px-2.5 py-0.5 text-xs font-medium text-gray-400">
            Resolved
          </span>
          <span className={`text-sm font-bold ${market.outcome === 0n ? 'text-green-400' : 'text-red-400'}`}>
            {market.outcome === 0n ? 'YES' : 'NO'}
          </span>
        </div>
      ) : (
        <div className="mb-4">
          {/* YES / NO percentage chips */}
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-green-500 uppercase tracking-wide">YES</span>
              <span className="text-xl font-bold text-green-400 tabular-nums">
                {yesPct?.toFixed(1) ?? '--'}%
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-red-400 tabular-nums">
                {noPct?.toFixed(1) ?? '--'}%
              </span>
              <span className="text-xs font-medium text-red-500 uppercase tracking-wide">NO</span>
            </div>
          </div>
          {/* Gradient probability bar */}
          {yesPct != null && <ProbabilityBar yesPct={yesPct} />}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-600 border-t border-white/[0.04] pt-3 mt-1">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          {liquidity != null ? `${liquidity.toLocaleString()} CLAW` : '—'}
        </span>
        {resolutionDate && (
          <span>{resolutionDate.toLocaleDateString()}</span>
        )}
      </div>
    </Link>
  )
}

// ── CreateMarketForm ─────────────────────────────────────────────────────────

function CreateMarketForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const addrs = useContractAddresses()
  const { writeContractAsync } = useWriteContract()
  const { formatted: clawBalance } = useClawliaBalance()
  const [question, setQuestion] = useState('')
  const [daysUntilResolution, setDaysUntilResolution] = useState('30')
  const [liquidity, setLiquidity] = useState('100')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)
  const { address } = useAccount()

  const handleCreate = async () => {
    if (!addrs || !address) return
    setError('')
    setIsPending(true)

    try {
      const liquidityWei = parseEther(liquidity)
      const resolutionTs = BigInt(
        Math.floor(Date.now() / 1000) + parseInt(daysUntilResolution) * 86400,
      )

      // Approve factory to spend CLAW
      await writeContractAsync({
        address: addrs.clawliaToken,
        abi: clawliaTokenAbi,
        functionName: 'approve',
        args: [addrs.marketFactory, liquidityWei],
      })

      // Create market
      await writeContractAsync({
        address: addrs.marketFactory,
        abi: marketFactoryAbi,
        functionName: 'createMarket',
        args: [question, resolutionTs, address, liquidityWei],
      })

      onCreated()
      onClose()
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || 'Failed to create market')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d0d18] border border-white/[0.08] rounded-xl p-6 max-w-lg w-full shadow-2xl shadow-black/50">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-gray-100">Create Market</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/[0.07] bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.08] transition-colors flex items-center justify-center text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will X happen by Y date?"
              className="w-full rounded-lg border border-white/[0.07] bg-[#070710] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-red-500/60 focus:outline-none focus:bg-[#0a0a18] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Days until resolution</label>
            <input
              type="number"
              min="1"
              value={daysUntilResolution}
              onChange={(e) => setDaysUntilResolution(e.target.value)}
              className="w-full rounded-lg border border-white/[0.07] bg-[#070710] px-3 py-2.5 text-sm text-gray-200 focus:border-red-500/60 focus:outline-none focus:bg-[#0a0a18] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Initial liquidity (CLAW)</label>
            <input
              type="number"
              min="1"
              value={liquidity}
              onChange={(e) => setLiquidity(e.target.value)}
              className="w-full rounded-lg border border-white/[0.07] bg-[#070710] px-3 py-2.5 text-sm text-gray-200 focus:border-red-500/60 focus:outline-none focus:bg-[#0a0a18] transition-colors"
            />
            <p className="text-xs text-gray-600 mt-1.5">
              Balance: {parseFloat(clawBalance).toLocaleString()} CLAW
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!question.trim() || isPending || parseFloat(liquidity) <= 0}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-red-900/20"
          >
            {isPending ? 'Creating...' : 'Create Market'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MarketSummaryLoader ──────────────────────────────────────────────────────

function MarketSummaryLoader({
  address,
  onReady,
}: {
  address: `0x${string}`
  onReady: (summary: MarketSummary) => void
}) {
  const { summary, isLoading } = useMarketSummary(address)

  if (!isLoading && summary?.question !== undefined) {
    onReady(summary)
  }

  return null
}

// ── Markets (page) ───────────────────────────────────────────────────────────

export default function Markets() {
  const { isConnected } = useAccount()
  const { markets, isLoading, refetch } = useMarkets()
  const { isVerified } = useIsVerified()
  const addrs = useContractAddresses()
  const [showCreate, setShowCreate] = useState(false)

  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('newest')

  const [summaries, setSummaries] = useState<Record<string, MarketSummary>>({})

  const handleSummaryReady = (summary: MarketSummary) => {
    setSummaries((prev) => {
      const existing = prev[summary.address]
      if (
        existing &&
        existing.question === summary.question &&
        existing.resolved === summary.resolved &&
        existing.totalCollateral === summary.totalCollateral &&
        existing.resolutionTimestamp === summary.resolutionTimestamp
      ) {
        return prev
      }
      return { ...prev, [summary.address]: summary }
    })
  }

  const filteredAddresses = useMemo(() => {
    const list = [...markets]

    const searchTrimmed = search.trim().toLowerCase()
    const afterSearch = searchTrimmed
      ? list.filter((addr) => {
          const q = summaries[addr]?.question?.toLowerCase() ?? ''
          return q.includes(searchTrimmed)
        })
      : list

    const afterFilter = afterSearch.filter((addr) => {
      if (filterMode === 'all') return true
      const resolved = summaries[addr]?.resolved
      if (filterMode === 'open') return resolved === false
      if (filterMode === 'resolved') return resolved === true
      return true
    })

    const sorted = [...afterFilter].sort((a, b) => {
      const sa = summaries[a]
      const sb = summaries[b]

      if (sortMode === 'newest') {
        return markets.indexOf(b) - markets.indexOf(a)
      }
      if (sortMode === 'liquidity') {
        const la = sa?.totalCollateral ?? 0n
        const lb = sb?.totalCollateral ?? 0n
        return lb > la ? 1 : lb < la ? -1 : 0
      }
      if (sortMode === 'ending-soon') {
        const ra = sa?.resolved ?? false
        const rb = sb?.resolved ?? false
        if (ra && !rb) return 1
        if (!ra && rb) return -1
        const ta = sa?.resolutionTimestamp ?? 0n
        const tb = sb?.resolutionTimestamp ?? 0n
        return ta < tb ? -1 : ta > tb ? 1 : 0
      }
      return 0
    })

    return sorted
  }, [markets, summaries, search, filterMode, sortMode])

  const hasActiveFilters = search.trim() !== '' || filterMode !== 'all' || sortMode !== 'newest'

  const clearFilters = () => {
    setSearch('')
    setFilterMode('all')
    setSortMode('newest')
  }

  const filterPillClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 cursor-pointer ${
      active
        ? 'bg-red-600 text-white border-red-600 shadow-sm shadow-red-900/30'
        : 'bg-white/[0.03] text-gray-400 border-white/[0.07] hover:border-white/15 hover:text-gray-300 hover:bg-white/[0.06]'
    }`

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Markets</h1>
          {markets.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">{markets.length} market{markets.length !== 1 ? 's' : ''} deployed</p>
          )}
        </div>
        {isConnected && isVerified && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors shadow-lg shadow-red-900/20 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Market
          </button>
        )}
      </div>

      {/* Create market modal */}
      {showCreate && (
        <CreateMarketForm
          onClose={() => setShowCreate(false)}
          onCreated={() => refetch()}
        />
      )}

      {/* Invisible summary loaders */}
      {markets.map((addr) => (
        <MarketSummaryLoader key={addr} address={addr} onReady={handleSummaryReady} />
      ))}

      {/* Search + filter controls */}
      {!isLoading && markets.length > 0 && addrs && (
        <div className="mb-6 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-gray-600 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="w-full rounded-lg border border-white/[0.07] bg-[#0d0d18] pl-10 pr-10 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-red-500/50 focus:outline-none focus:bg-[#0f0f1c] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-3 flex items-center text-gray-600 hover:text-gray-400 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filter pills + sort dropdown */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button className={filterPillClass(filterMode === 'all')} onClick={() => setFilterMode('all')}>All</button>
              <button className={filterPillClass(filterMode === 'open')} onClick={() => setFilterMode('open')}>Open</button>
              <button className={filterPillClass(filterMode === 'resolved')} onClick={() => setFilterMode('resolved')}>Resolved</button>
            </div>

            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded-lg border border-white/[0.07] bg-[#0d0d18] px-3 py-1.5 text-xs text-gray-400 focus:border-red-500/50 focus:outline-none cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="liquidity">Most Liquidity</option>
              <option value="ending-soon">Ending Soon</option>
            </select>
          </div>
        </div>
      )}

      {/* Main content */}
      {!addrs ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-12 text-center">
          <p className="text-gray-400 text-base font-medium">Unsupported network</p>
          <p className="text-gray-600 text-sm mt-2">Switch to Anvil local, Arbitrum Sepolia, or Arbitrum to see markets.</p>
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-12 text-center">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <svg className="w-4 h-4 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Loading markets...</p>
          </div>
        </div>
      ) : markets.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-12 text-center">
          <p className="text-gray-300 text-base font-medium mb-2">No markets yet.</p>
          <p className="text-gray-600 text-sm">
            {isVerified
              ? 'Click "Create Market" to launch the first prediction market.'
              : 'Verify your identity to create and trade on markets.'}
          </p>
        </div>
      ) : filteredAddresses.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0d0d18] p-12 text-center">
          <p className="text-gray-400 text-base font-medium mb-4">No markets match your filters.</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-white/[0.07] transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAddresses.map((addr) => (
            <MarketCard key={addr} address={addr} />
          ))}
        </div>
      )}
    </div>
  )
}
