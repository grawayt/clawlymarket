#!/usr/bin/env ts-node
/**
 * resolve-market.ts — CLI tool for resolving ClawlyMarket prediction markets.
 *
 * Usage:
 *   cd circuits && npx ts-node scripts/resolve-market.ts --list
 *   cd circuits && npx ts-node scripts/resolve-market.ts \
 *     --market 0xABCD... --outcome yes [--rpc http://...] [--key 0x...]
 *
 * Defaults:
 *   --rpc  http://127.0.0.1:8545
 *   --key  Anvil deployer key (account 0)
 */

import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// ABIs (minimal — only what we need)
// ---------------------------------------------------------------------------

const MARKET_ABI = [
  'function question() view returns (string)',
  'function resolutionTimestamp() view returns (uint256)',
  'function resolver() view returns (address)',
  'function resolved() view returns (bool)',
  'function outcome() view returns (uint256)',
  'function totalCollateral() view returns (uint256)',
  'function resolve(uint256 _outcome)',
];

const FACTORY_ABI = [
  'function getMarkets() view returns (address[])',
];

// ---------------------------------------------------------------------------
// Addresses — Anvil defaults (match frontend/src/contracts/addresses.ts)
// ---------------------------------------------------------------------------

const ANVIL_FACTORY = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';

const ANVIL_DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface Args {
  list: boolean;
  market: string | null;
  outcome: 'yes' | 'no' | null;
  rpc: string;
  key: string;
  factory: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    list: false,
    market: null,
    outcome: null,
    rpc: 'http://127.0.0.1:8545',
    key: ANVIL_DEPLOYER_KEY,
    factory: ANVIL_FACTORY,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    switch (flag) {
      case '--list':
        args.list = true;
        break;
      case '--market':
        args.market = next;
        i++;
        break;
      case '--outcome':
        if (next !== 'yes' && next !== 'no') {
          die(`--outcome must be "yes" or "no", got: ${next}`);
        }
        args.outcome = next as 'yes' | 'no';
        i++;
        break;
      case '--rpc':
        args.rpc = next;
        i++;
        break;
      case '--key':
        args.key = next;
        i++;
        break;
      case '--factory':
        args.factory = next;
        i++;
        break;
      default:
        die(`Unknown argument: ${flag}`);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  console.error(`\nError: ${msg}\n`);
  printUsage();
  process.exit(1);
}

function printUsage(): void {
  console.log(`
Usage:

  List all markets:
    npx ts-node scripts/resolve-market.ts --list [--rpc <url>] [--factory <addr>]

  Resolve a market:
    npx ts-node scripts/resolve-market.ts \\
      --market <address> \\
      --outcome <yes|no> \\
      [--rpc <url>] \\
      [--key <private-key>]

Options:
  --list              List all markets with their status
  --market <addr>     Market contract address to resolve
  --outcome <yes|no>  Resolution outcome (0=YES, 1=NO)
  --rpc <url>         RPC endpoint (default: http://127.0.0.1:8545)
  --key <key>         Resolver private key (default: Anvil account 0)
  --factory <addr>    MarketFactory address (default: Anvil deploy address)
`);
}

function formatDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}

function formatCollateral(wei: bigint): string {
  return parseFloat(ethers.utils.formatEther(wei)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  }) + ' CLAW';
}

function statusLabel(
  resolved: boolean,
  resolutionTs: bigint,
  nowSec: number,
): string {
  if (resolved) return 'RESOLVED';
  if (Number(resolutionTs) <= nowSec) return 'READY-TO-RESOLVE';
  return 'OPEN';
}

