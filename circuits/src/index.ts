/**
 * circuits/src/index.ts
 *
 * Public API for the ClawlyMarket ZK circuits package.
 * Exports the Merkle tree management library and the proof generation utility.
 */

// Merkle tree management (built by parallel agent — will exist at runtime).
export * from "./merkle-tree";

// Proof generation and verification.
export * from "./prove";
