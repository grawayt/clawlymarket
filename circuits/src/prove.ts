/**
 * Proof generation utility for ClawlyMarket ZK membership proofs.
 *
 * Bridges the Merkle tree state and snarkjs to produce Groth16 proofs
 * formatted for on-chain submission via ModelRegistry.register().
 */

import * as path from "path";
import * as fs from "fs";
// snarkjs ships as CommonJS; the default export is the full API object.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

// ---------------------------------------------------------------------------
// Default file paths (Node.js / server-side). Override for browser use.
// ---------------------------------------------------------------------------

const DEFAULT_WASM_PATH = path.resolve(
  __dirname,
  "../build/api-key-email_js/api-key-email.wasm"
);
const DEFAULT_ZKEY_PATH = path.resolve(__dirname, "../keys/membership.zkey");
const DEFAULT_VKEY_PATH = path.resolve(
  __dirname,
  "../keys/verification_key.json"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Solidity-ready proof components plus public signals.
 *
 * pA, pB, pC match the argument order of the auto-generated Groth16Verifier
 * contract.  Note that pi_b coordinates are already swapped here (snarkjs
 * exportSolidityCallData handles the swap internally).
 */
export interface ProofResult {
  /** G1 point — [x, y] as 0x-prefixed decimal strings */
  pA: [string, string];
  /** G2 point — [[x1,x2],[y1,y2]] with coordinates swapped for Solidity */
  pB: [[string, string], [string, string]];
  /** G1 point — [x, y] as 0x-prefixed decimal strings */
  pC: [string, string];
  /** Poseidon(secret) — prevents double-registration */
  nullifier: string;
  /** Merkle root that was proven against */
  root: string;
  /** Raw snarkjs proof object — useful for debugging / local verification */
  rawProof: any;
  /** Raw public signals array in circuit order: [root, nullifier] */
  rawPublicSignals: string[];
}

/** Configurable file paths so callers can substitute in-memory blobs for browser use. */
export interface ProofPaths {
  wasmPath?: string;
  zkeyPath?: string;
  vkeyPath?: string;
}

// ---------------------------------------------------------------------------
// Core: generateProof
// ---------------------------------------------------------------------------

/**
 * Generates a Groth16 membership proof.
 *
 * @param secret       Private field element representing the API key / email hash.
 * @param pathElements Array of 10 sibling hashes along the Merkle path.
 * @param pathIndices  Array of 10 path bits (0 = go left, 1 = go right).
 * @param root         Public Merkle root stored on-chain.
 * @param paths        Optional overrides for WASM / zkey paths (browser / test use).
 */
export async function generateProof(
  secret: bigint,
  pathElements: bigint[],
  pathIndices: number[],
  root: bigint,
  paths: ProofPaths = {}
): Promise<ProofResult> {
  if (pathElements.length !== 10) {
    throw new Error(
      `pathElements must have exactly 10 elements, got ${pathElements.length}`
    );
  }
  if (pathIndices.length !== 10) {
    throw new Error(
      `pathIndices must have exactly 10 elements, got ${pathIndices.length}`
    );
  }

  const wasmPath = paths.wasmPath ?? DEFAULT_WASM_PATH;
  const zkeyPath = paths.zkeyPath ?? DEFAULT_ZKEY_PATH;

  // Build the circuit input.  snarkjs accepts bigints or decimal strings.
  const input = {
    secret: secret.toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices: pathIndices.map((i) => i.toString()),
    root: root.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  // publicSignals order from snarkjs: outputs first, then inputs.
  // So: [nullifier, root].
  const formatted = await formatForContract(proof, publicSignals);

  return {
    pA: formatted.pA,
    pB: formatted.pB,
    pC: formatted.pC,
    nullifier: formatted.nullifier,
    root: formatted.root,
    rawProof: proof,
    rawPublicSignals: publicSignals,
  };
}

// ---------------------------------------------------------------------------
// Local verification
// ---------------------------------------------------------------------------

/**
 * Verifies a proof against the bundled verification key without hitting the chain.
 *
 * Useful for CI / smoke-testing before submitting an on-chain transaction.
 *
 * @param proof  A ProofResult returned by generateProof().
 * @param paths  Optional path overrides.
 */
export async function verifyProofLocally(
  proof: ProofResult,
  paths: ProofPaths = {}
): Promise<boolean> {
  const vkeyPath = paths.vkeyPath ?? DEFAULT_VKEY_PATH;
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));

  // snarkjs.groth16.verify(vkey, publicSignals, proof)
  // publicSignals must be in the same order the circuit produced them.
  return snarkjs.groth16.verify(vkey, proof.rawPublicSignals, proof.rawProof);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw snarkjs proof + public signals into the components expected
 * by the on-chain Groth16Verifier (and by ModelRegistry.register()).
 *
 * snarkjs.groth16.exportSolidityCallData() returns a single string of the form:
 *   [pA0,pA1],[[pB00,pB01],[pB10,pB11]],[pC0,pC1],[pub0,pub1,...]
 *
 * The pi_b coordinate swap (required by the EVM pairing precompile) is handled
 * internally by snarkjs, so we do NOT re-swap here.
 *
 * @param proof         Raw proof object from snarkjs.groth16.fullProve().
 * @param publicSignals Raw public signals array from snarkjs.groth16.fullProve().
 */
export async function formatForContract(
  proof: any,
  publicSignals: string[]
): Promise<{
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
  nullifier: string;
  root: string;
}> {
  // exportSolidityCallData returns a promise that resolves to a comma-separated bracket string.
  const rawCalldata: string = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  );

  // The string looks like:
  //   [a0,a1],[[b00,b01],[b10,b11]],[c0,c1],[pub0,pub1]
  // Wrap in [] so the whole thing is a valid JSON array.
  const jsonStr = `[${rawCalldata}]`;
  const parsed: [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    string[]
  ] = JSON.parse(jsonStr);

  const [pA, pB, pC, pubSignals] = parsed;

  // Public signals order from snarkjs: outputs first, then inputs.
  // Circuit has: output nullifier, public input root → [nullifier, root]
  const nullifier = pubSignals[0];
  const root = pubSignals[1];

  return { pA, pB, pC, nullifier, root };
}
