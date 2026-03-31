import { useRef, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { useReadContract, useWriteContract } from 'wagmi'
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
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { useContractAddresses } from '../hooks/useContracts'

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
    { label: 'Total Value', value: isLoading ? '…' : fmtClaw(totalValue), sub: 'CLAW' },
    { label: 'Active Positions', value: String(activePositionCount), sub: 'open' },
    { label: 'Markets Won', value: String(totalWins), sub: 'resolved', color: 'text-green-400' },
    { label: 'Markets Lost', value: String(totalLosses), sub: 'resolved', color: 'text-red-400' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#1a1a1a] mb-8">
      {stats.map(({ label, value, sub, color }) => (
        <div key={label} className="bg-[#0a0a0a] p-4">
          <p className="text-xs text-gray-600 mb-1">{label}</p>
          <p className={`text-2xl tabular-nums ${color ?? 'text-white'}`}>{value}</p>
          <p className="text-xs text-gray-700 mt-0.5">{sub}</p>
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
      className="group border border-[#1e1e1e] p-4 block hover:border-[#333] transition-colors"
    >
      <h3 className="text-xs text-gray-300 mb-3 line-clamp-2 group-hover:text-white transition-colors">
        {market?.question ?? 'Loading…'}
      </h3>

      <div className="flex gap-2 mb-3">
        {hasYes && (
          <div className="flex-1 border border-green-900 px-3 py-2 text-center">
            <p className="text-xs text-gray-600 uppercase tracking-wide">YES</p>
            <p className="text-sm tabular-nums text-green-400 mt-0.5">
              {parseFloat(formatEther(yesBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-600 mt-0.5">{yesPct.toFixed(1)}%</p>
            )}
          </div>
        )}
        {hasNo && (
          <div className="flex-1 border border-red-900 px-3 py-2 text-center">
            <p className="text-xs text-gray-600 uppercase tracking-wide">NO</p>
            <p className="text-sm tabular-nums text-red-400 mt-0.5">
              {parseFloat(formatEther(noBalance)).toLocaleString()}
            </p>
            {yesPct != null && (
              <p className="text-xs text-gray-600 mt-0.5">{(100 - yesPct).toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      {/* Flat probability bar */}
      {yesPct != null && (
        <div className="h-px w-full bg-[#1a1a1a] mb-3 overflow-hidden">
          <div
            className="h-full bg-green-600"
            style={{ width: `${yesPct}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[#1a1a1a] pt-2.5">
        <span className="text-xs text-gray-600">Est. value</span>
        <span className="text-xs text-gray-400 tabular-nums">
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
      className="group border border-[#1e1e1e] p-4 block hover:border-[#333] transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-xs text-gray-300 line-clamp-2 flex-1 group-hover:text-white transition-colors">
          {market.question ?? 'Loading…'}
        </h3>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 border ${
            userWon
              ? 'text-green-400 border-green-900'
              : 'text-red-400 border-red-900'
          }`}
        >
          {userWon ? 'WON' : 'LOST'}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
        <span>
          Resolved:{' '}
          <span className={outcomeIsYes ? 'text-green-400' : 'text-red-400'}>
            {outcomeIsYes ? 'YES' : 'NO'}
          </span>
        </span>
        {userWon && payoutEst > 0 && (
          <span className="text-green-400">
            +{fmtClaw(payoutEst)} CLAW
          </span>
        )}
      </div>

      <div className="flex gap-3 text-xs text-gray-700">
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
    <div className="flex items-center gap-3 py-3 border-b border-[#1a1a1a] last:border-0">
      <span className={`text-sm shrink-0 w-4 text-center ${isSent ? 'text-red-500' : 'text-green-500'}`}>
        {isSent ? '↑' : '↓'}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">
          {isSent ? (
            <><span className="text-gray-600">To </span>{truncateAddr(t.to)}</>
          ) : (
            <><span className="text-gray-600">From </span>{truncateAddr(t.from)}</>
          )}
        </p>
        <p className="text-xs text-gray-700 truncate mt-0.5">{t.txHash.slice(0, 18)}…</p>
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm tabular-nums ${isSent ? 'text-red-400' : 'text-green-400'}`}>
          {isSent ? '-' : '+'}{t.amount}
        </p>
        <p className="text-xs text-gray-700">CLAW</p>
      </div>
    </div>
  )
}

// ── Nickname section ──────────────────────────────────────────────────────────

function NicknameSection({ address }: { address: `0x${string}` }) {
  const addrs = useContractAddresses()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const { data: currentNickname, refetch } = useReadContract({
    address: addrs?.modelRegistry as `0x${string}` | undefined,
    abi: modelRegistryAbi,
    functionName: 'nicknames',
    args: [address],
    query: { enabled: !!addrs?.modelRegistry },
  })

  const { writeContractAsync, isPending } = useWriteContract()

  async function handleSet() {
    if (!addrs?.modelRegistry || !input.trim()) return
    try {
      setStatus('idle')
      await writeContractAsync({
        address: addrs.modelRegistry as `0x${string}`,
        abi: modelRegistryAbi,
        functionName: 'setNickname',
        args: [input.trim()],
      })
      setStatus('success')
      setInput('')
      refetch()
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="border border-[#1a1a1a] px-6 py-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="shrink-0">
        <p className="text-xs text-gray-600 uppercase tracking-widest mb-0.5">Nickname</p>
        <p className="text-sm text-gray-300">
          {currentNickname ? currentNickname : <span className="text-gray-600 italic">none set</span>}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value.slice(0, 32)); setStatus('idle') }}
          placeholder="Set nickname…"
          maxLength={32}
          className="bg-[#111] border border-[#2a2a2a] text-gray-200 text-xs px-3 py-2 w-44 placeholder-gray-700 focus:outline-none focus:border-[#444]"
        />
        <button
          onClick={handleSet}
          disabled={isPending || !input.trim()}
          className="text-xs px-4 py-2 border border-[#333] text-gray-300 hover:border-[#555] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Setting…' : 'Set Nickname'}
        </button>
        {status === 'success' && (
          <span className="text-xs text-green-400">Saved</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-400">Failed</span>
        )}
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#1a1a1a] p-6 mb-4">
      <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-5">{title}</h2>
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
        <h1 className="text-sm text-gray-200">Portfolio</h1>
        <p className="text-gray-600 text-xs">Connect your wallet to view your portfolio.</p>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-sm text-gray-200 mb-7">Portfolio</h1>

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1a1a1a] mb-6">
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-6">
          <p className="text-xs text-gray-600 uppercase tracking-widest mb-2">CLAW Balance</p>
          <p className="text-3xl tabular-nums text-white">
            {baseLoading ? '…' : fmtClaw(clawBalance)}
          </p>
          <p className="text-xs text-gray-600 mt-2">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </p>
          {totalPositionValue > 0 && (
            <p className="text-xs text-gray-500 mt-1.5">
              +{fmtClaw(totalPositionValue)} CLAW in open positions
            </p>
          )}
        </div>

        <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-6">
          <p className="text-xs text-gray-600 uppercase tracking-widest mb-2">Verification Status</p>
          <div className="flex items-center gap-2 mt-1">
            {verLoading ? (
              <span className="text-gray-600 text-xs">Checking…</span>
            ) : isVerified ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <span className="text-green-400 text-sm">Verified</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                <span className="text-yellow-400 text-sm">Not Verified</span>
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

      {/* Nickname */}
      <NicknameSection address={address!} />

      {/* Send CLAW */}
      {isVerified && (
        <div className="mb-6">
          <TransferPanel clawBalance={clawBalance} />
        </div>
      )}

      {/* Active positions */}
      <Section title="Active Positions">
        {markets.length === 0 ? (
          <p className="text-gray-600 text-xs">
            No markets exist yet.{' '}
            <Link to="/markets" className="text-red-400 hover:text-red-300 underline underline-offset-2">
              Create one
            </Link>{' '}
            to get started.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1a1a1a]">
              {markets.map((addr) => (
                <ActivePositionCard
                  key={addr}
                  marketAddress={addr}
                  onStats={handleStats}
                />
              ))}
            </div>
            {activePositionCount === 0 && (
              <p className="text-gray-600 text-xs mt-4">
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
          <p className="text-gray-600 text-xs">No resolved markets yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1a1a1a]">
              {markets.map((addr) => (
                <ResolvedPositionCard key={addr} marketAddress={addr} />
              ))}
            </div>
            {totalWins === 0 && totalLosses === 0 && (
              <p className="text-gray-600 text-xs mt-4">No resolved positions yet.</p>
            )}
          </>
        )}
      </Section>

      {/* Recent CLAW transfers */}
      <Section title="Recent CLAW Transfers">
        {transfersLoading ? (
          <p className="text-gray-600 text-xs">Loading transfers…</p>
        ) : transfersError ? (
          <p className="text-red-400 text-xs">Failed to load transfer history.</p>
        ) : transfers.length === 0 ? (
          <p className="text-gray-600 text-xs">No CLAW transfer history found.</p>
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
