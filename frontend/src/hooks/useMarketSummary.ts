import { useReadContracts } from 'wagmi'
import { predictionMarketAbi } from '../contracts/PredictionMarketAbi'

export interface MarketSummary {
  address: `0x${string}`
  question: string | undefined
  resolved: boolean | undefined
  totalCollateral: bigint | undefined
  resolutionTimestamp: bigint | undefined
}

export function useMarketSummary(marketAddress: `0x${string}` | undefined): {
  summary: MarketSummary | null
  isLoading: boolean
} {
  const { data, isLoading } = useReadContracts({
    contracts: marketAddress
      ? [
          { address: marketAddress, abi: predictionMarketAbi, functionName: 'question' },
          { address: marketAddress, abi: predictionMarketAbi, functionName: 'resolved' },
          { address: marketAddress, abi: predictionMarketAbi, functionName: 'totalCollateral' },
          { address: marketAddress, abi: predictionMarketAbi, functionName: 'resolutionTimestamp' },
        ]
      : [],
    query: { enabled: !!marketAddress },
  })

  if (!marketAddress) return { summary: null, isLoading: false }
  if (!data) return { summary: null, isLoading }

  return {
    isLoading,
    summary: {
      address: marketAddress,
      question: data[0]?.result as string | undefined,
      resolved: data[1]?.result as boolean | undefined,
      totalCollateral: data[2]?.result as bigint | undefined,
      resolutionTimestamp: data[3]?.result as bigint | undefined,
    },
  }
}
