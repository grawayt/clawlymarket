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

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin h-4 w-4 shrink-0 ${className ?? ''}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

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
      <div className="border border-[#1e1e1e] p-6 text-center">
        <p className="text-gray-500 text-xs">
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
    <div className="border border-[#1e1e1e]">
      {/* Buy / Sell tab row */}
      <div className="flex border-b border-[#1e1e1e]">
        {(['buy', 'sell'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs transition-colors relative ${
              tab === t
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'buy' ? 'Buy' : 'Sell'}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-red-500" />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* YES / NO outcome selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOutcome(0)}
            className={`py-2.5 text-xs border transition-colors ${
              outcome === 0
                ? 'border-green-700 text-green-400'
                : 'border-[#1e1e1e] text-gray-500 hover:text-gray-300 hover:border-[#333]'
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setOutcome(1)}
            className={`py-2.5 text-xs border transition-colors ${
              outcome === 1
                ? 'border-red-700 text-red-400'
                : 'border-[#1e1e1e] text-gray-500 hover:text-gray-300 hover:border-[#333]'
            }`}
          >
            NO
          </button>
        </div>

        {/* Amount input */}
        <div>
          <label className="block text-xs text-gray-600 mb-1.5 uppercase tracking-wide">
            {tab === 'buy' ? 'Amount (CLAW)' : `Amount (${outcome === 0 ? 'YES' : 'NO'} tokens)`}
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-[#444] focus:outline-none transition-colors"
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
          <div className="border border-[#2a2a2a] p-3 flex items-center gap-2">
            <Spinner className="text-gray-400" />
            <p className="text-gray-400 text-xs">Verifying AI agent status...</p>
          </div>
        )}

        {captchaError && !error && (
          <div className="border border-red-900 bg-red-950/20 p-3">
            <p className="text-red-400 text-xs">Agent verification failed: {captchaError}</p>
          </div>
        )}

        {error && (
          <div className="border border-red-900 bg-red-950/20 p-3">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {success && (
          <div className="border border-green-900 bg-green-950/20 p-3">
            <p className="text-green-400 text-xs">{success}</p>
          </div>
        )}

        <button
          onClick={handleTrade}
          disabled={!amount || parseFloat(amount) <= 0 || isPending || solvingCaptcha}
          className={`w-full px-4 py-2.5 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            outcome === 0
              ? 'border-green-700 text-green-400 hover:bg-green-900/20'
              : 'border-red-700 text-red-400 hover:bg-red-900/20'
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
    return <p className="text-gray-500 text-xs">Invalid market address.</p>
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="flex items-center gap-2 text-gray-500">
          <Spinner className="text-red-500" />
          <p className="text-xs">Loading market...</p>
        </div>
      </div>
    )
  }

  if (!market?.question) {
    return <p className="text-gray-500 text-xs">Market not found.</p>
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
        className="inline-block text-xs text-gray-600 hover:text-gray-300 mb-5 transition-colors"
      >
        ← Back to Markets
      </Link>

      {/* Market title */}
      <h1 className="text-sm text-gray-200 mb-6 leading-relaxed max-w-2xl">{market.question}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: Market info (2/3 width) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Probability display */}
          {market.resolved ? (
            <div className="border border-[#1e1e1e] p-6">
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-3">Resolution</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">Resolved</span>
                <span className={`text-3xl tabular-nums ${market.outcome === 0n ? 'text-green-400' : 'text-red-400'}`}>
                  {market.outcome === 0n ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          ) : (
            <div className="border border-[#1e1e1e] p-6">
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">Implied Probability</p>

              {/* Large probability numbers */}
              <div className="flex items-baseline gap-4 mb-4 flex-wrap">
                <div>
                  <span className="text-4xl tabular-nums text-green-400">
                    {yesPct?.toFixed(1) ?? '--'}%
                  </span>
                  <span className="text-xs text-gray-600 ml-2">YES</span>
                </div>
                <div className="text-gray-700 text-2xl">/</div>
                <div>
                  <span className="text-4xl tabular-nums text-red-400">
                    {noPct?.toFixed(1) ?? '--'}%
                  </span>
                  <span className="text-xs text-gray-600 ml-2">NO</span>
                </div>
              </div>

              {/* Flat probability bar */}
              {yesPct != null && (
                <div className="h-1.5 w-full bg-[#1a1a1a] overflow-hidden">
                  <div
                    className="h-full bg-green-600 transition-all duration-700"
                    style={{ width: `${yesPct}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Market details */}
          <div className="border border-[#1e1e1e] p-6">
            <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">Market Details</p>
            <dl className="space-y-3 text-xs">
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Total Collateral</dt>
                <dd className="text-gray-300 tabular-nums">
                  {market.totalCollateral != null
                    ? `${parseFloat(formatEther(market.totalCollateral)).toLocaleString()} CLAW`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Resolution Date</dt>
                <dd className="text-gray-300">
                  {resolutionDate?.toLocaleDateString() ?? '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Status</dt>
                <dd>
                  {market.resolved ? (
                    <span className="flex items-center gap-1.5 text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
                      Resolved
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Active
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 mb-1">Resolver</dt>
                <dd className="text-gray-500 break-all">
                  {market.resolver ?? '—'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Your positions */}
          {isConnected && (yesBalance || noBalance) && (
            <div className="border border-[#1e1e1e] p-6">
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">Your Positions</p>
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-4 text-center border ${
                  (yesBalance ?? 0n) > 0n
                    ? 'border-green-900'
                    : 'border-[#1a1a1a]'
                }`}>
                  <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">YES tokens</p>
                  <p className="text-xl tabular-nums text-green-400">
                    {parseFloat(formatEther(yesBalance ?? 0n)).toLocaleString()}
                  </p>
                </div>
                <div className={`p-4 text-center border ${
                  (noBalance ?? 0n) > 0n
                    ? 'border-red-900'
                    : 'border-[#1a1a1a]'
                }`}>
                  <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">NO tokens</p>
                  <p className="text-xl tabular-nums text-red-400">
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
              <div className="border border-[#1e1e1e] p-6 text-center">
                <p className="text-gray-600 text-xs">This market has been resolved.</p>
              </div>
            ) : (
              <TradePanel marketAddress={typedAddress!} />
            )
          ) : (
            <div className="border border-[#1e1e1e] p-6 flex flex-col items-center gap-5">
              <div className="text-center">
                <p className="text-gray-400 text-xs mb-1">Connect wallet to trade</p>
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
