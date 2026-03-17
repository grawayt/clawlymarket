import { http, createConfig } from 'wagmi'
import { arbitrum, arbitrumSepolia, foundry } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID ?? ''

export const config = createConfig({
  chains: [foundry, arbitrumSepolia, arbitrum],
  connectors: [
    injected(),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID })] : []),
  ],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [arbitrumSepolia.id]: http(),
    [arbitrum.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
