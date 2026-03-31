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
// Status text
// ---------------------------------------------------------------------------

function StatusText({ resolved, readyToResolve }: { resolved?: boolean; readyToResolve: boolean }) {
  if (resolved) {
    return <span className="text-gray-600 text-xs">resolved</span>
  }
  if (readyToResolve) {
    return (
      <span className="text-yellow-400 text-xs flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
        ready
      </span>
    )
  }
  return (
    <span className="text-green-400 text-xs flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
      open
    </span>
  )
}

// ---------------------------------------------------------------------------
// Market row
// ---------------------------------------------------------------------------

interface MarketRowProps {
  index: number
  address: `0x${string}`
  connectedAddress?: `0x${string}`
}

function MarketRow({ index, address, connectedAddress }: MarketRowProps) {
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
  const isResolver =
    connectedAddress != null &&
    resolver != null &&
    connectedAddress.toLowerCase() === resolver.toLowerCase()

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
      <tr className="border-b border-[#1a1a1a]">
        <td className="px-4 py-3 text-gray-700 text-xs">{index + 1}</td>
        <td className="px-4 py-3" colSpan={6}>
          <div className="h-3 bg-[#1a1a1a] w-2/3" />
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className="border-b border-[#1a1a1a] hover:bg-[#111] transition-colors">
        <td className="px-4 py-3 text-gray-700 text-xs tabular-nums">{index + 1}</td>
        <td className="px-4 py-3 text-gray-300 text-xs max-w-[260px]">
          <span title={question} className="line-clamp-2">
            {question
              ? question.length > 70
                ? question.slice(0, 70) + '…'
                : question
              : <span className="text-gray-700 italic">—</span>}
          </span>
        </td>
        <td className="px-4 py-3">
          <StatusText resolved={resolved} readyToResolve={readyToResolve} />
        </td>
        <td className="px-4 py-3 text-xs">
          {resolved && outcome != null ? (
            <span className={`${outcome === 0n ? 'text-green-400' : 'text-red-400'}`}>
              {outcome === 0n ? 'YES' : 'NO'}
            </span>
          ) : (
            <span className="text-gray-700">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs tabular-nums">
          {totalCollateral != null
            ? `${parseFloat(formatEther(totalCollateral)).toLocaleString()} CLAW`
            : '—'}
        </td>
        <td className="px-4 py-3 text-gray-600 text-xs">
          {resolutionDate ? resolutionDate.toLocaleDateString() : '—'}
        </td>
        <td className="px-4 py-3 text-gray-700 text-xs">
          {resolver ? truncateAddress(resolver) : '—'}
        </td>
        <td className="px-4 py-3">
          {!connectedAddress ? (
            <span className="text-xs text-gray-700">Connect wallet</span>
          ) : !isResolver && !resolved ? (
            <span className="text-xs text-gray-700">Not your market</span>
          ) : null}
          {isResolver && readyToResolve && resolveStatus !== 'success' && (
            <div className="flex gap-2">
              <button
                onClick={() => handleResolve(0n)}
                disabled={resolveStatus === 'pending'}
                className="border border-green-900 px-2.5 py-1 text-xs text-green-400 hover:bg-green-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {resolveStatus === 'pending' ? <Spinner className="h-3 w-3" /> : 'YES'}
              </button>
              <button
                onClick={() => handleResolve(1n)}
                disabled={resolveStatus === 'pending'}
                className="border border-red-900 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {resolveStatus === 'pending' ? <Spinner className="h-3 w-3" /> : 'NO'}
              </button>
            </div>
          )}
          {resolveStatus === 'success' && (
            <span className="text-xs text-green-400">Resolved</span>
          )}
        </td>
      </tr>
      {resolveStatus === 'error' && resolveError && (
        <tr className="border-b border-[#1a1a1a]">
          <td colSpan={8} className="px-4 pb-3">
            <p className="text-xs text-red-400 border border-red-900 bg-red-950/20 px-3 py-2">
              {resolveError}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DKIM Pubkey Hash Management
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
    <div className="border border-[#1a1a1a] p-6">
      <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-5">DKIM Pubkey Hash Management</h2>

      <div className="mb-5">
        <p className="text-xs text-gray-600 mb-2">Anthropic DKIM Pubkey Hash</p>
        <div className="border border-[#1a1a1a] bg-[#080808] px-3 py-3">
          <code className="text-xs text-gray-500 break-all">{ANTHROPIC_PUBKEY_HASH.toString()}</code>
          <div className="mt-2">
            {anthropicApproved === true && (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Approved
              </span>
            )}
            {anthropicApproved === false && (
              <span className="flex items-center gap-1.5 text-xs text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                Not approved
              </span>
            )}
            {anthropicApproved == null && (
              <span className="text-xs text-gray-700">Loading...</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1.5 uppercase tracking-wide">Pubkey Hash (decimal or 0x hex)</label>
          <input
            type="text"
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder="e.g. 21143687... or 0x2e8b..."
            className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-xs text-gray-200 placeholder-gray-700 focus:border-[#444] focus:outline-none transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAdd}
            disabled={!hashInput.trim() || isPending}
            className="border border-green-900 px-4 py-2.5 text-xs text-green-400 hover:bg-green-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {addStatus === 'pending' && <Spinner className="h-3 w-3" />}
            {addStatus === 'pending' ? 'Approving...' : 'Approve Hash'}
          </button>

          <button
            onClick={handleRemove}
            disabled={!hashInput.trim() || isPending}
            className="border border-red-900 px-4 py-2.5 text-xs text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {removeStatus === 'pending' && <Spinner className="h-3 w-3" />}
            {removeStatus === 'pending' ? 'Removing...' : 'Remove Hash'}
          </button>
        </div>

        {message && (
          <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Whitelist Management
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
    <div className="border border-[#1a1a1a] p-6">
      <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-5">Whitelist Management</h2>
      <p className="text-xs text-gray-600 mb-5 leading-relaxed">
        Manually whitelist an address so it can hold and transfer CLAW tokens.
        Infrastructure contracts are whitelisted automatically.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1.5 uppercase tracking-wide">Address to whitelist</label>
          <input
            type="text"
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value)}
            placeholder="0x..."
            className="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2.5 text-xs text-gray-200 placeholder-gray-700 focus:border-[#444] focus:outline-none transition-colors"
          />
        </div>

        <button
          onClick={handleWhitelist}
          disabled={!addrInput.trim() || status === 'pending'}
          className="border border-red-700 px-4 py-2.5 text-xs text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {status === 'pending' && <Spinner />}
          {status === 'pending' ? 'Whitelisting...' : 'Whitelist Address'}
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

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-sm text-gray-200">Admin Dashboard</h1>
        <p className="text-gray-600 text-xs">Connect your wallet to access admin controls.</p>
        <ConnectButton />
      </div>
    )
  }

  if (!addrs) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <h1 className="text-sm text-gray-200">Admin Dashboard</h1>
        <div className="border border-[#1a1a1a] p-8 text-center max-w-md">
          <p className="text-gray-500 text-xs">Unsupported network.</p>
          <p className="text-gray-700 text-xs mt-2">Switch to Anvil local, Arbitrum Sepolia, or Arbitrum.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm text-gray-200">Admin Dashboard</h1>
          <p className="text-gray-600 text-xs mt-0.5">ClawlyMarket system management</p>
        </div>
        <span className="text-xs text-gray-600 border border-[#1a1a1a] px-3 py-1.5">
          {address ? truncateAddress(address) : '—'}
        </span>
      </div>

      {/* System Overview */}
      <section>
        <h2 className="text-xs text-gray-600 uppercase tracking-widest mb-3">System Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1a1a1a]">
          {[
            {
              label: 'Total Markets',
              value: marketCount != null ? marketCount.toString() : '—',
            },
            {
              label: 'CLAW Supply',
              value: totalSupply != null ? parseFloat(formatEther(totalSupply)).toLocaleString() : '—',
              sub: totalSupply != null ? 'CLAW' : undefined,
            },
            {
              label: 'Anthropic Key',
              value: anthropicApproved === true ? 'Approved' : anthropicApproved === false ? 'Not Approved' : '—',
              color: anthropicApproved === true ? 'text-green-400' : anthropicApproved === false ? 'text-red-400' : 'text-gray-600',
              span: 'lg:col-span-2',
            },
          ].map(({ label, value, sub, color, span }) => (
            <div
              key={label}
              className={`bg-[#0a0a0a] p-4 ${span ?? ''}`}
            >
              <p className="text-xs text-gray-600 mb-1">{label}</p>
              <p className={`text-xl tabular-nums ${color ?? 'text-white'}`}>{value}</p>
              {sub && <p className="text-xs text-gray-700 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Markets Management */}
      <section>
        <h2 className="text-xs text-gray-600 uppercase tracking-widest mb-3">Markets Management</h2>
        <div className="border border-[#1a1a1a] overflow-x-auto">
          {marketsLoading ? (
            <div className="p-8 text-center flex items-center justify-center gap-2 text-gray-600">
              <Spinner className="h-4 w-4 text-red-500" />
              <p className="text-xs">Loading markets...</p>
            </div>
          ) : markets.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-700 text-xs">No markets deployed yet.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {['#', 'Question', 'Status', 'Outcome', 'Collateral', 'Resolves', 'Resolver', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs text-gray-600 uppercase tracking-widest whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {markets.map((addr, i) => (
                  <MarketRow key={addr} index={i} address={addr} connectedAddress={address} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* DKIM + Whitelist — owner only */}
      {isOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <PubkeyHashSection />
          <WhitelistSection />
        </div>
      )}
    </div>
  )
}
