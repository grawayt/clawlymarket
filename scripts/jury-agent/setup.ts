/**
 * setup.ts
 *
 * One-time setup script for the Haiku jury agent.
 *
 * - Generates 5 fresh wallet private keys
 * - Saves them to .env (gitignored)
 * - Prints addresses for funding
 * - Prints cast commands to fund each wallet and register them as privileged jurors
 *
 * Usage:
 *   ts-node setup.ts [--jury-resolution <address>] [--model-registry <address>]
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

const ENV_PATH = path.join(__dirname, ".env");

function parseArgs(): { juryResolution: string | null; modelRegistry: string | null } {
  const args = process.argv.slice(2);
  let juryResolution: string | null = null;
  let modelRegistry: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--jury-resolution" && args[i + 1]) {
      juryResolution = args[++i];
    } else if (args[i] === "--model-registry" && args[i + 1]) {
      modelRegistry = args[++i];
    }
  }

  return { juryResolution, modelRegistry };
}

async function main() {
  const { juryResolution, modelRegistry } = parseArgs();

  // Guard: don't overwrite an existing .env
  if (fs.existsSync(ENV_PATH)) {
    console.error(
      `\n  .env already exists at ${ENV_PATH}.\n` +
        `  Delete it first if you want to regenerate juror keys.\n`
    );
    process.exit(1);
  }

  console.log("\nClawing through entropy to generate 5 juror wallets...\n");

  const wallets: ethers.HDNodeWallet[] = [];
  for (let i = 0; i < 5; i++) {
    wallets.push(ethers.Wallet.createRandom());
  }

  // Write .env
  const envLines = [
    `# Haiku jury agent environment — DO NOT COMMIT`,
    `ANTHROPIC_API_KEY=sk-ant-...`,
    `RPC_URL=http://127.0.0.1:8545`,
    ...wallets.map((w, i) => `JUROR_KEY_${i + 1}=${w.privateKey}`),
  ];
  fs.writeFileSync(ENV_PATH, envLines.join("\n") + "\n", { mode: 0o600 });
  console.log(`  Saved private keys to ${ENV_PATH} (mode 600)\n`);

  // Print addresses
  console.log("  Juror wallet addresses (fund these with ETH for gas):\n");
  wallets.forEach((w, i) => {
    console.log(`    Juror ${i + 1}: ${w.address}`);
  });

  // Print cast commands
  console.log("\n  ── Cast commands ──────────────────────────────────────\n");
  console.log("  # Fund each juror wallet with ETH for gas (Anvil example):");
  wallets.forEach((w) => {
    console.log(
      `  cast send ${w.address} --value 0.1ether ` +
        `--private-key $DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL`
    );
  });

  if (modelRegistry) {
    console.log(
      "\n  # Register each juror in ModelRegistry (so isVerified() returns true):"
    );
    wallets.forEach((w) => {
      console.log(
        `  cast send ${modelRegistry} "registerModel(address)" ${w.address} ` +
          `--private-key $DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL`
      );
    });
  } else {
    console.log(
      "\n  # Register each juror in ModelRegistry (supply --model-registry <addr> for auto-fill):"
    );
    wallets.forEach((w) => {
      console.log(
        `  cast send <MODEL_REGISTRY> "registerModel(address)" ${w.address} ` +
          `--private-key $DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL`
      );
    });
  }

  if (juryResolution) {
    console.log(
      "\n  # Add each juror as a privileged juror in JuryResolution:"
    );
    wallets.forEach((w) => {
      console.log(
        `  cast send ${juryResolution} "addPrivilegedJuror(address)" ${w.address} ` +
          `--private-key $DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL`
      );
    });
  } else {
    console.log(
      "\n  # Add each juror as a privileged juror (supply --jury-resolution <addr> for auto-fill):"
    );
    wallets.forEach((w) => {
      console.log(
        `  cast send <JURY_RESOLUTION> "addPrivilegedJuror(address)" ${w.address} ` +
          `--private-key $DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL`
      );
    });
  }

  console.log(
    "\n  After funding + registering, fill in ANTHROPIC_API_KEY in .env and you're ready to resolve.\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
