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
    captchaGate: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    marketFactory: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  },
  // Arbitrum Sepolia (testnet)
  421614: {
    zkVerifier: '0xa1896930A4750F934fa38e1F0C38f1929d17387c',
    clawliaToken: '0x8fe64d57a8AD52fd8eeA453990f1B6e010248335',
    modelRegistry: '0xA9Fe2f7Af79253DAcFe4F3b52926B6E8b052d6cD',
    captchaGate: '0x9f53a17Ce2D657eFB0ad09775cd4F50B2e92a75c',
    marketFactory: '0xbCf3a698B01537c39AB97214E5cDF38Bfec1598A',
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
