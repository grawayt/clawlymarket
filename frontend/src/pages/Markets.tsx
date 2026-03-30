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
    <div className="h-1 w-full bg-[#1a1a1a] overflow-hidden">
      <div
        className="h-full bg-green-600 transition-all duration-700"
        style={{ width: `${yesPct}%` }}
      />
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── MarketCard ───────────────────────────────────────────────────────────────

function MarketCard({ address }: { address: `0x${string}` }) {
  const { market, isLoading } = useMarketData(address)

  if (isLoading || !market?.question) {
    return (
      <div className="border border-[#1e1e1e] p-5">
        <div className="h-4 bg-[#1a1a1a] rounded w-3/4 mb-3" />
        <div className="h-3 bg-[#1a1a1a] rounded w-1/2 mb-4" />
        <div className="h-1 bg-[#1a1a1a] w-full" />
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
      className="group border border-[#1e1e1e] p-5 block hover:border-[#333] transition-colors"
    >
      {/* Question */}
      <h3 className="text-sm text-gray-200 mb-4 leading-snug line-clamp-2 group-hover:text-white transition-colors">
        {market.question}
      </h3>

      {isResolved ? (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Resolved</span>
          <span className={`text-xs font-bold ${market.outcome === 0n ? 'text-green-400' : 'text-red-400'}`}>
            {market.outcome === 0n ? 'YES' : 'NO'}
          </span>
        </div>
      ) : (
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-gray-600">YES</span>
              <span className="text-lg tabular-nums text-green-400">
                {yesPct?.toFixed(1) ?? '--'}%
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg tabular-nums text-red-400">
                {noPct?.toFixed(1) ?? '--'}%
              </span>
              <span className="text-xs text-gray-600">NO</span>
            </div>
          </div>
          {yesPct != null && <ProbabilityBar yesPct={yesPct} />}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-600 border-t border-[#1a1a1a] pt-3 mt-1">
        <span>
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

      await writeContractAsync({
        address: addrs.clawliaToken,
        abi: clawliaTokenAbi,
        functionName: 'approve',
        args: [addrs.marketFactory, liquidityWei],
      })

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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f0f0f] border border-[#222] p-6 max-w-lg w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-sm text-gray-200">Create Market</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will X happen by Y date?"
              className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-[#444] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">Days until resolution</label>
            <input
              type="number"
              min="1"
              value={daysUntilResolution}
              onChange={(e) => setDaysUntilResolution(e.target.value)}
              className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-sm text-gray-200 focus:border-[#444] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">Initial liquidity (CLAW)</label>
            <input
              type="number"
              min="1"
              value={liquidity}
              onChange={(e) => setLiquidity(e.target.value)}
              className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-sm text-gray-200 focus:border-[#444] focus:outline-none transition-colors"
            />
            <p className="text-xs text-gray-600 mt-1.5">
              Balance: {parseFloat(clawBalance).toLocaleString()} CLAW
            </p>
          </div>

          {error && (
            <div className="border border-red-900 bg-red-950/30 p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!question.trim() || isPending || parseFloat(liquidity) <= 0}
            className="w-full border border-red-700 px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

  const filterBtnClass = (active: boolean) =>
    `px-3 py-1 text-xs border transition-colors cursor-pointer ${
      active
        ? 'border-[#444] text-white'
        : 'border-[#1e1e1e] text-gray-500 hover:border-[#333] hover:text-gray-300'
    }`

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-sm text-gray-200">Markets</h1>
          {markets.length > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">{markets.length} market{markets.length !== 1 ? 's' : ''} deployed</p>
          )}
        </div>
        {isConnected && isVerified && (
          <button
            onClick={() => setShowCreate(true)}
            className="border border-red-700 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors"
          >
            + Create Market
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
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets…"
            className="w-full border border-[#1e1e1e] bg-[#0a0a0a] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-[#444] focus:outline-none transition-colors"
          />

          {/* Filter pills + sort dropdown */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button className={filterBtnClass(filterMode === 'all')} onClick={() => setFilterMode('all')}>All</button>
              <button className={filterBtnClass(filterMode === 'open')} onClick={() => setFilterMode('open')}>Open</button>
              <button className={filterBtnClass(filterMode === 'resolved')} onClick={() => setFilterMode('resolved')}>Resolved</button>
            </div>

            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="border border-[#1e1e1e] bg-[#0a0a0a] px-3 py-1.5 text-xs text-gray-400 focus:border-[#444] focus:outline-none cursor-pointer"
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
        <div className="border border-[#1e1e1e] p-12 text-center">
          <p className="text-gray-400 text-sm">Unsupported network</p>
          <p className="text-gray-600 text-xs mt-2">Switch to Anvil local, Arbitrum Sepolia, or Arbitrum to see markets.</p>
        </div>
      ) : isLoading ? (
        <div className="border border-[#1e1e1e] p-12 text-center">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <Spinner />
            <p className="text-xs">Loading markets...</p>
          </div>
        </div>
      ) : markets.length === 0 ? (
        <div className="border border-[#1e1e1e] p-12 text-center">
          <p className="text-gray-400 text-sm mb-2">No markets yet.</p>
          <p className="text-gray-600 text-xs">
            {isVerified
              ? 'Click "Create Market" to launch the first prediction market.'
              : 'Verify your identity to create and trade on markets.'}
          </p>
        </div>
      ) : filteredAddresses.length === 0 ? (
        <div className="border border-[#1e1e1e] p-12 text-center">
          <p className="text-gray-400 text-sm mb-4">No markets match your filters.</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="border border-[#2a2a2a] px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:border-[#444] transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1a1a1a]">
          {filteredAddresses.map((addr) => (
            <MarketCard key={addr} address={addr} />
          ))}
        </div>
      )}
    </div>
  )
}
