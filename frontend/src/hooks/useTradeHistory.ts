import { useEffect, useState } from 'react'
import { usePublicClient, useAccount } from 'wagmi'
import { predictionMarketAbi } from '../contracts/PredictionMarketAbi'

export interface TradeEvent {
  trader: `0x${string}`
  outcomeIndex: bigint
  isBuy: boolean
  collateralAmount: bigint
  tokenAmount: bigint
  blockNumber: bigint
  transactionHash: `0x${string}`
}

export function useTradeHistory(marketAddress: `0x${string}` | undefined) {
  const client = usePublicClient()
  const [trades, setTrades] = useState<TradeEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!marketAddress || !client) return

    let cancelled = false

    async function fetchTrades() {
      setIsLoading(true)
      setError(null)
      try {
        const logs = await client!.getContractEvents({
          address: marketAddress,
          abi: predictionMarketAbi,
          eventName: 'Trade',
          fromBlock: 0n,
        })

        if (cancelled) return

        const parsed: TradeEvent[] = logs.map((log) => ({
          trader: log.args.trader as `0x${string}`,
          outcomeIndex: log.args.outcomeIndex as bigint,
          isBuy: log.args.isBuy as boolean,
          collateralAmount: log.args.collateral as bigint,
          tokenAmount: log.args.tokens as bigint,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash as `0x${string}`,
        }))

        parsed.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0))

        setTrades(parsed)
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to fetch trade history')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchTrades()
    return () => { cancelled = true }
  }, [marketAddress, client])

  return { trades, isLoading, error }
}

export function useUserTradeHistory(marketAddress?: `0x${string}`) {
  const { address: userAddress } = useAccount()
  const client = usePublicClient()
  const [trades, setTrades] = useState<TradeEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userAddress || !client) return

    let cancelled = false

    async function fetchUserTrades() {
      setIsLoading(true)
      setError(null)
      try {
        const logs = await client!.getContractEvents({
          address: marketAddress,
          abi: predictionMarketAbi,
          eventName: 'Trade',
          args: { trader: userAddress },
          fromBlock: 0n,
        })

        if (cancelled) return

        const parsed: TradeEvent[] = logs.map((log) => ({
          trader: log.args.trader as `0x${string}`,
          outcomeIndex: log.args.outcomeIndex as bigint,
          isBuy: log.args.isBuy as boolean,
          collateralAmount: log.args.collateral as bigint,
          tokenAmount: log.args.tokens as bigint,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash as `0x${string}`,
        }))

        parsed.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0))

        setTrades(parsed)
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to fetch trade history')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchUserTrades()
    return () => { cancelled = true }
  }, [marketAddress, userAddress, client])

  return { trades, isLoading, error }
}
