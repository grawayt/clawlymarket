import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ADDRESSES } from '../../contracts/addresses'

const SUPPORTED_CHAIN_IDS = Object.keys(ADDRESSES).map(Number)

// The primary "live" chain — used for the one-click switch target.
// Arbitrum Sepolia is the only testnet with real deployed contracts.
const TARGET_CHAIN_ID = 421614

export default function WrongNetworkBanner() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()

  if (!isConnected || SUPPORTED_CHAIN_IDS.includes(chainId)) return null

  return (
    <div className="bg-amber-400/10 border-b border-amber-400/30 px-4 py-2.5">
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
        <p className="text-sm text-amber-300">
          <span className="font-semibold">Wrong network.</span>{' '}
          Please switch to Arbitrum Sepolia to use ClawlyMarket.
        </p>
        <button
          onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
          disabled={isPending}
          className="shrink-0 rounded bg-amber-400/20 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-400/30 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Switching…' : 'Switch to Arbitrum Sepolia'}
        </button>
      </div>
    </div>
  )
}
