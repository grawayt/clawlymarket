import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useClawliaBalance, useIsVerified } from '../hooks/useClawlia'
import { useMarkets } from '../hooks/useMarketFactory'
import { useMarketData, useMarketPositions } from '../hooks/useMarket'

function PositionCard({ marketAddress }: { marketAddress: `0x${string}` }) {
  const { market } = useMarketData(marketAddress)
  const { yesBalance, noBalance } = useMarketPositions(marketAddress)

  const hasYes = yesBalance != null && yesBalance > 0n
  const hasNo = noBalance != null && noBalance > 0n

  if (!hasYes && !hasNo) return null

  const yesProbBps = market?.probability?.[0]
  const yesPct = yesProbBps != null ? Number(yesProbBps) / 100 : null

  return (
    <Link
      to={`/markets/${marketAddress}`}
      className="rounded-lg border border-gray-800 bg-gray-900 p-4 block hover:border-gray-600 transition-colors"
    >
      <h3 className="text-sm font-medium text-gray-200 mb-3 line-clamp-2">
        {market?.question ?? 'Loading...'}
      </h3>
      <div className="flex gap-3">
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
      {market?.resolved && (
        <p className="text-xs text-gray-500 mt-2">
          Resolved: {market.outcome === 0n ? 'YES' : 'NO'}
        </p>
      )}
    </Link>
  )
}

export default function Portfolio() {
  const { isConnected, address } = useAccount()
  const { formatted, isLoading: balLoading } = useClawliaBalance()
  const { isVerified, isLoading: verLoading } = useIsVerified()
  const { markets } = useMarkets()

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <p className="text-sm text-gray-400">CLAW Balance</p>
          <p className="text-3xl font-bold mt-1">
            {balLoading ? '...' : parseFloat(formatted).toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-2 font-mono">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <p className="text-sm text-gray-400">Verification Status</p>
          <p className={`text-lg font-medium mt-1 ${
            verLoading ? 'text-gray-500' :
            isVerified ? 'text-green-400' : 'text-yellow-400'
          }`}>
            {verLoading ? 'Checking...' : isVerified ? 'Verified' : 'Not Verified'}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            {isVerified
              ? 'You are verified and can create markets and trade'
              : 'Complete verification to receive 1,000 CLAW'}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold mb-4">Active Positions</h2>
        {markets.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No markets exist yet. <Link to="/markets" className="text-red-400 underline">Create one</Link> to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {markets.map((addr) => (
              <PositionCard key={addr} marketAddress={addr} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
