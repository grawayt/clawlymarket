import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { predictionMarketAbi } from '../contracts/PredictionMarketAbi'

export function useMarketData(marketAddress: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: marketAddress ? [
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'question' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'resolutionTimestamp' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'resolver' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'resolved' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'outcome' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'reserveYes' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'reserveNo' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'getImpliedProbability' },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'totalCollateral' },
    ] : [],
    query: { enabled: !!marketAddress },
  })

  if (!data) return { isLoading, refetch, market: null }

  return {
    isLoading,
    refetch,
    market: {
      question: data[0]?.result as string | undefined,
      resolutionTimestamp: data[1]?.result as bigint | undefined,
      resolver: data[2]?.result as `0x${string}` | undefined,
      resolved: data[3]?.result as boolean | undefined,
      outcome: data[4]?.result as bigint | undefined,
      reserveYes: data[5]?.result as bigint | undefined,
      reserveNo: data[6]?.result as bigint | undefined,
      probability: data[7]?.result as readonly [bigint, bigint] | undefined,
      totalCollateral: data[8]?.result as bigint | undefined,
    },
  }
}

export function useMarketPositions(marketAddress: `0x${string}` | undefined) {
  const { address } = useAccount()

  const { data, isLoading, refetch } = useReadContracts({
    contracts: marketAddress && address ? [
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'balanceOf', args: [address, 0n] },
      { address: marketAddress, abi: predictionMarketAbi, functionName: 'balanceOf', args: [address, 1n] },
    ] : [],
    query: { enabled: !!marketAddress && !!address },
  })

  return {
    yesBalance: data?.[0]?.result as bigint | undefined,
    noBalance: data?.[1]?.result as bigint | undefined,
    isLoading,
    refetch,
  }
}

export function useBuy(marketAddress: `0x${string}` | undefined) {
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const buy = async (outcomeIndex: bigint, amount: bigint, minTokensOut: bigint = 0n) => {
    if (!marketAddress) return
    await writeContractAsync({
      address: marketAddress,
      abi: predictionMarketAbi,
      functionName: 'buy',
      args: [outcomeIndex, amount, minTokensOut],
    })
  }

  return { buy, isPending, isConfirming, isSuccess, hash }
}

export function useSell(marketAddress: `0x${string}` | undefined) {
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const sell = async (outcomeIndex: bigint, tokenAmount: bigint, minCollateralOut: bigint = 0n) => {
    if (!marketAddress) return
    await writeContractAsync({
      address: marketAddress,
      abi: predictionMarketAbi,
      functionName: 'sell',
      args: [outcomeIndex, tokenAmount, minCollateralOut],
    })
  }

  return { sell, isPending, isConfirming, isSuccess, hash }
}
