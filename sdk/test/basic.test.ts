/**
 * Basic smoke tests for the SDK — no live network required.
 * Run with: ts-node test/basic.test.ts
 */
import { ClawlyMarket, getAddresses, ADDRESSES } from '../src/index'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`PASS: ${message}`)
}

// ---------------------------------------------------------------------------
// Address lookups
// ---------------------------------------------------------------------------

assert(
  typeof ADDRESSES[421614] === 'object',
  'ADDRESSES contains Arbitrum Sepolia (421614)'
)
assert(
  typeof ADDRESSES[31337] === 'object',
  'ADDRESSES contains Anvil local (31337)'
)

const arbSepolia = getAddresses(421614)
assert(
  arbSepolia.clawliaToken.startsWith('0x'),
  'clawliaToken address is a hex string'
)
assert(
  arbSepolia.marketFactory.startsWith('0x'),
  'marketFactory address is a hex string'
)

// ---------------------------------------------------------------------------
// Constructor / config
// ---------------------------------------------------------------------------

const cm = new ClawlyMarket({
  rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  // Use a dummy key for offline tests — never send txs in this test
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  chainId: 421614,
})

assert(
  cm.signerAddress === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  'signer address derived correctly from private key'
)

assert(
  cm.connectedChainId === 421614,
  'connectedChainId returns configured chainId'
)

// ---------------------------------------------------------------------------
// Default chain
// ---------------------------------------------------------------------------

const cmDefault = new ClawlyMarket({
  rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
})

assert(
  cmDefault.connectedChainId === 421614,
  'defaults to Arbitrum Sepolia (421614) when chainId not provided'
)

// ---------------------------------------------------------------------------
// Unknown chain
// ---------------------------------------------------------------------------

let threw = false
try {
  getAddresses(99999)
} catch {
  threw = true
}
assert(threw, 'getAddresses throws for unknown chainId')

console.log('\nAll tests passed.')
