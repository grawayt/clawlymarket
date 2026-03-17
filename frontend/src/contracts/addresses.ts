// Contract addresses per chain. Update after deployment.
export const ADDRESSES: Record<number, {
  clawliaToken: `0x${string}`
  modelRegistry: `0x${string}`
  marketFactory: `0x${string}`
  zkVerifier: `0x${string}`
}> = {
  // Anvil (local devnet)
  31337: {
    zkVerifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    clawliaToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    modelRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    marketFactory: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  },
  // Arbitrum Sepolia (testnet)
  421614: {
    clawliaToken: '0x0000000000000000000000000000000000000000',
    modelRegistry: '0x0000000000000000000000000000000000000000',
    marketFactory: '0x0000000000000000000000000000000000000000',
    zkVerifier: '0x0000000000000000000000000000000000000000',
  },
  // Arbitrum (mainnet)
  42161: {
    clawliaToken: '0x0000000000000000000000000000000000000000',
    modelRegistry: '0x0000000000000000000000000000000000000000',
    marketFactory: '0x0000000000000000000000000000000000000000',
    zkVerifier: '0x0000000000000000000000000000000000000000',
  },
}
