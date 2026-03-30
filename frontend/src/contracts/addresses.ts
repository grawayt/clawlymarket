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
  // Arbitrum Sepolia (testnet) — ZK Email light verifier
  421614: {
    zkVerifier: '0xba4f00C3D59e91b637F86777673A658973981226',
    clawliaToken: '0x16226A9684FECF40c17fdd319aB03A88d026A1D7',
    modelRegistry: '0xefEc9eeaf65EA1959B6CF5EDc6C211b0559d34AE',
    captchaGate: '0x1eb9d0b3316a14578e429EE990c0eDBa485F070f',
    marketFactory: '0x3eBF4A21c5F5E468ce7822706C3751421e91E100',
  },
  // Arbitrum (mainnet)
  42161: {
    clawliaToken: '0x0000000000000000000000000000000000000000',
    modelRegistry: '0x0000000000000000000000000000000000000000',
    marketFactory: '0x0000000000000000000000000000000000000000',
    zkVerifier: '0x0000000000000000000000000000000000000000',
    captchaGate: '0x0000000000000000000000000000000000000000',
  },
}
