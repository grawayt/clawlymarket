import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { marketFactoryAbi } from '../contracts/MarketFactoryAbi'
import { useContractAddresses } from './useContracts'

export function useMarkets() {
  const addrs = useContractAddresses()

  const { data: marketAddresses, refetch, isLoading } = useReadContract({
    address: addrs?.marketFactory,
    abi: marketFactoryAbi,
    functionName: 'getMarkets',
    query: { enabled: !!addrs },
  })

  return {
    markets: (marketAddresses as `0x${string}`[]) ?? [],
    refetch,
    isLoading,
  }
}

export function useCreateMarket() {
  const addrs = useContractAddresses()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const createMarket = (
    question: string,
    resolutionTimestamp: bigint,
    resolver: `0x${string}`,
    initialLiquidity: bigint,
  ) => {
    if (!addrs) return
    writeContract({
      address: addrs.marketFactory,
      abi: marketFactoryAbi,
      functionName: 'createMarket',
      args: [question, resolutionTimestamp, resolver, initialLiquidity],
    })
  }

  return { createMarket, isPending, isConfirming, isSuccess, hash }
}