function statusColor(status: string): string {
  if (status === 'RESOLVED') return '\x1b[90m'; // gray
  if (status === 'READY-TO-RESOLVE') return '\x1b[33m'; // yellow
  return '\x1b[32m'; // green
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

// ---------------------------------------------------------------------------
// --list mode
// ---------------------------------------------------------------------------

interface MarketInfo {
  address: string;
  question: string;
  resolutionTimestamp: bigint;
  resolver: string;
  resolved: boolean;
  outcome: bigint;
  totalCollateral: bigint;
}

async function fetchMarketInfo(
  address: string,
  provider: ethers.providers.JsonRpcProvider,
): Promise<MarketInfo> {
  const market = new ethers.Contract(address, MARKET_ABI, provider);
  const [question, resolutionTimestamp, resolver, resolved, outcome, totalCollateral] =
    await Promise.all([
      market.question(),
      market.resolutionTimestamp(),
      market.resolver(),
      market.resolved(),
      market.outcome(),
      market.totalCollateral(),
    ]);
  return { address, question, resolutionTimestamp, resolver, resolved, outcome, totalCollateral };
}

async function listMarkets(args: Args): Promise<void> {
  console.log('\nScuttling through MarketFactory — fetching all markets...\n');

  const provider = new ethers.providers.JsonRpcProvider(args.rpc);

  let chainId: number;
  try {
    const network = await provider.getNetwork();
    chainId = network.chainId;
  } catch {
    die(`Cannot connect to RPC at ${args.rpc}. Is the node running?`);
  }

  const factory = new ethers.Contract(args.factory, FACTORY_ABI, provider);

  let addresses: string[];
  try {
    addresses = await factory.getMarkets();
  } catch {
    die(
      `Could not call getMarkets() on factory at ${args.factory}.\n` +
      `Make sure --factory points to the correct MarketFactory address for chain ${chainId}.`,
    );
  }

  if (addresses.length === 0) {
    console.log('No markets deployed yet.\n');
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  console.log(`Chain ID : ${chainId}`);
  console.log(`Factory  : ${args.factory}`);
  console.log(`Markets  : ${addresses.length}\n`);
  console.log('─'.repeat(80));

  let readyCount = 0;

  for (let i = 0; i < addresses.length; i++) {
    let info: MarketInfo;
    try {
      info = await fetchMarketInfo(addresses[i], provider);
    } catch (err: any) {
      console.log(`[${i + 1}] ${addresses[i]}`);
      console.log(`    ERROR: could not fetch market info — ${err?.message ?? err}\n`);
      continue;
    }

    const status = statusLabel(info.resolved, info.resolutionTimestamp, nowSec);
    const color = statusColor(status);

    if (status === 'READY-TO-RESOLVE') readyCount++;

    console.log(`${BOLD}[${i + 1}] ${info.address}${RESET}`);
    console.log(`    Question   : ${info.question}`);
    console.log(`    Resolution : ${formatDate(info.resolutionTimestamp)}`);
    console.log(`    Collateral : ${formatCollateral(info.totalCollateral)}`);
    console.log(`    Resolver   : ${info.resolver}`);
    console.log(
      `    Status     : ${color}${BOLD}${status}${RESET}` +
      (info.resolved ? `  (outcome: ${info.outcome === 0n ? 'YES' : 'NO'})` : ''),
    );
    console.log('');
  }

  console.log('─'.repeat(80));

  if (readyCount > 0) {
    console.log(
      `\n${YELLOW}${BOLD}${readyCount} market${readyCount > 1 ? 's' : ''} ready to resolve.${RESET}`,
    );
    console.log(
      `Run with --market <address> --outcome <yes|no> to resolve.\n`,
    );
  } else {
    console.log('\nNo markets pending resolution.\n');
  }
}

// ---------------------------------------------------------------------------
// --market resolve mode
// ---------------------------------------------------------------------------

async function resolveMarket(args: Args): Promise<void> {
  if (!args.market) die('--market <address> is required');
  if (!args.outcome) die('--outcome <yes|no> is required');

  const outcomeIndex = args.outcome === 'yes' ? 0 : 1;
  const outcomeLabel = args.outcome.toUpperCase();

  console.log('\nBurrowing into the market contract — running pre-flight checks...\n');

  const provider = new ethers.providers.JsonRpcProvider(args.rpc);

  let chainId: number;
  try {
    const network = await provider.getNetwork();
    chainId = network.chainId;
  } catch {
    die(`Cannot connect to RPC at ${args.rpc}. Is the node running?`);
  }

  const wallet = new ethers.Wallet(args.key, provider);
  const callerAddress = wallet.address;

  // Validate market address format
  if (!ethers.utils.isAddress(args.market)) {
    die(`Invalid market address: ${args.market}`);
  }

  const market = new ethers.Contract(args.market, MARKET_ABI, wallet);

  // Fetch market state
  let question: string;
  let resolutionTimestamp: bigint;
  let resolver: string;
  let resolved: boolean;
  let totalCollateral: bigint;

  try {
    [question, resolutionTimestamp, resolver, resolved, totalCollateral] = await Promise.all([
      market.question(),
      market.resolutionTimestamp(),
      market.resolver(),
      market.resolved(),
      market.totalCollateral(),
    ]);
  } catch (err: any) {
    die(
      `Could not read market at ${args.market}.\n` +
      `Is this a valid PredictionMarket contract on chain ${chainId}?\n` +
      `Error: ${err?.message ?? err}`,
    );
  }

  console.log(`Chain ID   : ${chainId}`);
  console.log(`Market     : ${args.market}`);
  console.log(`Question   : ${question}`);
  console.log(`Resolution : ${formatDate(resolutionTimestamp)}`);
  console.log(`Collateral : ${formatCollateral(totalCollateral)}`);
  console.log(`Resolver   : ${resolver}`);
  console.log(`Caller     : ${callerAddress}`);
  console.log('');

  // Pre-flight checks
  let checksFailed = false;

  if (resolved) {
    console.error(`${RED}FAIL${RESET} Market is already resolved.`);
    checksFailed = true;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(resolutionTimestamp) > nowSec) {
    const secsRemaining = Number(resolutionTimestamp) - nowSec;
    const hoursRemaining = (secsRemaining / 3600).toFixed(1);
    console.error(
      `${RED}FAIL${RESET} Resolution time has not passed yet. ` +
      `${hoursRemaining}h remaining (resolves at ${formatDate(resolutionTimestamp)}).`,
    );
    checksFailed = true;
  }

  if (resolver.toLowerCase() !== callerAddress.toLowerCase()) {
    console.error(
      `${RED}FAIL${RESET} Caller is not the resolver.\n` +
      `  Resolver : ${resolver}\n` +
      `  Caller   : ${callerAddress}`,
    );
    checksFailed = true;
  }

  if (checksFailed) {
    console.error('\nPre-flight checks failed. Aborting.\n');
    process.exit(1);
  }

  console.log(`${GREEN}All checks passed.${RESET}\n`);

  // Confirmation prompt
  console.log(`${BOLD}About to resolve market as: ${outcomeLabel}${RESET}`);
  console.log(`  "${question}"`);
  console.log(`  Outcome: ${outcomeLabel} (index ${outcomeIndex})\n`);

  // In non-interactive mode just proceed; if stdin is a TTY, ask
  if (process.stdin.isTTY) {
    const answer = await prompt(`Confirm? [y/N] `);
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('\nAborted.\n');
      process.exit(0);
    }
  }

  console.log('\nSnapping up the transaction — submitting resolve()...\n');

  let tx: ethers.ContractTransaction;
  try {
    tx = await market.resolve(outcomeIndex);
  } catch (err: any) {
    const msg = err?.reason ?? err?.message ?? String(err);
    console.error(`${RED}Transaction failed:${RESET} ${msg}\n`);
    process.exit(1);
  }

  console.log(`Transaction submitted: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  let receipt: ethers.ContractReceipt;
  try {
    receipt = await tx.wait();
  } catch (err: any) {
    const msg = err?.reason ?? err?.message ?? String(err);
    console.error(`${RED}Transaction reverted:${RESET} ${msg}\n`);
    process.exit(1);
  }

  console.log('');
  console.log(`${GREEN}${BOLD}Market resolved successfully!${RESET}`);
  console.log(`  Outcome    : ${GREEN}${BOLD}${outcomeLabel}${RESET}`);
  console.log(`  Tx hash    : ${receipt.transactionHash}`);
  console.log(`  Block      : ${receipt.blockNumber}`);
  console.log(`  Gas used   : ${receipt.gasUsed.toString()}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Tiny readline prompt helper
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let answer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => {
      answer = String(chunk);
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.list) {
    await listMarkets(args);
  } else if (args.market) {
    await resolveMarket(args);
  } else {
    printUsage();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
