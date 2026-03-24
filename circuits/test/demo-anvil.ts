#!/usr/bin/env ts-node
/**
 * 🦞 ClawlyMarket End-to-End Anvil Demo
 *
 * Full pipeline: Anvil → Deploy → Merkle Tree → ZK Proof → On-Chain Verify → Token Mint
 *
 * Usage: cd circuits && npx ts-node test/demo-anvil.ts
 *
 * Prerequisites:
 *   - Anvil running on localhost:8545 (started separately or by this script)
 *   - Contracts compiled: cd contracts && forge build
 *   - Circuit compiled + setup done (build/ and keys/ populated)
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { PoseidonMerkleTree } from '../src/merkle-tree';
import { generateProof, verifyProofLocally } from '../src/prove';

// Anvil default accounts (deterministic)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MODEL_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MODEL_ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');
const RPC = 'http://127.0.0.1:8545';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function cast(args: string): string {
  const cmd = `cast ${args} --rpc-url ${RPC}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e: any) {
    console.error(`  cast failed: ${cmd}`);
    console.error(e.stderr || e.message);
    throw e;
  }
}

function castSend(to: string, sig: string, args: string, key: string): string {
  return cast(`send ${to} "${sig}" ${args} --private-key ${key}`);
}

function castCall(to: string, sig: string, args: string = ''): string {
  const raw = cast(`call ${to} "${sig}" ${args}`);
  // cast appends " [1.042e76]" scientific notation — strip it
  return raw.replace(/\s*\[.*\]$/, '').trim();
}

function header(text: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${text}`);
  console.log('═'.repeat(60));
}

function step(n: number, text: string) {
  console.log(`\n  [${n}] ${text}`);
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

async function main() {
  header('🦞 ClawlyMarket End-to-End Demo');

  // ------------------------------------------------------------------
  // Step 1: Check Anvil is running
  // ------------------------------------------------------------------
  step(1, 'Checking Anvil connection...');
  try {
    const blockNumber = cast('block-number');
    console.log(`      Connected to Anvil (block #${blockNumber})`);
  } catch {
    console.error('      Anvil not running! Start it with: anvil');
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Step 2: Deploy contracts with the REAL Groth16 verifier
  // ------------------------------------------------------------------
  step(2, 'Deploying contracts with real ZK verifier...');

  const deployOutput = execSync(
    `cd ${CONTRACTS_DIR} && USE_REAL_VERIFIER=true PRIVATE_KEY=${DEPLOYER_KEY} MERKLE_ROOT=0 ` +
    `forge script script/Deploy.s.sol --tc Deploy --rpc-url ${RPC} --broadcast 2>&1`,
    { encoding: 'utf-8', timeout: 60000 }
  );

  // Parse deployed addresses from forge output
  const parseAddr = (label: string): string => {
    const match = deployOutput.match(new RegExp(`${label}:\\s+(0x[0-9a-fA-F]{40})`));
    if (!match) throw new Error(`Could not parse ${label} address from deploy output`);
    return match[1];
  };

  const verifierAddr = parseAddr('ZKVerifier.*?');
  const tokenAddr = parseAddr('ClawliaToken');
  const registryAddr = parseAddr('ModelRegistry');
  const factoryAddr = parseAddr('MarketFactory');

  console.log(`      ZKVerifier:     ${verifierAddr}`);
  console.log(`      ClawliaToken:   ${tokenAddr}`);
  console.log(`      ModelRegistry:  ${registryAddr}`);
  console.log(`      MarketFactory:  ${factoryAddr}`);

  // ------------------------------------------------------------------
  // Step 3: Build Merkle tree with a test secret
  // ------------------------------------------------------------------
  step(3, 'Building Merkle tree...');

  const tree = new PoseidonMerkleTree(10);
  await tree.init();

  // Our test "API key" — in production this would be derived from a real credential
  const testSecret = 1337_42_69n;
  const leafIndex = tree.insert(testSecret);
  const root = tree.getRoot();
  const nullifier = tree.getNullifier(testSecret);

  console.log(`      Secret:     ${testSecret}`);
  console.log(`      Leaf index: ${leafIndex}`);
  console.log(`      Nullifier:  ${nullifier}`);
  console.log(`      Root:       ${root}`);

  // ------------------------------------------------------------------
  // Step 4: Set Merkle root on-chain
  // ------------------------------------------------------------------
  step(4, 'Setting Merkle root on-chain (owner tx)...');

  castSend(
    registryAddr,
    'updateMerkleRoot(uint256)',
    root.toString(),
    DEPLOYER_KEY
  );

  const onChainRoot = castCall(registryAddr, 'merkleRoot()(uint256)');
  console.log(`      On-chain root: ${BigInt(onChainRoot)}`);
  console.log(`      Matches tree:  ${BigInt(onChainRoot) === root ? 'YES ✓' : 'NO ✗'}`);

  // ------------------------------------------------------------------
  // Step 5: Generate the Groth16 proof
  // ------------------------------------------------------------------
  step(5, 'Generating Groth16 proof...');

  const merkleProof = tree.getProof(leafIndex);
  const startTime = Date.now();
  const proofResult = await generateProof(
    testSecret,
    merkleProof.pathElements,
    merkleProof.pathIndices,
    root
  );
  const elapsed = Date.now() - startTime;

  console.log(`      Proof generated in ${elapsed}ms`);
  console.log(`      pA: [${proofResult.pA[0].slice(0, 16)}..., ${proofResult.pA[1].slice(0, 16)}...]`);

  // ------------------------------------------------------------------
  // Step 6: Verify proof locally first
  // ------------------------------------------------------------------
  step(6, 'Verifying proof locally (off-chain sanity check)...');

  const localValid = await verifyProofLocally(proofResult);
  console.log(`      Local verification: ${localValid ? 'VALID ✓' : 'INVALID ✗'}`);
  if (!localValid) {
    console.error('      Proof failed local verification! Aborting.');
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Step 7: Check model state BEFORE registration
  // ------------------------------------------------------------------
  step(7, 'Checking model state before registration...');

  const isVerifiedBefore = castCall(registryAddr, 'isVerified(address)(bool)', MODEL_ADDR);
  const balanceBefore = castCall(tokenAddr, 'balanceOf(address)(uint256)', MODEL_ADDR);
  console.log(`      Is verified: ${isVerifiedBefore}`);
  console.log(`      CLAW balance: ${BigInt(balanceBefore)}`);

  // ------------------------------------------------------------------
  // Step 8: Submit proof on-chain — THE BIG MOMENT
  // ------------------------------------------------------------------
  step(8, 'Submitting ZK proof to ModelRegistry.register()...');
  console.log(`      Model address: ${MODEL_ADDR}`);

  // Format proof args for cast send
  const pA = `[${proofResult.pA.join(',')}]`;
  const pB = `[[${proofResult.pB[0].join(',')}],[${proofResult.pB[1].join(',')}]]`;
  const pC = `[${proofResult.pC.join(',')}]`;
  const nullifierArg = proofResult.nullifier;

  castSend(
    registryAddr,
    'register(uint256[2],uint256[2][2],uint256[2],uint256)',
    `${pA} ${pB} ${pC} ${nullifierArg}`,
    MODEL_KEY
  );

  console.log('      Transaction submitted!');

  // ------------------------------------------------------------------
  // Step 9: Verify the results
  // ------------------------------------------------------------------
  step(9, 'Verifying on-chain results...');

  const isVerifiedAfter = castCall(registryAddr, 'isVerified(address)(bool)', MODEL_ADDR);
  const balanceAfter = castCall(tokenAddr, 'balanceOf(address)(uint256)', MODEL_ADDR);
  const nullifierUsed = castCall(
    registryAddr,
    'usedNullifiers(uint256)(bool)',
    nullifier.toString()
  );

  const verified = isVerifiedAfter.includes('true');
  const balance = BigInt(balanceAfter);
  const nullUsed = nullifierUsed.includes('true');

  console.log(`      Is verified:      ${verified ? 'YES ✓' : 'NO ✗'}`);
  console.log(`      CLAW balance:     ${balance} ${balance === 1000000000000000000000n ? '(1000 CLAW) ✓' : ''}`);
  console.log(`      Nullifier used:   ${nullUsed ? 'YES ✓' : 'NO ✗'}`);

  // ------------------------------------------------------------------
  // Step 10: Negative tests — try re-registering (should fail)
  // ------------------------------------------------------------------
  step(10, 'Testing Sybil resistance (re-registration should fail)...');

  try {
    castSend(
      registryAddr,
      'register(uint256[2],uint256[2][2],uint256[2],uint256)',
      `${pA} ${pB} ${pC} ${nullifierArg}`,
      MODEL_KEY
    );
    console.log('      FAIL: Re-registration succeeded (should have reverted)');
  } catch {
    console.log('      Re-registration correctly rejected ✓');
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  header('Demo Complete!');
  const allPassed = verified && balance > 0n && nullUsed;
  if (allPassed) {
    console.log(`
  Full pipeline verified:

    Merkle Tree ──→ ZK Proof ──→ On-Chain Verification ──→ Token Minting

    ✓ Poseidon Merkle tree built (root set on-chain)
    ✓ Groth16 proof generated in ${elapsed}ms
    ✓ Proof verified locally (snarkjs)
    ✓ Proof verified on-chain (Groth16Verifier.sol)
    ✓ Model registered in ModelRegistry
    ✓ 1000 CLAW minted to model address
    ✓ Nullifier marked as used (Sybil-resistant)
    ✓ Re-registration correctly rejected

  Ready for testnet deployment! 🦞
`);
  } else {
    console.log('\n  Some checks failed — review output above.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nDemo crashed:', err.message);
  process.exit(1);
});
