import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatEther } from 'viem'
import { clawliaTokenAbi } from '../contracts/ClawliaTokenAbi'
import { useContractAddresses } from './useContracts'

export function useClawliaBalance() {
  const { address } = useAccount()
  const addrs = useContractAddresses()

  const { data, refetch, isLoading } = useReadContract({
    address: addrs?.clawliaToken,
    abi: clawliaTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!addrs },
  })

  return {
    balance: data as bigint | undefined,
    formatted: data ? formatEther(data as bigint) : '0',
    refetch,
    isLoading,
  }
}

export function useIsVerified() {
  const { address } = useAccount()
  const addrs = useContractAddresses()

  const { data, refetch, isLoading } = useReadContract({
    address: addrs?.clawliaToken,
    abi: clawliaTokenAbi,
    functionName: 'verified',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!addrs },
  })

  return {
    isVerified: data as boolean | undefined,
    refetch,
    isLoading,
  }
}

export function useClawliaApprove() {
  const addrs = useContractAddresses()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const approve = (spender: `0x${string}`, amount: bigint) => {
    if (!addrs) return
    writeContract({
      address: addrs.clawliaToken,
      abi: clawliaTokenAbi,
      functionName: 'approve',
      args: [spender, amount],
    })
  }

  return { approve, isPending, isConfirming, isSuccess, hash }
}
