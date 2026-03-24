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
  const [outcome, setOutcome] = useState<0 | 1>(0) // 0=YES, 1=NO
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
      // Ensure a valid CaptchaGate session before trading.
      // If already valid this is a no-op; otherwise it auto-solves the challenge.
      await ensureSession()

      const parsedAmount = parseEther(amount)

      if (tab === 'buy') {
        // Approve CLAW spend first
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
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center">
        <p className="text-gray-400">You must be <Link to="/verify" className="text-red-400 underline">verified</Link> to trade.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('buy')}
          className={`flex-1 rounded py-2 text-sm font-medium transition-colors ${
            tab === 'buy' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setTab('sell')}
          className={`flex-1 rounded py-2 text-sm font-medium transition-colors ${
            tab === 'sell' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setOutcome(0)}
          className={`flex-1 rounded py-2 text-sm font-medium transition-colors ${
            outcome === 0
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setOutcome(1)}
          className={`flex-1 rounded py-2 text-sm font-medium transition-colors ${
            outcome === 1
              ? 'bg-red-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          NO
        </button>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">
          {tab === 'buy' ? 'Amount (CLAW)' : `Amount (${outcome === 0 ? 'YES' : 'NO'} tokens)`}
        </label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>Balance: {parseFloat(clawBalance).toLocaleString()} CLAW</span>
          {tab === 'sell' && (
            <span>
              {outcome === 0 ? 'YES' : 'NO'}: {
                formatEther((outcome === 0 ? yesBalance : noBalance) ?? 0n)
              }
            </span>
          )}
        </div>
      </div>

      {/* CAPTCHA session status */}
      {solvingCaptcha && (
        <div className="rounded border border-gray-700 bg-gray-800/60 p-2 mb-4 flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 animate-spin text-red-400 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-400 text-xs">Verifying AI agent status...</p>
        </div>
      )}

      {captchaError && !error && (
        <div className="rounded border border-red-800 bg-red-900/20 p-2 mb-4">
          <p className="text-red-400 text-xs">Agent verification failed: {captchaError}</p>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-900/20 p-2 mb-4">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded border border-green-800 bg-green-900/20 p-2 mb-4">
          <p className="text-green-400 text-xs">{success}</p>
        </div>
      )}

      <button
        onClick={handleTrade}
        disabled={!amount || parseFloat(amount) <= 0 || isPending || solvingCaptcha}
        className="w-full rounded bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {solvingCaptcha
          ? 'Verifying AI agent status...'
          : isPending
            ? 'Confirming...'
            : `${tab === 'buy' ? 'Buy' : 'Sell'} ${outcome === 0 ? 'YES' : 'NO'}`}
      </button>
    </div>
  )
}

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
        <p className="text-gray-400">Loading market...</p>
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

  // ResolvePanel visibility: connected wallet === resolver, not yet resolved,
  // and resolution timestamp has passed.
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
      <Link to="/markets" className="text-sm text-gray-500 hover:text-gray-300 mb-4 inline-block">
        &larr; Back to Markets
      </Link>

      <h1 className="text-2xl font-bold mb-6">{market.question}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Market info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Probability bars */}
          {market.resolved ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
              <p className="text-sm text-gray-400 mb-2">Resolved</p>
              <p className="text-3xl font-bold text-green-400">
                {market.outcome === 0n ? 'YES' : 'NO'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
              <p className="text-sm text-gray-400 mb-3">Implied Probability</p>
              <div className="flex gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-green-400 font-medium">YES</span>
                    <span className="text-green-300 font-bold">{yesPct?.toFixed(1) ?? '--'}%</span>
                  </div>
                  <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-500"
                      style={{ width: `${yesPct ?? 50}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-red-400 font-medium">NO</span>
                    <span className="text-red-300 font-bold">{noPct?.toFixed(1) ?? '--'}%</span>
                  </div>
                  <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full transition-all duration-500"
                      style={{ width: `${noPct ?? 50}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Market details */}
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h2 className="text-sm font-medium text-gray-400 mb-3">Market Details</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">Total Collateral</dt>
                <dd className="text-gray-200 font-medium">
                  {market.totalCollateral != null
                    ? `${parseFloat(formatEther(market.totalCollateral)).toLocaleString()} CLAW`
                    : '--'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Resolution Date</dt>
                <dd className="text-gray-200 font-medium">
                  {resolutionDate?.toLocaleDateString() ?? '--'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Resolver</dt>
                <dd className="text-gray-200 font-mono text-xs truncate">
                  {market.resolver ?? '--'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd className={`font-medium ${market.resolved ? 'text-gray-400' : 'text-green-400'}`}>
                  {market.resolved ? 'Resolved' : 'Active'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Your positions */}
          {isConnected && (yesBalance || noBalance) && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
              <h2 className="text-sm font-medium text-gray-400 mb-3">Your Positions</h2>
              <div className="flex gap-4">
                <div className="flex-1 rounded bg-green-900/20 border border-green-800/40 p-3 text-center">
                  <p className="text-xs text-green-400">YES tokens</p>
                  <p className="text-lg font-bold text-green-300">
                    {parseFloat(formatEther(yesBalance ?? 0n)).toLocaleString()}
                  </p>
                </div>
                <div className="flex-1 rounded bg-red-900/20 border border-red-800/40 p-3 text-center">
                  <p className="text-xs text-red-400">NO tokens</p>
                  <p className="text-lg font-bold text-red-300">
                    {parseFloat(formatEther(noBalance ?? 0n)).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Resolve panel (resolver only, when eligible) + Trade panel */}
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
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center">
                <p className="text-gray-400">This market has been resolved.</p>
              </div>
            ) : (
              <TradePanel marketAddress={typedAddress!} />
            )
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 flex flex-col items-center gap-4">
              <p className="text-gray-400 text-sm text-center">Connect your wallet to trade</p>
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
