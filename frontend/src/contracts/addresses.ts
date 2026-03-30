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
    zkVerifier: '0x57c0C95f188E787Bc2540BD9903e09b0e7b10440',
    clawliaToken: '0x8DD72e134641e0Ef04e8CD1aE97566F21E2f816a',
    modelRegistry: '0xECD445CAd04f6a1ac0f0C3eC0FD48140B4381586',
    captchaGate: '0x30b619BAed6DcD055e28228cA7E113681AeCb6B3',
    marketFactory: '0xC1e8E62021DB22C416Ad41CE9472C1D3f07EAE02',
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
