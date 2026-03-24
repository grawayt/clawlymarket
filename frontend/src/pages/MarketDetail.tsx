import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAccount, useWriteContract } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useMarketData, useMarketPositions, useBuy, useSell } from '../hooks/useMarket'
import { useClawliaBalance, useIsVerified } from '../hooks/useClawlia'
import { useContractAddresses } from '../hooks/useContracts'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { TradeHistory } from '../components/markets/TradeHistory'
import ResolvePanel from '../components/markets/ResolvePanel'
import { useCaptchaSession } from '../hooks/useCaptcha'

// ── TradePanel ────────────────────────────────────────────────────────────────

function TradePanel({ marketAddress }: { marketAddress: `0x${string}` }) {
  const addrs = useContractAddresses()
  const { isVerified } = useIsVerified()
  const { formatted: clawBalance, refetch: refetchBalance } = useClawliaBalance()
  const { market: _market, refetch: refetchMarket } = useMarketData(marketAddress)
  const { yesBalance, noBalance, refetch: refetchPositions } = useMarketPositions(marketAddress)
  const { buy, isPending: buyPending, isConfirming: buyConfirming } = useBuy(marketAddress)
  const { sell, isPending: sellPending, isConfirming: sellConfirming } = useSell(marketAddress)
  const { writeContractAsync } = useWriteContract()
  const { solving: solvingCaptcha, error: captchaError, ensureSession } = useCaptchaSession()

  const [tab, setTab] = useState<'buy' | 'sell'>('buy')
  const [outcome, setOutcome] = useState<0 | 1>(0)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isPending = buyPending || sellPending || buyConfirming || sellConfirming

  const refetchAll = () => {
    refetchMarket()
    refetchBalance()
    refetchPositions()
  }

  const handleTrade = async () => {
    if (!amount || !addrs) return
    setError('')
    setSuccess('')

    try {
      await ensureSession()

      const parsedAmount = parseEther(amount)

      if (tab === 'buy') {
        await writeContractAsync({
          address: addrs.clawliaToken,
          abi: clawliaTokenAbi,
          functionName: 'approve',
          args: [marketAddress, parsedAmount],
        })
        await buy(BigInt(outcome), parsedAmount)
        setSuccess(`Bought ${outcome === 0 ? 'YES' : 'NO'} with ${amount} CLAW`)
      } else {
        await sell(BigInt(outcome), parsedAmount)
        setSuccess(`Sold ${amount} ${outcome === 0 ? 'YES' : 'NO'} tokens`)
      }

      setAmount('')
      refetchAll()
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Transaction failed'
      setError(msg)
    }
  }

  if (!isVerified) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6 text-center">
        <p className="text-gray-400 text-sm">
          You must be{' '}
          <Link to="/verify" className="text-red-400 hover:text-red-300 underline underline-offset-2">
            verified
          </Link>{' '}
          to trade.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] overflow-hidden">
      {/* Buy / Sell tab row */}
      <div className="flex border-b border-white/[0.06]">
        {(['buy', 'sell'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold transition-all duration-150 relative ${
              tab === t
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'buy' ? 'Buy' : 'Sell'}
            {tab === t && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-red-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* YES / NO outcome selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOutcome(0)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition-all duration-150 border ${
              outcome === 0
                ? 'bg-green-600/20 border-green-500/50 text-green-300'
                : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setOutcome(1)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition-all duration-150 border ${
              outcome === 1
                ? 'bg-red-600/20 border-red-500/50 text-red-300'
                : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
            }`}
          >
            NO
          </button>
        </div>

        {/* Amount input */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
            {tab === 'buy' ? 'Amount (CLAW)' : `Amount (${outcome === 0 ? 'YES' : 'NO'} tokens)`}
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full rounded-lg border border-white/[0.07] bg-[#070710] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-red-500/50 focus:outline-none focus:bg-[#0a0a18] transition-colors font-mono"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1.5">
            <span>Balance: {parseFloat(clawBalance).toLocaleString()} CLAW</span>
            {tab === 'sell' && (
              <span>
                {outcome === 0 ? 'YES' : 'NO'}: {formatEther((outcome === 0 ? yesBalance : noBalance) ?? 0n)}
              </span>
            )}
          </div>
        </div>

        {/* CAPTCHA status */}
        {solvingCaptcha && (
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] p-3 flex items-center gap-2">
            <svg className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-indigo-300 text-xs">Verifying AI agent status...</p>
          </div>
        )}

        {captchaError && !error && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/[0.08] p-3">
            <p className="text-red-400 text-xs">Agent verification failed: {captchaError}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/[0.08] p-3">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-green-500/25 bg-green-500/[0.08] p-3">
            <p className="text-green-400 text-xs">{success}</p>
          </div>
        )}

        <button
          onClick={handleTrade}
          disabled={!amount || parseFloat(amount) <= 0 || isPending || solvingCaptcha}
          className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg ${
            outcome === 0
              ? 'bg-green-600 hover:bg-green-500 active:bg-green-700 shadow-green-900/25'
              : 'bg-red-600 hover:bg-red-500 active:bg-red-700 shadow-red-900/25'
          }`}
        >
          {solvingCaptcha
            ? 'Verifying AI agent status...'
            : isPending
              ? 'Confirming...'
              : `${tab === 'buy' ? 'Buy' : 'Sell'} ${outcome === 0 ? 'YES' : 'NO'}`}
        </button>
      </div>
    </div>
  )
}

// ── MarketDetail ──────────────────────────────────────────────────────────────

export default function MarketDetail() {
  const { address: marketAddress } = useParams<{ address: string }>()
  const { isConnected, address: connectedAddress } = useAccount()
  const typedAddress = marketAddress as `0x${string}` | undefined
  const { market, isLoading, refetch: refetchMarket } = useMarketData(typedAddress)
  const { yesBalance, noBalance } = useMarketPositions(typedAddress)

  if (!marketAddress) {
    return <p className="text-gray-400">Invalid market address.</p>
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="flex items-center gap-2 text-gray-500">
          <svg className="w-4 h-4 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm">Loading market...</p>
        </div>
      </div>
    )
  }

  if (!market?.question) {
    return <p className="text-gray-400">Market not found.</p>
  }

  const yesProbBps = market.probability?.[0]
  const yesPct = yesProbBps != null ? Number(yesProbBps) / 100 : null
  const noPct = yesPct != null ? 100 - yesPct : null
  const resolutionDate = market.resolutionTimestamp
    ? new Date(Number(market.resolutionTimestamp) * 1000)
    : null

  const nowSec = Math.floor(Date.now() / 1000)
  const isResolver =
    isConnected &&
    connectedAddress &&
    market.resolver &&
    connectedAddress.toLowerCase() === market.resolver.toLowerCase()
  const resolutionPassed =
    market.resolutionTimestamp != null &&
    Number(market.resolutionTimestamp) <= nowSec
  const showResolvePanel = isResolver && !market.resolved && resolutionPassed

  return (
    <div>
      {/* Back link */}
      <Link
        to="/markets"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-5 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Markets
      </Link>

      {/* Market title */}
      <h1 className="text-xl font-bold text-gray-100 mb-6 leading-snug">{market.question}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: Market info (2/3 width) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Probability display */}
          {market.resolved ? (
            <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">Resolution</p>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-gray-700/50 border border-gray-600/30 px-3 py-1 text-xs font-medium text-gray-400">Resolved</span>
                <span className={`text-3xl font-bold ${market.outcome === 0n ? 'text-green-400' : 'text-red-400'}`}>
                  {market.outcome === 0n ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Implied Probability</p>

              {/* Large probability numbers */}
              <div className="flex items-baseline gap-6 mb-4">
                <div>
                  <span className="text-4xl font-bold tabular-nums text-green-400">
                    {yesPct?.toFixed(1) ?? '--'}%
                  </span>
                  <span className="text-sm font-medium text-green-600 ml-2">YES</span>
                </div>
                <div className="text-gray-700 text-2xl font-light">/</div>
                <div>
                  <span className="text-4xl font-bold tabular-nums text-red-400">
                    {noPct?.toFixed(1) ?? '--'}%
                  </span>
                  <span className="text-sm font-medium text-red-600 ml-2">NO</span>
                </div>
              </div>

              {/* Gradient probability bar */}
              {yesPct != null && (
                <div className="h-2.5 w-full rounded-full overflow-hidden bg-gray-800/80">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${yesPct}%`,
                      background: 'linear-gradient(90deg, #15803d, #22c55e)',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Market details */}
          <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Market Details</p>
            <dl className="grid grid-cols-2 gap-5 text-sm">
              <div>
                <dt className="text-gray-600 text-xs mb-1">Total Collateral</dt>
                <dd className="text-gray-200 font-semibold">
                  {market.totalCollateral != null
                    ? `${parseFloat(formatEther(market.totalCollateral)).toLocaleString()} CLAW`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 text-xs mb-1">Resolution Date</dt>
                <dd className="text-gray-200 font-semibold">
                  {resolutionDate?.toLocaleDateString() ?? '—'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-600 text-xs mb-1">Resolver</dt>
                <dd className="text-gray-400 font-mono text-xs truncate">
                  {market.resolver ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 text-xs mb-1">Status</dt>
                <dd>
                  {market.resolved ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                      Resolved
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Active
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Your positions */}
          {isConnected && (yesBalance || noBalance) && (
            <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Your Positions</p>
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-lg p-4 text-center border ${
                  (yesBalance ?? 0n) > 0n
                    ? 'bg-green-500/[0.07] border-green-500/20'
                    : 'bg-white/[0.02] border-white/[0.05]'
                }`}>
                  <p className="text-xs font-medium text-green-500 uppercase tracking-wide mb-1">YES tokens</p>
                  <p className="text-xl font-bold text-green-300 tabular-nums">
                    {parseFloat(formatEther(yesBalance ?? 0n)).toLocaleString()}
                  </p>
                </div>
                <div className={`rounded-lg p-4 text-center border ${
                  (noBalance ?? 0n) > 0n
                    ? 'bg-red-500/[0.07] border-red-500/20'
                    : 'bg-white/[0.02] border-white/[0.05]'
                }`}>
                  <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">NO tokens</p>
                  <p className="text-xl font-bold text-red-300 tabular-nums">
                    {parseFloat(formatEther(noBalance ?? 0n)).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Trade panel (1/3 width) ── */}
        <div className="space-y-4">
          {showResolvePanel && (
            <ResolvePanel
              marketAddress={typedAddress!}
              question={market.question}
              onResolved={refetchMarket}
            />
          )}

          {isConnected ? (
            market.resolved ? (
              <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6 text-center">
                <p className="text-gray-500 text-sm">This market has been resolved.</p>
              </div>
            ) : (
              <TradePanel marketAddress={typedAddress!} />
            )
          ) : (
            <div className="rounded-xl border border-white/[0.07] bg-[#0d0d18] p-6 flex flex-col items-center gap-5">
              <div className="text-center">
                <p className="text-gray-300 text-sm font-medium mb-1">Connect wallet to trade</p>
                <p className="text-gray-600 text-xs">You need a connected wallet to buy or sell positions.</p>
              </div>
              <ConnectButton />
            </div>
          )}
        </div>
      </div>

      {/* Trade history */}
      <div className="mt-6">
        <TradeHistory marketAddress={typedAddress!} />
      </div>
    </div>
  )
}
