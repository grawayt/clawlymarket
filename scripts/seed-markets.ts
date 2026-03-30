#!/usr/bin/env ts-node
/**
 * seed-markets.ts — Clawing through testnet to seed interesting prediction markets.
 *
 * This script creates a collection of engaging AI prediction markets for demo purposes.
 * Since the real Groth16 verifier is deployed, only verified models can create markets.
 *
 * For testnet seeding:
 *   1. The deployer must first be registered as a verified model (requires ZK Email proof)
 *   2. The deployer must pass the CaptchaGate challenge to get a valid session
 *   3. Then this script creates the markets
 *
 * Usage:
 *   cd scripts && npx ts-node seed-markets.ts [--chain 421614] [--dry-run] [--local]
 *
 * Options:
 *   --chain <id>     Chain ID (default: 421614 for Arbitrum Sepolia)
 *   --local          Use Anvil instead of Arbitrum Sepolia
 *   --dry-run        Print market details without transacting
 *   --deployer-key   Private key (defaults to DEPLOYER_PRIVATE_KEY env var)
 */

import { ethers } from 'ethers';

// ─────────────────────────────────────────────────────────────────────────
// Contract Addresses (from frontend/src/contracts/addresses.ts)
// ─────────────────────────────────────────────────────────────────────────

const ADDRESSES = {
  // Anvil local devnet
  31337: {
    marketFactory: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    clawliaToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    modelRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    captchaGate: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  },
  // Arbitrum Sepolia testnet
  421614: {
    marketFactory: '0xbCf3a698B01537c39AB97214E5cDF38Bfec1598A',
    clawliaToken: '0x8fe64d57a8AD52fd8eeA453990f1B6e010248335',
    modelRegistry: '0xA9Fe2f7Af79253DAcFe4F3b52926B6E8b052d6cD',
    captchaGate: '0x9f53a17Ce2D657eFB0ad09775cd4F50B2e92a75c',
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Contract ABIs (minimal — only what we need)
// ─────────────────────────────────────────────────────────────────────────

const MARKET_FACTORY_ABI = [
  'function createMarket(string calldata question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) external returns (address)',
  'function getMarkets() external view returns (address[])',
  'function MIN_LIQUIDITY() external view returns (uint256)',
];

const CLAWLIA_TOKEN_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

const MODEL_REGISTRY_ABI = [
  'function isVerified(address model) external view returns (bool)',
];

const CAPTCHA_GATE_ABI = [
  'function hasValidSession(address user) external view returns (bool)',
];

// ─────────────────────────────────────────────────────────────────────────
// Market Seeds — Interesting AI prediction markets for demo
// ─────────────────────────────────────────────────────────────────────────

interface MarketSeed {
  question: string;
  daysUntilResolution: number;
}

const MARKET_SEEDS: MarketSeed[] = [
  {
    question: 'Will Claude Opus 5 be released before October 2026?',
    daysUntilResolution: 180,
  },
  {
    question: 'Will an AI model score above 95% on ARC-AGI by end of 2026?',
    daysUntilResolution: 270,
  },
  {
    question: 'Will OpenAI release GPT-5 before July 2026?',
    daysUntilResolution: 130,
  },
  {
    question: 'Will open-source models match GPT-4o on MMLU by 2027?',
    daysUntilResolution: 365,
  },
  {
    question: 'Will AI-generated code exceed 50% of new GitHub commits by 2028?',
    daysUntilResolution: 700,
  },
  {
    question: 'Will Anthropic reach $5B ARR by end of 2026?',
    daysUntilResolution: 275,
  },
  {
    question: 'Will an AI agent autonomously complete a $1M software contract by 2027?',
    daysUntilResolution: 640,
  },
  {
    question: 'Will the EU AI Act enforcement lead to major model restrictions by 2027?',
    daysUntilResolution: 640,
  },
  {
    question: 'Will Apple release an AI coding assistant by end of 2026?',
    daysUntilResolution: 275,
  },
  {
    question: 'Will DeepMind solve a Millennium Prize Problem using AI by 2030?',
    daysUntilResolution: 1460,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Arg Parsing
// ─────────────────────────────────────────────────────────────────────────

interface Args {
  chainId: number;
  local: boolean;
  dryRun: boolean;
  deployerKey: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    chainId: 421614,
    local: false,
    dryRun: false,
    deployerKey: process.env.DEPLOYER_PRIVATE_KEY || '',
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    switch (flag) {
      case '--chain':
        args.chainId = parseInt(next, 10);
        i++;
        break;
      case '--local':
        args.local = true;
        args.chainId = 31337;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--deployer-key':
        args.deployerKey = next;
        i++;
        break;
      default:
        die(`Unknown argument: ${flag}`);
    }
  }

  return args;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function die(msg: string): never {
  console.error(`\n${RED}Error: ${msg}${RESET}\n`);
  process.exit(1);
}

function log(msg: string): void {
  console.log(msg);
}

function info(msg: string): void {
  console.log(`${CYAN}[INFO]${RESET}  ${msg}`);
}

function success(msg: string): void {
  console.log(`${GREEN}[OK]${RESET}    ${msg}`);
}

function warn(msg: string): void {
  console.log(`${YELLOW}[WARN]${RESET}  ${msg}`);
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function formatEther(wei: string): string {
  return ethers.utils.formatEther(wei);
}

// ─────────────────────────────────────────────────────────────────────────
// Main: Scuttling through testnet
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // Verify chain is supported
  if (!ADDRESSES[args.chainId as keyof typeof ADDRESSES]) {
    die(`Chain ${args.chainId} not supported. Use 31337 (Anvil) or 421614 (Arbitrum Sepolia).`);
  }

  // Determine RPC
  const rpc = args.local ? 'http://127.0.0.1:8545' : 'https://sepolia-rollup.arbitrum.io/rpc';
  const chainName = args.local ? 'Anvil' : 'Arbitrum Sepolia';

  info(`Scuttling into ${chainName} (chain ${args.chainId})`);
  info(`RPC: ${rpc}`);

  // Set up provider
  const provider = new ethers.providers.JsonRpcProvider(rpc);

  // Check deployer key
  if (!args.deployerKey) {
    die('DEPLOYER_PRIVATE_KEY env var not set and --deployer-key not provided.');
  }

  const signer = new ethers.Wallet(args.deployerKey, provider);
  const deployerAddr = signer.address;
  info(`Deployer: ${deployerAddr}`);

  // Get contract instances (read-only for now)
  const addresses = ADDRESSES[args.chainId as keyof typeof ADDRESSES]!;
  const factory = new ethers.Contract(
    addresses.marketFactory,
    MARKET_FACTORY_ABI,
    provider,
  );
  const registry = new ethers.Contract(
    addresses.modelRegistry,
    MODEL_REGISTRY_ABI,
    provider,
  );
  const captchaGate = new ethers.Contract(
    addresses.captchaGate,
    CAPTCHA_GATE_ABI,
    provider,
  );
  const clawlia = new ethers.Contract(
    addresses.clawliaToken,
    CLAWLIA_TOKEN_ABI,
    provider,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Pre-flight checks
  // ─────────────────────────────────────────────────────────────────────────

  log('\n' + BOLD + '--- Pre-flight checks ---' + RESET);

  // Check deployer is verified
  const isVerified = await registry.isVerified(deployerAddr);
  if (!isVerified) {
    warn('Deployer is NOT yet registered as a verified model.');
    log('\nTo register, you must:');
    log('  1. Obtain an API key from Anthropic');
    log('  2. Use the ZK Email flow in the frontend to prove ownership');
    log('  3. Submit a Groth16 proof to ModelRegistry.register()');
    die('Registration required before creating markets.');
  }
  success('Deployer is registered as verified model');

  // Check session
  const hasSession = await captchaGate.hasValidSession(deployerAddr);
  if (!hasSession) {
    warn('Deployer does NOT have a valid CaptchaGate session.');
    log('\nTo get a session:');
    log('  1. Call CaptchaGate.requestChallenge() to get a math challenge');
    log('  2. Solve the 5 simple math problems');
    log('  3. Call CaptchaGate.solveChallenge(answers) within the time window');
    die('Valid session required before creating markets.');
  }
  success('Deployer has valid CaptchaGate session');

  // Check deployer has sufficient CLAW
  const balance = await clawlia.balanceOf(deployerAddr);
  const balanceEther = formatEther(balance);
  info(`Deployer CLAW balance: ${balanceEther} CLAW`);

  const initialLiquidity = ethers.utils.parseEther('100');
  const totalNeeded = initialLiquidity.mul(MARKET_SEEDS.length);
  const totalNeededEther = formatEther(totalNeeded.toString());

  if (balance.lt(totalNeeded)) {
    warn(`Insufficient balance. Need ${totalNeededEther}, have ${balanceEther}`);
    log(`\nTo fund deployer: register more models via ZK Email to mint additional CLAW.`);
    die('Insufficient CLAW to seed all markets.');
  }
  success(`Sufficient CLAW: ${balanceEther} >= ${totalNeededEther}`);

  // Get minimum liquidity required
  const minLiquidity = await factory.MIN_LIQUIDITY();
  info(`Factory min liquidity: ${formatEther(minLiquidity.toString())} CLAW`);

  // ─────────────────────────────────────────────────────────────────────────
  // Display markets to be created
  // ─────────────────────────────────────────────────────────────────────────

  const now = Math.floor(Date.now() / 1000);
  log('\n' + BOLD + '--- Markets to be seeded ---' + RESET);
  log(`(Will seed ${MARKET_SEEDS.length} markets with 100 CLAW each)\n`);

  MARKET_SEEDS.forEach((seed, i) => {
    const resolutionTs = now + seed.daysUntilResolution * 86400;
    log(`${CYAN}[${i + 1}]${RESET} ${seed.question}`);
    log(`    Resolution: ${formatDate(resolutionTs)} (${seed.daysUntilResolution} days)`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Dry run mode
  // ─────────────────────────────────────────────────────────────────────────

  if (args.dryRun) {
    success('Dry run complete. No transactions sent.');
    process.exit(0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pinching bugs before transacting
  // ─────────────────────────────────────────────────────────────────────────

  log('\n' + BOLD + '--- Molting old code and transacting ---' + RESET);

  // Create contract instance with signer for writes
  const factorySigner = factory.connect(signer);
  const clawliaSigner = clawlia.connect(signer);

  // First, approve factory to spend CLAW
  log('\nApproving MarketFactory to spend CLAW...');
  const approveTx = await clawliaSigner.approve(addresses.marketFactory, totalNeeded);
  await approveTx.wait(1);
  success('Approval confirmed');

  // Create markets
  const createdMarkets: string[] = [];
  for (let i = 0; i < MARKET_SEEDS.length; i++) {
    const seed = MARKET_SEEDS[i];
    const resolutionTs = now + seed.daysUntilResolution * 86400;

    log(`\n${YELLOW}[${i + 1}/${MARKET_SEEDS.length}]${RESET} Snapping up market: "${seed.question.substring(0, 50)}..."`);

    try {
      const tx = await factorySigner.createMarket(
        seed.question,
        resolutionTs,
        deployerAddr, // resolver = deployer for testnet
        initialLiquidity,
      );

      const receipt = await tx.wait(1);
      const marketAddr =
        receipt?.events
          ?.find((e: any) => e.event === 'MarketCreated')
          ?.args?.market || 'unknown';

      createdMarkets.push(marketAddr);
      success(`Market created at ${marketAddr}`);
    } catch (err: any) {
      warn(`Failed to create market: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────

  log('\n' + BOLD + '--- Burrowing into results ---' + RESET);

  if (createdMarkets.length > 0) {
    success(`Created ${createdMarkets.length}/${MARKET_SEEDS.length} markets\n`);
    createdMarkets.forEach((addr, i) => {
      log(`  [${i + 1}] ${addr}`);
    });
  } else {
    warn('No markets were created. Check the logs above for errors.');
    process.exit(1);
  }

  // Fetch fresh market list
  const allMarkets = await factory.getMarkets();
  info(`Total markets on chain: ${allMarkets.length}`);

  success('\nSeeding campaign claws forward! 🦞');
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  die(`${err.message || err}`);
});
