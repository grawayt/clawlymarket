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

const DEFAULT_SLIPPAGE_BPS = 200n // 2%

function applySlippage(amount: bigint): bigint {
  return amount * (10000n - DEFAULT_SLIPPAGE_BPS) / 10000n
}

export function useBuy(marketAddress: `0x${string}` | undefined) {
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const { market } = useMarketData(marketAddress)

  const buy = async (outcomeIndex: bigint, amount: bigint, minTokensOut?: bigint) => {
    if (!marketAddress) return
    if (minTokensOut === undefined && market?.reserveYes != null && market?.reserveNo != null) {
      // Estimate output using FPMM formula, then apply 2% slippage tolerance
      const feeBps = 200n
      const netAmount = amount - (amount * feeBps) / 10000n
      const rYes = market.reserveYes + netAmount
      const rNo = market.reserveNo + netAmount
      const k = market.reserveYes * market.reserveNo
      const tokensOut = outcomeIndex === 0n
        ? rYes - k / rNo
        : rNo - k / rYes
      minTokensOut = applySlippage(tokensOut)
    }
    await writeContractAsync({
      address: marketAddress,
      abi: predictionMarketAbi,
      functionName: 'buy',
      args: [outcomeIndex, amount, minTokensOut ?? 0n],
    })
  }

  return { buy, isPending, isConfirming, isSuccess, hash }
}

export function useSell(marketAddress: `0x${string}` | undefined) {
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const { market } = useMarketData(marketAddress)

  const sell = async (outcomeIndex: bigint, tokenAmount: bigint, minCollateralOut?: bigint) => {
    if (!marketAddress) return
    if (minCollateralOut === undefined && market?.reserveYes != null && market?.reserveNo != null) {
      // Estimate output using FPMM sell formula, then apply 2% slippage tolerance
      const k = market.reserveYes * market.reserveNo
      let rYes = market.reserveYes
      let rNo = market.reserveNo
      if (outcomeIndex === 0n) rYes += tokenAmount
      else rNo += tokenAmount
      const sum = rYes + rNo
      const product = rYes * rNo
      const discriminant = sum * sum - 4n * (product - k)
      const sqrtDisc = sqrt(discriminant)
      const grossOut = (sum - sqrtDisc) / 2n
      const feeBps = 200n
      const collateralOut = grossOut - (grossOut * feeBps) / 10000n
      minCollateralOut = applySlippage(collateralOut)
    }
    await writeContractAsync({
      address: marketAddress,
      abi: predictionMarketAbi,
      functionName: 'sell',
      args: [outcomeIndex, tokenAmount, minCollateralOut ?? 0n],
    })
  }

  return { sell, isPending, isConfirming, isSuccess, hash }
}

function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n
  let z = x
  let y = (z + 1n) / 2n
  while (y < z) {
    z = y
    y = (x / z + z) / 2n
  }
  return z
}
