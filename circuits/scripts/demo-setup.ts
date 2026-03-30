#!/usr/bin/env ts-node
/**
 * demo-setup.ts — One-shot demo environment setup for ClawlyMarket.
 *
 * 1. Checks Anvil is running on localhost:8545
 * 2. Deploys contracts with the real ZK verifier via forge
 * 3. Parses deployed addresses from forge output
 * 4. Builds a PoseidonMerkleTree, inserts test secret 1337n
 * 5. Sets the Merkle root on-chain via cast
 * 6. Exports tree state to frontend/public/zk/demo-tree.json
 * 7. Updates frontend/src/contracts/addresses.ts with new Anvil addresses
 * 8. Prints a summary with next steps
 *
 * Run from the circuits/ directory:
 *   cd circuits && npx ts-node scripts/demo-setup.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');
const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const RPC = 'http://127.0.0.1:8545';

// ---------------------------------------------------------------------------
// Step 1 — Check Anvil is running
// ---------------------------------------------------------------------------

function checkAnvil(): void {
  console.log('Scuttling through network — checking Anvil on localhost:8545...');
  try {
    execSync(
      `curl -sf -X POST ${RPC} -H 'Content-Type: application/json' ` +
        `-d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'`,
      { stdio: 'pipe' },
    );
  } catch {
    console.error('\nAnvil does not appear to be running on localhost:8545.');
    console.error('\nStart it with:');
    console.error('  anvil');
    console.error('\nThen re-run this script.');
    process.exit(1);
  }
  console.log('Anvil is up.\n');
}

// ---------------------------------------------------------------------------
// Deployed address types and parsing
// ---------------------------------------------------------------------------

interface DeployedAddresses {
  zkVerifier: string;
  clawliaToken: string;
  modelRegistry: string;
  captchaGate: string;
  marketFactory: string;
}

// ---------------------------------------------------------------------------
// Parse deployed addresses from forge output
// ---------------------------------------------------------------------------

function parseAddress(label: string, output: string): string {
  // forge console.log lines look like:
  //   ZKVerifier (Groth16): 0xABCD...
  //   ClawliaToken: 0xABCD...
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}:\\s*(0x[0-9a-fA-F]{40})`, 'i');
  const match = output.match(re);
  if (!match) {
    throw new Error(`Could not find address for label "${label}" in forge output.\n\nOutput was:\n${output}`);
  }
  return match[1];
}

function parseForgeOutput(output: string): DeployedAddresses {
  console.log('Cracking open forge output to extract addresses...\n');
  const addrs: DeployedAddresses = {
    zkVerifier: parseAddress('ZKVerifier (Groth16)', output),
    clawliaToken: parseAddress('ClawliaToken', output),
    modelRegistry: parseAddress('ModelRegistry', output),
    captchaGate: parseAddress('CaptchaGate', output),
    marketFactory: parseAddress('MarketFactory', output),
  };
  return addrs;
}

// ---------------------------------------------------------------------------
// Steps 4–5 — Note about registration (ZK Email proof based, no on-chain Merkle root)
// ---------------------------------------------------------------------------

// Model registration now uses ZK Email proofs (Groth16). There is no on-chain
// Merkle root to set. Models register by calling ModelRegistry.register() with
// a valid ZK Email proof. The deployer pre-approves the Anthropic DKIM pubkey
// hash in Deploy.s.sol so proofs can be verified immediately.

function logRegistrationNote(): void {
  console.log('Sidling past Merkle tree — registration uses ZK Email proofs.\n');
  console.log('  Models register via ModelRegistry.register() with a Groth16 proof.');
  console.log('  Anthropic DKIM pubkey hash is pre-approved on deploy.\n');
}

// ---------------------------------------------------------------------------
// Step 7 — Update frontend/src/contracts/addresses.ts
// ---------------------------------------------------------------------------

function updateAddressesFile(addrs: DeployedAddresses): void {
  console.log('Sidling into config — updating frontend/src/contracts/addresses.ts...\n');

  const addressesPath = path.join(FRONTEND_DIR, 'src', 'contracts', 'addresses.ts');

  // Read existing file to preserve non-Anvil chain entries
  const existing = fs.readFileSync(addressesPath, 'utf8');

  // Replace the entire 31337 block with fresh addresses
  // Match the block:  31337: {\n    ...\n  },
  const blockRe = /(\/\/ Anvil \(local devnet\)\s*\n\s*31337:\s*\{)[^}]*(},?)/;
  const replacement =
    `$1\n` +
    `    zkVerifier: '${addrs.zkVerifier}',\n` +
    `    clawliaToken: '${addrs.clawliaToken}',\n` +
    `    modelRegistry: '${addrs.modelRegistry}',\n` +
    `    captchaGate: '${addrs.captchaGate}',\n` +
    `    marketFactory: '${addrs.marketFactory}',\n` +
    `  $2`;

  const updated = existing.replace(blockRe, replacement);

  if (updated === existing) {
    // Fallback: if regex didn't match, warn but don't crash
    console.warn(
      '  WARNING: Could not auto-update addresses.ts block — please update the 31337 entry manually.\n',
    );
    console.warn('  New addresses:');
    console.warn(`    zkVerifier:    ${addrs.zkVerifier}`);
    console.warn(`    clawliaToken:  ${addrs.clawliaToken}`);
    console.warn(`    modelRegistry: ${addrs.modelRegistry}`);
    console.warn(`    captchaGate:   ${addrs.captchaGate}`);
    console.warn(`    marketFactory: ${addrs.marketFactory}\n`);
    return;
  }

  fs.writeFileSync(addressesPath, updated, 'utf8');
  console.log(`  Addresses written to ${addressesPath}\n`);
}

// ---------------------------------------------------------------------------
// Step 8 — Print summary
// ---------------------------------------------------------------------------

function printSummary(addrs: DeployedAddresses): void {
  console.log('══════════════════════════════════════════════');
  console.log('  Demo Ready!');
  console.log('══════════════════════════════════════════════');
  console.log('');
  console.log('Contracts deployed to Anvil:');
  console.log(`  ZKVerifier:    ${addrs.zkVerifier}`);
  console.log(`  ClawliaToken:  ${addrs.clawliaToken}`);
  console.log(`  ModelRegistry: ${addrs.modelRegistry}`);
  console.log(`  CaptchaGate:   ${addrs.captchaGate}`);
  console.log(`  MarketFactory: ${addrs.marketFactory}`);
  console.log('');
  console.log('Addresses written to frontend/src/contracts/addresses.ts');
  console.log('');
  console.log('To run the frontend:');
  console.log('  cd frontend && npm run dev');
  console.log('');
  console.log('In the UI:');
  console.log('  1. Connect wallet (use Anvil account in MetaMask)');
  console.log('  2. Browse markets, verify a model, or check portfolio');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  checkAnvil();

  let forgeOutput: DeployedAddresses;
  // We need the raw string output for address parsing, so we re-run with a
  // wrapper that captures it properly including stderr (forge logs go there).
  console.log('Clawing through forge — running deployment script...\n');

  const forgeCmd =
    `USE_REAL_VERIFIER=true ` +
    `PRIVATE_KEY=${DEPLOYER_KEY} ` +
    `MERKLE_ROOT=0 ` +
    `forge script script/Deploy.s.sol --tc Deploy ` +
    `--rpc-url ${RPC} ` +
    `--broadcast`;

  let rawOutput = '';
  try {
    // spawnSync alternative: use execSync with stderr merged via shell redirect
    rawOutput = execSync(`${forgeCmd} 2>&1`, {
      cwd: CONTRACTS_DIR,
      encoding: 'utf8',
      // large buffer for verbose forge output
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: any) {
    const combined = (err.stdout ?? '') + '\n' + (err.stderr ?? '') + '\n' + (err.message ?? '');
    console.error('forge script failed:\n', combined);
    process.exit(1);
  }

  forgeOutput = parseForgeOutput(rawOutput);

  logRegistrationNote();

  updateAddressesFile(forgeOutput);

  printSummary(forgeOutput);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
