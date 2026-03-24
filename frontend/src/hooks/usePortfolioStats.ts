import { useEffect, useState, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { usePublicClient } from 'wagmi'
import { formatEther } from 'viem'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { useContractAddresses } from './useContracts'
import { useClawliaBalance } from './useClawlia'
import { useMarketData, useMarketPositions } from './useMarket'
import { useMarkets } from './useMarketFactory'

// ---- types ----

export interface PositionStats {
  marketAddress: `0x${string}`
  question: string
  yesBalance: bigint
  noBalance: bigint
  /** Estimated CLAW value at current implied probability */
  currentValue: number
  resolved: boolean
  outcome: bigint | undefined
  /**
   * For resolved markets only: true = user won, false = user lost, null = unresolved or no position.
   */
  isWin: boolean | null
}

export interface TransferRecord {
  direction: 'received' | 'sent'
  from: `0x${string}`
  to: `0x${string}`
  /** Human-readable formatted amount */
  amount: string
  txHash: `0x${string}`
  blockNumber: bigint
}

// ---- per-market hook ----

/**
 * Returns position stats for a single market for the connected wallet.
 * Returns null if the user has no position in that market.
 */
export function useMarketStats(marketAddress: `0x${string}`): PositionStats | null {
  const { market } = useMarketData(marketAddress)
  const { yesBalance, noBalance } = useMarketPositions(marketAddress)

  return useMemo(() => {
    if (!market) return null
    const yes = yesBalance ?? 0n
    const no = noBalance ?? 0n
    if (yes === 0n && no === 0n) return null

    // probability tuple: [yesProbBps, noProbBps] in basis points (0–10000)
    const yesProbBps = market.probability?.[0] ?? 5000n
    const noProbBps = market.probability?.[1] ?? 5000n
    const yesPrice = Number(yesProbBps) / 10000
    const noPrice = Number(noProbBps) / 10000

    const yesEth = parseFloat(formatEther(yes))
    const noEth = parseFloat(formatEther(no))
    const currentValue = yesEth * yesPrice + noEth * noPrice

    let isWin: boolean | null = null
    if (market.resolved && market.outcome !== undefined) {
      // outcome 0n = YES wins, 1n = NO wins
      if (market.outcome === 0n && yes > 0n) isWin = true
      else if (market.outcome === 1n && no > 0n) isWin = true
      else isWin = false
    }

    return {
      marketAddress,
      question: market.question ?? marketAddress,
      yesBalance: yes,
      noBalance: no,
      currentValue,
      resolved: market.resolved ?? false,
      outcome: market.outcome,
      isWin,
    }
  }, [market, yesBalance, noBalance, marketAddress])
}

// ---- CLAW transfer history hook ----

/**
 * Fetches the last 10 CLAW Transfer events involving the connected address.
 * Uses the same publicClient pattern as useTradeHistory.
 */
export function useClawliaTransfers(): {
  transfers: TransferRecord[]
  isLoading: boolean
  error: string | null
} {
  const { address } = useAccount()
  const addrs = useContractAddresses()
  const client = usePublicClient()

  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!address || !addrs || !client) return

    let cancelled = false

    async function fetchTransfers() {
      setIsLoading(true)
      setError(null)
      try {
        const [sentLogs, receivedLogs] = await Promise.all([
          client!.getContractEvents({
            address: addrs!.clawliaToken,
            abi: clawliaTokenAbi,
            eventName: 'Transfer',
            args: { from: address },
            fromBlock: 0n,
          }),
          client!.getContractEvents({
            address: addrs!.clawliaToken,
            abi: clawliaTokenAbi,
            eventName: 'Transfer',
            args: { to: address },
            fromBlock: 0n,
          }),
        ])

        if (cancelled) return

        const records: TransferRecord[] = []

        for (const log of sentLogs) {
          const args = log.args as { from: `0x${string}`; to: `0x${string}`; value: bigint }
          records.push({
            direction: 'sent',
            from: args.from,
            to: args.to,
            amount: parseFloat(formatEther(args.value)).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            }),
            txHash: log.transactionHash as `0x${string}`,
            blockNumber: log.blockNumber ?? 0n,
          })
        }

        for (const log of receivedLogs) {
          const args = log.args as { from: `0x${string}`; to: `0x${string}`; value: bigint }
          // Skip self-transfers already captured as sent
          if (args.from.toLowerCase() === address!.toLowerCase()) continue
          records.push({
            direction: 'received',
            from: args.from,
            to: args.to,
            amount: parseFloat(formatEther(args.value)).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            }),
            txHash: log.transactionHash as `0x${string}`,
            blockNumber: log.blockNumber ?? 0n,
          })
        }

        // Most recent first, cap at 10
        records.sort((a, b) =>
          a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
        )

        if (!cancelled) setTransfers(records.slice(0, 10))
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch transfer history'
          setError(msg)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchTransfers()
    return () => {
      cancelled = true
    }
  }, [address, addrs, client])

  return { transfers, isLoading, error }
}

// ---- portfolio base hook ----

/**
 * Provides the CLAW wallet balance and the full market list.
 * Combine with per-market useMarketStats calls for full portfolio view.
 */
export function usePortfolioBase() {
  const { balance, formatted, isLoading: balLoading } = useClawliaBalance()
  const { markets, isLoading: marketsLoading } = useMarkets()

  return {
    clawBalance: parseFloat(formatted),
    rawBalance: balance,
    markets,
    isLoading: balLoading || marketsLoading,
  }
}
