import { useState } from 'react'
import { useAccount, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { formatEther } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { marketFactoryAbi } from '../contracts/MarketFactoryAbi'
import { predictionMarketAbi } from '../contracts/PredictionMarketAbi'
import { useContractAddresses } from '../hooks/useContracts'
import { useMarkets } from '../hooks/useMarketFactory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string, chars = 6) {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Market row — reads per-market data
// ---------------------------------------------------------------------------

interface MarketRowProps {
  index: number
  address: `0x${string}`
}

function MarketRow({ index, address }: MarketRowProps) {
  const { writeContractAsync } = useWriteContract()
  const [resolveStatus, setResolveStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [resolveError, setResolveError] = useState('')

  const { data, isLoading } = useReadContracts({
    contracts: [
      { address, abi: predictionMarketAbi, functionName: 'question' },
      { address, abi: predictionMarketAbi, functionName: 'resolved' },
      { address, abi: predictionMarketAbi, functionName: 'outcome' },
      { address, abi: predictionMarketAbi, functionName: 'totalCollateral' },
      { address, abi: predictionMarketAbi, functionName: 'resolutionTimestamp' },
      { address, abi: predictionMarketAbi, functionName: 'resolver' },
    ],
  })

  const question = data?.[0]?.result as string | undefined
  const resolved = data?.[1]?.result as boolean | undefined
  const outcome = data?.[2]?.result as bigint | undefined
  const totalCollateral = data?.[3]?.result as bigint | undefined
  const resolutionTimestamp = data?.[4]?.result as bigint | undefined
  const resolver = data?.[5]?.result as `0x${string}` | undefined

  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const pastResolutionTime = resolutionTimestamp != null && resolutionTimestamp < nowSec
  const readyToResolve = !resolved && pastResolutionTime

  const resolutionDate = resolutionTimestamp
    ? new Date(Number(resolutionTimestamp) * 1000)
    : null

  const handleResolve = async (outcomeIndex: bigint) => {
    setResolveStatus('pending')
    setResolveError('')
    try {
      await writeContractAsync({
        address,
        abi: predictionMarketAbi,
        functionName: 'resolve',
        args: [outcomeIndex],
      })
      setResolveStatus('success')
    } catch (err: any) {
      setResolveStatus('error')
      setResolveError(err?.shortMessage || err?.message || 'Resolve failed')
    }
  }

  if (isLoading) {
    return (
      <tr className="border-b border-gray-800">
        <td className="px-4 py-3 text-gray-500">{index + 1}</td>
        <td className="px-4 py-3" colSpan={6}>
          <div className="h-4 bg-gray-800 rounded animate-pulse w-2/3" />
        </td>
      </tr>
    )
  }

  let statusBadge: React.ReactNode
  if (resolved) {
    statusBadge = (
      <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-700 text-gray-300">
        Resolved
      </span>
    )
  } else if (readyToResolve) {
    statusBadge = (
      <span className="rounded px-2 py-0.5 text-xs font-medium bg-yellow-900/60 text-yellow-300 border border-yellow-700">
        Ready to Resolve
      </span>
    )
  } else {
    statusBadge = (
      <span className="rounded px-2 py-0.5 text-xs font-medium bg-green-900/60 text-green-300 border border-green-700">
        Open
      </span>
    )
  }

  return (
    <>
      <tr className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors">
        <td className="px-4 py-3 text-gray-500 text-sm">{index + 1}</td>
        <td className="px-4 py-3 text-gray-200 text-sm max-w-[260px]">
          <span title={question} className="line-clamp-2">
            {question
              ? question.length > 70
                ? question.slice(0, 70) + '…'
                : question
              : <span className="text-gray-500 italic">—</span>}
          </span>
        </td>
        <td className="px-4 py-3">{statusBadge}</td>
        <td className="px-4 py-3 text-sm">
          {resolved && outcome != null ? (
            <span className={outcome === 0n ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
              {outcome === 0n ? 'YES' : 'NO'}
            </span>
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-300 text-sm">
          {totalCollateral != null
            ? `${parseFloat(formatEther(totalCollateral)).toLocaleString()} CLAW`
            : '—'}
        </td>
        <td className="px-4 py-3 text-gray-400 text-sm">
          {resolutionDate ? resolutionDate.toLocaleDateString() : '—'}
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs font-mono">
          {resolver ? truncateAddress(resolver) : '—'}
        </td>
        <td className="px-4 py-3">
          {readyToResolve && resolveStatus !== 'success' && (
            <div className="flex gap-2">
              <button
                onClick={() => handleResolve(0n)}
                disabled={resolveStatus === 'pending'}
                className="rounded bg-green-700 hover:bg-green-600 px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resolveStatus === 'pending' ? <Spinner className="h-3 w-3" /> : 'YES'}
              </button>
              <button
                onClick={() => handleResolve(1n)}
                disabled={resolveStatus === 'pending'}
                className="rounded bg-red-700 hover:bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resolveStatus === 'pending' ? <Spinner className="h-3 w-3" /> : 'NO'}
              </button>
            </div>
          )}
          {resolveStatus === 'success' && (
            <span className="text-xs text-green-400">Resolved!</span>
          )}
        </td>
      </tr>
      {resolveStatus === 'error' && resolveError && (
        <tr className="border-b border-gray-800">
          <td colSpan={8} className="px-4 pb-2">
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-2 py-1">{resolveError}</p>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DKIM Pubkey Hash Management section
// ---------------------------------------------------------------------------

const ANTHROPIC_PUBKEY_HASH = 21143687054953386827989663701408810093555362204214086893911788067496102859806n

function PubkeyHashSection() {
  const addrs = useContractAddresses()
  const { writeContractAsync } = useWriteContract()

  const [hashInput, setHashInput] = useState('')
  const [addStatus, setAddStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [removeStatus, setRemoveStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  const { data: anthropicApproved, refetch } = useReadContract({
    address: addrs?.modelRegistry,
    abi: modelRegistryAbi,
    functionName: 'approvedPubkeyHashes',
    args: [ANTHROPIC_PUBKEY_HASH],
    query: { enabled: !!addrs },
  })

  const parseHash = (): bigint | null => {
    const trimmed = hashInput.trim()
    if (!trimmed) return null
    try {
      return trimmed.startsWith('0x') ? BigInt(trimmed) : BigInt(trimmed)
    } catch {
      return null
    }
  }

  const handleAdd = async () => {
    const hash = parseHash()
    if (!addrs || hash == null) {
      setIsError(true)
      setMessage('Invalid hash value — must be a decimal number or 0x-prefixed hex')
      return
    }
    setAddStatus('pending')
    setMessage('')
    setIsError(false)
    try {
      await writeContractAsync({
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'addApprovedPubkeyHash',
        args: [hash],
      })
      setAddStatus('success')
      setMessage('Pubkey hash approved successfully.')
      setHashInput('')
      refetch()
    } catch (err: any) {
      setAddStatus('error')
      setIsError(true)
      setMessage(err?.shortMessage || err?.message || 'Transaction failed')
    }
  }

  const handleRemove = async () => {
    const hash = parseHash()
    if (!addrs || hash == null) {
      setIsError(true)
      setMessage('Invalid hash value — must be a decimal number or 0x-prefixed hex')
      return
    }
    setRemoveStatus('pending')
    setMessage('')
    setIsError(false)
    try {
      await writeContractAsync({
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'removeApprovedPubkeyHash',
        args: [hash],
      })
      setRemoveStatus('success')
      setMessage('Pubkey hash removed.')
      setHashInput('')
      refetch()
    } catch (err: any) {
      setRemoveStatus('error')
      setIsError(true)
      setMessage(err?.shortMessage || err?.message || 'Transaction failed')
    }
  }

  const isPending = addStatus === 'pending' || removeStatus === 'pending'

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-gray-100 mb-4">DKIM Pubkey Hash Management</h2>

      <div className="mb-5">
        <p className="text-xs text-gray-500 mb-1">Anthropic DKIM Pubkey Hash</p>
        <div className="rounded border border-gray-700 bg-gray-950 px-3 py-2">
          <code className="text-xs text-gray-300 font-mono break-all">
            {ANTHROPIC_PUBKEY_HASH.toString()}
          </code>
          <div className="mt-1.5">
            {anthropicApproved === true && (
              <span className="text-xs text-green-400">Approved</span>
            )}
            {anthropicApproved === false && (
              <span className="text-xs text-red-400">Not approved</span>
            )}
            {anthropicApproved == null && (
              <span className="text-xs text-gray-500">Loading...</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Pubkey Hash (decimal or 0x hex)</label>
          <input
            type="text"
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder="e.g. 21143687... or 0x2e8b..."
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 font-mono focus:border-red-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAdd}
            disabled={!hashInput.trim() || isPending}
            className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {addStatus === 'pending' && <Spinner />}
            {addStatus === 'pending' ? 'Pinching hash into registry...' : 'Approve Hash'}
          </button>

          <button
            onClick={handleRemove}
            disabled={!hashInput.trim() || isPending}
            className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {removeStatus === 'pending' && <Spinner />}
            {removeStatus === 'pending' ? 'Clawing hash out...' : 'Remove Hash'}
          </button>
        </div>

        {message && (
          <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Whitelist Management section
// ---------------------------------------------------------------------------

function WhitelistSection() {
  const addrs = useContractAddresses()
  const { writeContractAsync } = useWriteContract()

  const [addrInput, setAddrInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleWhitelist = async () => {
    if (!addrs || !addrInput.trim()) return
    setStatus('pending')
    setMessage('')

    let parsed: `0x${string}`
    try {
      const trimmed = addrInput.trim()
      if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('Invalid address format')
      parsed = trimmed as `0x${string}`
    } catch {
      setStatus('error')
      setMessage('Invalid Ethereum address — must be 0x followed by 40 hex chars')
      return
    }

    try {
      await writeContractAsync({
        address: addrs.clawliaToken,
        abi: clawliaTokenAbi,
        functionName: 'whitelistAddress',
        args: [parsed],
      })
      setStatus('success')
      setMessage(`Address ${truncateAddress(parsed)} whitelisted successfully.`)
      setAddrInput('')
    } catch (err: any) {
      setStatus('error')
      setMessage(err?.shortMessage || err?.message || 'Transaction failed')
    }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-gray-100 mb-4">Whitelist Management</h2>
      <p className="text-sm text-gray-400 mb-4">
        Manually whitelist an address so it can hold and transfer CLAW tokens.
        Infrastructure contracts (markets, factory) are whitelisted automatically.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Address to whitelist</label>
          <input
            type="text"
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value)}
            placeholder="0x..."
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 font-mono focus:border-red-500 focus:outline-none"
          />
        </div>

        <button
          onClick={handleWhitelist}
          disabled={!addrInput.trim() || status === 'pending'}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {status === 'pending' && <Spinner />}
          {status === 'pending' ? 'Snapping address to whitelist...' : 'Whitelist Address'}
        </button>

        {message && (
          <p className={`text-xs ${status === 'error' ? 'text-red-400' : status === 'success' ? 'text-green-400' : 'text-gray-400'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Admin page
// ---------------------------------------------------------------------------

export default function Admin() {
  const { address, isConnected } = useAccount()
  const addrs = useContractAddresses()
  const { markets, isLoading: marketsLoading } = useMarkets()

  // Read owner and system stats
  const { data: ownerData } = useReadContract({
    address: addrs?.clawliaToken,
    abi: clawliaTokenAbi,
    functionName: 'owner',
    query: { enabled: !!addrs },
  })

  const { data: statsData } = useReadContracts({
    contracts: addrs ? [
      { address: addrs.clawliaToken, abi: clawliaTokenAbi, functionName: 'totalSupply' },
      { address: addrs.marketFactory, abi: marketFactoryAbi, functionName: 'getMarketCount' },
      {
        address: addrs.modelRegistry,
        abi: modelRegistryAbi,
        functionName: 'approvedPubkeyHashes',
        args: [ANTHROPIC_PUBKEY_HASH],
      },
    ] : [],
    query: { enabled: !!addrs },
  })

  const owner = ownerData as `0x${string}` | undefined
  const totalSupply = statsData?.[0]?.result as bigint | undefined
  const marketCount = statsData?.[1]?.result as bigint | undefined
  const anthropicApproved = statsData?.[2]?.result as boolean | undefined

  const isOwner =
    address != null &&
    owner != null &&
    address.toLowerCase() === owner.toLowerCase()

  // ---- Not connected ----
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-gray-400">Connect your wallet to access the admin panel.</p>
        <ConnectButton />
      </div>
    )
  }

  // ---- Unsupported network ----
  if (!addrs) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center max-w-md">
          <p className="text-gray-400">Unsupported network.</p>
          <p className="text-gray-500 text-sm mt-2">Switch to Anvil local, Arbitrum Sepolia, or Arbitrum.</p>
        </div>
      </div>
    )
  }

  // ---- Access check ----
  if (owner != null && !isOwner) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-8 text-center max-w-md">
          <p className="text-red-400 text-lg font-semibold">Admin access required</p>
          <p className="text-gray-400 text-sm mt-2">
            This page is restricted to the contract owner.
          </p>
          <p className="text-gray-500 text-xs mt-3 font-mono">
            Owner: {owner ? truncateAddress(owner) : '—'}
          </p>
          <p className="text-gray-500 text-xs mt-1 font-mono">
            You: {address ? truncateAddress(address) : '—'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">ClawlyMarket system management</p>
        </div>
        <span className="text-xs text-gray-500 font-mono bg-gray-900 border border-gray-700 rounded px-3 py-1.5">
          {address ? truncateAddress(address) : '—'}
        </span>
      </div>

      {/* System Overview */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">System Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-500 mb-1">Total Markets</p>
            <p className="text-2xl font-bold text-gray-100">
              {marketCount != null ? marketCount.toString() : <span className="text-gray-600">—</span>}
            </p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-500 mb-1">Total CLAW Supply</p>
            <p className="text-2xl font-bold text-gray-100">
              {totalSupply != null
                ? `${parseFloat(formatEther(totalSupply)).toLocaleString()}`
                : <span className="text-gray-600">—</span>}
            </p>
            {totalSupply != null && <p className="text-xs text-gray-500 mt-0.5">CLAW</p>}
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 lg:col-span-2">
            <p className="text-xs text-gray-500 mb-1">Anthropic DKIM Key</p>
            <p className="text-sm font-mono text-gray-300 break-all">
              {anthropicApproved === true && (
                <span className="text-green-400 font-medium">Approved</span>
              )}
              {anthropicApproved === false && (
                <span className="text-red-400 font-medium">Not approved</span>
              )}
              {anthropicApproved == null && '—'}
            </p>
          </div>
        </div>
      </section>

      {/* Markets Management */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Markets Management</h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-x-auto">
          {marketsLoading ? (
            <div className="p-8 text-center">
              <p className="text-gray-400 text-sm">Scuttling through markets...</p>
            </div>
          ) : markets.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500 text-sm">No markets deployed yet.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Question</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Outcome</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Collateral</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Resolves</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Resolver</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((addr, i) => (
                  <MarketRow key={addr} index={i} address={addr} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* DKIM Pubkey Hash + Whitelist in 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PubkeyHashSection />
        <WhitelistSection />
      </div>
    </div>
  )
}
