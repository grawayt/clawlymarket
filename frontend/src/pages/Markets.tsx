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

// ── MarketCard ───────────────────────────────────────────────────────────────

function MarketCard({ address }: { address: `0x${string}` }) {
  const { market, isLoading } = useMarketData(address)

  if (isLoading || !market?.question) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 animate-pulse">
        <div className="h-5 bg-gray-800 rounded w-3/4 mb-3" />
        <div className="h-4 bg-gray-800 rounded w-1/2" />
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

  return (
    <Link
      to={`/markets/${address}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-6 block hover:border-gray-600 transition-colors"
    >
      <h3 className="text-lg font-semibold text-gray-100 mb-2">{market.question}</h3>

      {isResolved ? (
        <div className="flex items-center gap-2 mb-3">
          <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300">
            Resolved
          </span>
          <span className="text-sm font-medium text-green-400">
            {market.outcome === 0n ? 'YES' : 'NO'}
          </span>
        </div>
      ) : (
        <div className="flex gap-3 mb-3">
          <div className="flex-1 rounded bg-green-900/30 border border-green-800/50 px-3 py-2 text-center">
            <p className="text-xs text-green-400">YES</p>
            <p className="text-lg font-bold text-green-300">{yesPct?.toFixed(1) ?? '--'}%</p>
          </div>
          <div className="flex-1 rounded bg-red-900/30 border border-red-800/50 px-3 py-2 text-center">
            <p className="text-xs text-red-400">NO</p>
            <p className="text-lg font-bold text-red-300">{noPct?.toFixed(1) ?? '--'}%</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Liquidity:{' '}
          {market.totalCollateral != null
            ? `${parseFloat(formatEther(market.totalCollateral)).toLocaleString()} CLAW`
            : '--'}
        </span>
        {resolutionDate && (
          <span>Resolves: {resolutionDate.toLocaleDateString()}</span>
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-lg w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Create Market</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl">
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will X happen by Y date?"
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Days until resolution</label>
            <input
              type="number"
              min="1"
              value={daysUntilResolution}
              onChange={(e) => setDaysUntilResolution(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial liquidity (CLAW)</label>
            <input
              type="number"
              min="1"
              value={liquidity}
              onChange={(e) => setLiquidity(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Your balance: {parseFloat(clawBalance).toLocaleString()} CLAW
            </p>
          </div>

          {error && (
            <div className="rounded border border-red-800 bg-red-900/20 p-2">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!question.trim() || isPending || parseFloat(liquidity) <= 0}
            className="w-full rounded bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Creating...' : 'Create Market'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MarketSummaryLoader ──────────────────────────────────────────────────────
// Invisible component that fetches summary data for one market address and
// calls onReady once loaded, so Markets can collect summaries for filtering.

function MarketSummaryLoader({
  address,
  onReady,
}: {
  address: `0x${string}`
  onReady: (summary: MarketSummary) => void
}) {
  const { summary, isLoading } = useMarketSummary(address)

  // Call onReady whenever summary is available — parent de-dupes by address
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

  // Search / filter / sort state
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('newest')

  // Collected summaries keyed by address (filled by MarketSummaryLoader children)
  const [summaries, setSummaries] = useState<Record<string, MarketSummary>>({})

  const handleSummaryReady = (summary: MarketSummary) => {
    setSummaries((prev) => {
      // Avoid re-render if data is identical
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

  // Build filtered + sorted address list
  const filteredAddresses = useMemo(() => {
    // If summaries aren't loaded yet, preserve original order
    const list = [...markets]

    // Apply search filter (case-insensitive substring)
    const searchTrimmed = search.trim().toLowerCase()
    const afterSearch = searchTrimmed
      ? list.filter((addr) => {
          const q = summaries[addr]?.question?.toLowerCase() ?? ''
          return q.includes(searchTrimmed)
        })
      : list

    // Apply status filter
    const afterFilter = afterSearch.filter((addr) => {
      if (filterMode === 'all') return true
      const resolved = summaries[addr]?.resolved
      if (filterMode === 'open') return resolved === false
      if (filterMode === 'resolved') return resolved === true
      return true
    })

    // Apply sort
    const sorted = [...afterFilter].sort((a, b) => {
      const sa = summaries[a]
      const sb = summaries[b]

      if (sortMode === 'newest') {
        // Original array order descending (last created = highest index = first shown)
        return markets.indexOf(b) - markets.indexOf(a)
      }

      if (sortMode === 'liquidity') {
        const la = sa?.totalCollateral ?? 0n
        const lb = sb?.totalCollateral ?? 0n
        return lb > la ? 1 : lb < la ? -1 : 0
      }

      if (sortMode === 'ending-soon') {
        // Unresolved only; resolved markets sink to bottom
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

  // ── pill helpers ────────────────────────────────────────────────────────────
  const filterPillClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-red-600 text-white border-red-600'
        : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-300'
    }`

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Markets</h1>
        {isConnected && isVerified && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
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

      {/* Invisible summary loaders — only mount when markets are available */}
      {markets.map((addr) => (
        <MarketSummaryLoader key={addr} address={addr} onReady={handleSummaryReady} />
      ))}

      {/* Search + filter controls (only shown when there are markets) */}
      {!isLoading && markets.length > 0 && addrs && (
        <div className="mb-6 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-500 pointer-events-none">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="w-full rounded border border-gray-700 bg-gray-900 pl-9 pr-4 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-red-500 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-3 flex items-center text-gray-500 hover:text-gray-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filter pills + sort dropdown */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Filter pills */}
            <div className="flex items-center gap-2">
              <button
                className={filterPillClass(filterMode === 'all')}
                onClick={() => setFilterMode('all')}
              >
                All
              </button>
              <button
                className={filterPillClass(filterMode === 'open')}
                onClick={() => setFilterMode('open')}
              >
                Open
              </button>
              <button
                className={filterPillClass(filterMode === 'resolved')}
                onClick={() => setFilterMode('resolved')}
              >
                Resolved
              </button>
            </div>

            {/* Sort dropdown */}
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 focus:border-red-500 focus:outline-none cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="liquidity">Most Liquidity</option>
              <option value="ending-soon">Ending Soon</option>
            </select>
          </div>
        </div>
      )}

      {/* Main content area */}
      {!addrs ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400 text-lg">Unsupported network</p>
          <p className="text-gray-500 text-sm mt-2">
            Switch to a supported network (Anvil local, Arbitrum Sepolia, or Arbitrum) to see
            markets.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400">Loading markets...</p>
        </div>
      ) : markets.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400 text-lg">No markets yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            {isVerified
              ? 'Click "Create Market" to launch the first prediction market.'
              : 'Verify your identity to create and trade on markets.'}
          </p>
        </div>
      ) : filteredAddresses.length === 0 ? (
        /* Empty state for active filters */
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400 text-lg">No markets match your filters.</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-4 rounded border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-gray-100 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredAddresses.map((addr) => (
            <MarketCard key={addr} address={addr} />
          ))}
        </div>
      )}
    </div>
  )
}
