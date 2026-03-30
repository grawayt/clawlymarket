/** A market listed by the factory */
export interface Market {
  /** On-chain address of the PredictionMarket contract */
  address: string
  /** The question this market resolves */
  question: string
  /** Unix timestamp when the market can be resolved */
  resolutionTimestamp: bigint
  /** Address of the resolver (oracle) */
  resolver: string
  /** Whether the market has already been resolved */
  resolved: boolean
}

/** Full detail for a single market including AMM state */
export interface MarketDetail extends Market {
  /** YES token reserve in the FPMM pool (18 decimals) */
  reserveYes: bigint
  /** NO token reserve in the FPMM pool (18 decimals) */
  reserveNo: bigint
  /** Total collateral locked in the market (18 decimals) */
  totalCollateral: bigint
  /** Implied YES probability in basis points (0–10000) */
  yesProbBps: bigint
  /** Implied NO probability in basis points (0–10000) */
  noProbBps: bigint
  /** Outcome index if resolved (0 = YES, 1 = NO), undefined if not resolved */
  outcome?: bigint
}

/** ERC-1155 YES/NO position balances for an address in a market */
export interface Positions {
  /** YES position token balance (18 decimals) */
  yes: bigint
  /** NO position token balance (18 decimals) */
  no: bigint
}

/**
 * Groth16 proof data from circom / snarkjs, used for the ZK Email registration flow.
 * All values are decimal string representations of field elements.
 */
export interface ProofData {
  /** Proof point A: [x, y] */
  pA: [string, string]
  /** Proof point B: [[x1,x2],[y1,y2]] */
  pB: [[string, string], [string, string]]
  /** Proof point C: [x, y] */
  pC: [string, string]
  /** Nullifier — prevents double-registration */
  nullifier: string
  /** Hash of the API-provider DKIM public key */
  pubkeyHash: string
}

/** Result returned after a write transaction is mined */
export interface TxResult {
  /** Transaction hash */
  hash: string
  /** Block number the tx was included in */
  blockNumber: bigint
  /** Gas actually used */
  gasUsed: bigint
  /** Whether the tx succeeded (status 1) */
  success: boolean
}

/** Config passed to the ClawlyMarket constructor */
export interface ClawlyMarketConfig {
  /** JSON-RPC endpoint, e.g. "https://sepolia-rollup.arbitrum.io/rpc" */
  rpcUrl: string
  /** Hex private key (with or without 0x prefix). Required for write methods. */
  privateKey: string
  /** Chain ID. Defaults to 421614 (Arbitrum Sepolia). */
  chainId?: number
}
