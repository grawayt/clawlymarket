/** Per-chain contract addresses. Update after each deployment. */
export interface ContractAddresses {
  clawliaToken: string
  modelRegistry: string
  marketFactory: string
  zkVerifier: string
  captchaGate: string
}

export const ADDRESSES: Record<number, ContractAddresses> = {
  // Anvil local devnet
  31337: {
    zkVerifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    clawliaToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    modelRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    captchaGate: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    marketFactory: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  },
  // Arbitrum Sepolia (testnet)
  421614: {
    clawliaToken: '0xDbca0D2943041A86363e01dA6E2FEC2BC70D58a7',
    modelRegistry: '0x68F4919eF05cA7f705ad0666690c8c80c82aae7F',
    marketFactory: '0xB6E248945F7fDF1eDa9B8e98958428a170Fdb6E0',
    captchaGate: '0x2c90c7f8D8bcFfA1780a4eB674657582c0AD5E96',
    zkVerifier: '0x7be255Bf0c978226AeeA5541fF7B5D583948c6A0',
  },
  // Arbitrum mainnet — not yet deployed
}

/** Returns addresses for the given chain, throwing if unknown. */
export function getAddresses(chainId: number): ContractAddresses {
  const addrs = ADDRESSES[chainId]
  if (!addrs) {
    throw new Error(
      `No contract addresses for chainId ${chainId}. ` +
        `Supported chains: ${Object.keys(ADDRESSES).join(', ')}`
    )
  }
  return addrs
}
