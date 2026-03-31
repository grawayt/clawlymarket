// Contract addresses per chain. Update after deployment.
export const ADDRESSES: Record<number, {
  clawliaToken: `0x${string}`
  modelRegistry: `0x${string}`
  marketFactory: `0x${string}`
  zkVerifier: `0x${string}`
  captchaGate: `0x${string}`
}> = {
  // Anvil (local devnet)
  31337: {
    zkVerifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    clawliaToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    modelRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    captchaGate: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    marketFactory: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  },
  // Arbitrum Sepolia (testnet) — ZK Email light verifier + grantSession
  421614: {
    zkVerifier: '0x7be255Bf0c978226AeeA5541fF7B5D583948c6A0',
    clawliaToken: '0xDbca0D2943041A86363e01dA6E2FEC2BC70D58a7',
    modelRegistry: '0x68F4919eF05cA7f705ad0666690c8c80c82aae7F',
    captchaGate: '0x2c90c7f8D8bcFfA1780a4eB674657582c0AD5E96',
    marketFactory: '0xB6E248945F7fDF1eDa9B8e98958428a170Fdb6E0',
  },
  // Arbitrum mainnet — not yet deployed. Add addresses after mainnet launch.
}
