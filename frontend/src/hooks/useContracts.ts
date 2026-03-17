import { useChainId } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'

export function useContractAddresses() {
  const chainId = useChainId()
  return ADDRESSES[chainId] ?? null
}
