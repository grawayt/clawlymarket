import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useWriteContract } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { useMarkets } from '../hooks/useMarketFactory'
import { useMarketData } from '../hooks/useMarket'
import { useIsVerified, useClawliaBalance } from '../hooks/useClawlia'
import { useContractAddresses } from '../hooks/useContracts'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { marketFactoryAbi } from '../contracts/MarketFactoryAbi'

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
          Liquidity: {market.totalCollateral != null
            ? `${parseFloat(formatEther(market.totalCollateral)).toLocaleString()} CLAW`
            : '--'
          }
        </span>
        {resolutionDate && (
          <span>Resolves: {resolutionDate.toLocaleDateString()}</span>
        )}
      </div>
    </Link>
  )
}

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
      const resolutionTs = BigInt(Math.floor(Date.now() / 1000) + parseInt(daysUntilResolution) * 86400)

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
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl">&times;</button>
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

export default function Markets() {
  const { isConnected } = useAccount()
  const { markets, isLoading, refetch } = useMarkets()
  const { isVerified } = useIsVerified()
  const addrs = useContractAddresses()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
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

      {showCreate && (
        <CreateMarketForm
          onClose={() => setShowCreate(false)}
          onCreated={() => refetch()}
        />
      )}

      {!addrs ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400 text-lg">Unsupported network</p>
          <p className="text-gray-500 text-sm mt-2">
            Switch to a supported network (Anvil local, Arbitrum Sepolia, or Arbitrum) to see markets.
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {markets.map((addr) => (
            <MarketCard key={addr} address={addr} />
          ))}
        </div>
      )}
    </div>
  )
}
