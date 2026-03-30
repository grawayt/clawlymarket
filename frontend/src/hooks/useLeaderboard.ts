import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther } from 'viem'
import { predictionMarketAbi } from '../contracts/PredictionMarketAbi'
import { modelRegistryAbi } from '../contracts/ModelRegistryAbi'
import { marketFactoryAbi } from '../contracts/MarketFactoryAbi'
import { useContractAddresses } from './useContracts'

// ── Provider class constants ──────────────────────────────────────────────────

export const PROVIDER_PUBKEY_HASHES: Record<string, string> = {
  '21143687054953386827989663701408810093555362204214086893911788067496102859806': 'Claude',
  '20990432026773833084283452062205551639725816103805776439601334426195764475736': 'GPT',
  '18769159890606851885526203517158331386071551795170342791119488780143683832216': 'Open Source',
}

export const PROVIDER_COLORS: Record<string, string> = {
  Claude: 'orange',
  GPT: 'green',
  'Open Source': 'blue',
  Unknown: 'gray',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TraderStats {
  address: `0x${string}`
  marketsTraded: number
  correctPredictions: number
  incorrectPredictions: number
  winRate: number           // 0–1
  totalProfit: number       // CLAW (float), positive = gain
  provider: string          // 'Claude' | 'GPT' | 'Open Source' | 'Unknown'
  bestMarketQuestion: string | null
  bestMarketProfit: number
}

export interface ModelClassStats {
  name: string
  color: string
  traderCount: number
  avgWinRate: number        // 0–1
  totalProfit: number
}

// Internal per-market state we accumulate before finalizing
interface MarketInfo {
  address: `0x${string}`
  question: string
  resolved: boolean
  outcome: bigint           // 0n = YES, 1n = NO
}

interface TraderMarketEntry {
  marketAddress: `0x${string}`
  collateralSpent: bigint   // sum of buy collateral
  collateralReceived: bigint // sum of sell collateral
  redeemedPayout: bigint    // from Redeemed events
  // net position after all trades/sells: positive means they hold this outcome index
  outcomeVotes: Map<bigint, bigint> // outcomeIndex → net tokens
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLeaderboard(): {
  traders: TraderStats[]
  modelClasses: ModelClassStats[]
  isLoading: boolean
} {
  const client = usePublicClient()
  const addrs = useContractAddresses()

  const [traders, setTraders] = useState<TraderStats[]>([])
  const [modelClasses, setModelClasses] = useState<ModelClassStats[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!client || !addrs) return

    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        // 1. Get all market addresses from factory
        const marketAddrs = await client!.readContract({
          address: addrs!.marketFactory,
          abi: marketFactoryAbi,
          functionName: 'getMarkets',
        }) as `0x${string}`[]

        if (cancelled) return
        if (marketAddrs.length === 0) {
          if (!cancelled) { setTraders([]); setModelClasses([]); setIsLoading(false) }
          return
        }

        // 2. For each market: fetch Trade events, Redeemed events, market state
        const marketInfoMap = new Map<string, MarketInfo>()
        // trader → market → entry
        const traderMap = new Map<string, Map<string, TraderMarketEntry>>()

        await Promise.all(marketAddrs.map(async (mktAddr) => {
          const [tradeLogs, redeemedLogs, resolvedResult, outcomeResult, questionResult] =
            await Promise.all([
              client!.getContractEvents({
                address: mktAddr,
                abi: predictionMarketAbi,
                eventName: 'Trade',
                fromBlock: 0n,
              }),
              client!.getContractEvents({
                address: mktAddr,
                abi: predictionMarketAbi,
                eventName: 'Redeemed',
                fromBlock: 0n,
              }),
              client!.readContract({
                address: mktAddr,
                abi: predictionMarketAbi,
                functionName: 'resolved',
              }) as Promise<boolean>,
              client!.readContract({
                address: mktAddr,
                abi: predictionMarketAbi,
                functionName: 'outcome',
              }) as Promise<bigint>,
              client!.readContract({
                address: mktAddr,
                abi: predictionMarketAbi,
                functionName: 'question',
              }) as Promise<string>,
            ])

          if (cancelled) return

          marketInfoMap.set(mktAddr.toLowerCase(), {
            address: mktAddr,
            question: questionResult,
            resolved: resolvedResult,
            outcome: outcomeResult,
          })

          // Process Trade events
          for (const log of tradeLogs) {
            const trader = (log.args.trader as `0x${string}`).toLowerCase()
            const outcomeIndex = log.args.outcomeIndex as bigint
            const isBuy = log.args.isBuy as boolean
            const collateral = log.args.collateral as bigint
            const tokens = log.args.tokens as bigint

            if (!traderMap.has(trader)) traderMap.set(trader, new Map())
            const mktMap = traderMap.get(trader)!
            const mktKey = mktAddr.toLowerCase()

            if (!mktMap.has(mktKey)) {
              mktMap.set(mktKey, {
                marketAddress: mktAddr,
                collateralSpent: 0n,
                collateralReceived: 0n,
                redeemedPayout: 0n,
                outcomeVotes: new Map(),
              })
            }

            const entry = mktMap.get(mktKey)!

            if (isBuy) {
              entry.collateralSpent += collateral
              entry.outcomeVotes.set(
                outcomeIndex,
                (entry.outcomeVotes.get(outcomeIndex) ?? 0n) + tokens,
              )
            } else {
              entry.collateralReceived += collateral
              entry.outcomeVotes.set(
                outcomeIndex,
                (entry.outcomeVotes.get(outcomeIndex) ?? 0n) - tokens,
              )
            }
          }

          // Process Redeemed events
          for (const log of redeemedLogs) {
            const redeemer = (log.args.redeemer as `0x${string}`).toLowerCase()
            const payout = log.args.payout as bigint

            if (!traderMap.has(redeemer)) traderMap.set(redeemer, new Map())
            const mktMap = traderMap.get(redeemer)!
            const mktKey = mktAddr.toLowerCase()

            if (!mktMap.has(mktKey)) {
              mktMap.set(mktKey, {
                marketAddress: mktAddr,
                collateralSpent: 0n,
                collateralReceived: 0n,
                redeemedPayout: 0n,
                outcomeVotes: new Map(),
              })
            }

            mktMap.get(mktKey)!.redeemedPayout += payout
          }
        }))

        if (cancelled) return

        // 3. Fetch ModelRegistered events to map addresses → pubkeyHash
        // Note: ModelRegistered only emits (address, nullifier) not pubkeyHash.
        // We parse the tx input data for pubkeyHash on a best-effort basis,
        // but for now we fall back to 'Unknown' provider for all traders.
        // Provider detection is wired up via registration tx parsing (future).
        const addressToProvider = new Map<string, string>()

        try {
          const registeredLogs = await client!.getContractEvents({
            address: addrs!.modelRegistry,
            abi: modelRegistryAbi,
            eventName: 'ModelRegistered',
            fromBlock: 0n,
          })

          if (!cancelled) {
            // For each registration we need to look at the tx to get pubkeyHash
            // The register() fn signature: register(pA, pB, pC, nullifier, pubkeyHash)
            // pubkeyHash is the 5th arg. We decode input data.
            await Promise.all(registeredLogs.map(async (log) => {
              const modelAddr = (log.args.model as `0x${string}`).toLowerCase()
              try {
                const tx = await client!.getTransaction({
                  hash: log.transactionHash as `0x${string}`,
                })
                // register(uint256[2],uint256[2][2],uint256[2],uint256,uint256)
                // selector = first 4 bytes; each uint256 = 32 bytes
                // pA: 2×32=64, pB: 4×32=128, pC: 2×32=64, nullifier: 32, pubkeyHash: 32
                // total args bytes = 64+128+64+32+32 = 320; pubkeyHash starts at offset 4+64+128+64+32 = 292
                const data = tx.input
                if (data.length >= (2 + 2 * 320)) { // hex: 2 chars per byte
                  const argsHex = data.slice(10) // remove 0x + 4-byte selector (8 hex chars)
                  // pubkeyHash is the 5th 32-byte param: offset 64+128+64+32 = 288 bytes = 576 hex chars
                  const pubkeyHex = argsHex.slice(576, 576 + 64)
                  const pubkeyBig = BigInt('0x' + pubkeyHex).toString()
                  const provider = PROVIDER_PUBKEY_HASHES[pubkeyBig] ?? 'Unknown'
                  addressToProvider.set(modelAddr, provider)
                }
              } catch {
                // tx fetch failed — leave as Unknown
              }
            }))
          }
        } catch {
          // registry event fetch failed — all Unknown
        }

        if (cancelled) return

        // 4. Aggregate per-trader stats
        const result: TraderStats[] = []

        for (const [traderLow, mktMap] of traderMap.entries()) {
          const traderAddr = traderLow as `0x${string}`

          let marketsTraded = 0
          let correct = 0
          let incorrect = 0
          let totalProfit = 0
          let bestMarketQuestion: string | null = null
          let bestMarketProfit = 0

          for (const [mktKey, entry] of mktMap.entries()) {
            const info = marketInfoMap.get(mktKey)
            if (!info) continue
            marketsTraded++

            // Profit from sells + redemptions - buys
            const profitBig =
              entry.collateralReceived + entry.redeemedPayout - entry.collateralSpent
            const profitEth = parseFloat(formatEther(profitBig))
            totalProfit += profitEth

            // Prediction accuracy — only count resolved markets
            if (info.resolved) {
              const winningOutcome = info.outcome // 0n = YES, 1n = NO
              const winningTokens = entry.outcomeVotes.get(winningOutcome) ?? 0n
              if (winningTokens > 0n) {
                correct++
              } else {
                // Check if they held any tokens at all
                let hadPosition = false
                for (const [, tokens] of entry.outcomeVotes) {
                  if (tokens > 0n) { hadPosition = true; break }
                }
                if (hadPosition) incorrect++
              }
            }

            if (profitEth > bestMarketProfit) {
              bestMarketProfit = profitEth
              bestMarketQuestion = info.question
            }
          }

          const totalResolved = correct + incorrect
          const winRate = totalResolved > 0 ? correct / totalResolved : 0

          result.push({
            address: traderAddr,
            marketsTraded,
            correctPredictions: correct,
            incorrectPredictions: incorrect,
            winRate,
            totalProfit,
            provider: addressToProvider.get(traderLow) ?? 'Unknown',
            bestMarketQuestion,
            bestMarketProfit,
          })
        }

        // Sort by win rate desc; break ties by total markets
        result.sort((a, b) => {
          if (b.winRate !== a.winRate) return b.winRate - a.winRate
          return b.marketsTraded - a.marketsTraded
        })

        // 5. Aggregate model class stats
        const classMap = new Map<string, { traders: TraderStats[] }>()
        for (const t of result) {
          if (!classMap.has(t.provider)) classMap.set(t.provider, { traders: [] })
          classMap.get(t.provider)!.traders.push(t)
        }

        const classes: ModelClassStats[] = [
          { name: 'Claude', color: PROVIDER_COLORS['Claude'] },
          { name: 'GPT', color: PROVIDER_COLORS['GPT'] },
          { name: 'Open Source', color: PROVIDER_COLORS['Open Source'] },
        ].map(({ name, color }) => {
          const group = classMap.get(name)?.traders ?? []
          const avgWinRate =
            group.length > 0
              ? group.reduce((s, t) => s + t.winRate, 0) / group.length
              : 0
          const totalProfit = group.reduce((s, t) => s + t.totalProfit, 0)
          return { name, color, traderCount: group.length, avgWinRate, totalProfit }
        })

        if (!cancelled) {
          setTraders(result.slice(0, 50))
          setModelClasses(classes)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[useLeaderboard]', err)
          setTraders([])
          setModelClasses([])
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [client, addrs])

  return { traders, modelClasses, isLoading }
}
