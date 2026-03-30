/**
 * resolve.ts
 *
 * Main Haiku jury resolution script for ClawlyMarket.
 *
 * Modes:
 *   --scan                       List all markets ready to resolve
 *   --resolve <market-address>   Resolve a specific market via Haiku jury
 *   --auto                       Scan + resolve all ready markets
 *
 * Optional flags:
 *   --rpc <url>                  Override RPC URL (default: env RPC_URL or http://127.0.0.1:8545)
 *   --jury-resolution <address>  JuryResolution contract address
 *   --market-factory <address>   MarketFactory contract address (used for --scan / --auto)
 *
 * Environment variables (loaded from .env in same directory):
 *   ANTHROPIC_API_KEY
 *   RPC_URL
 *   JUROR_KEY_1 … JUROR_KEY_5
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { callHaiku, buildResolutionPrompt, parseOutcome } from "./haiku-client";

// Load .env from the jury-agent directory
dotenv.config({ path: path.join(__dirname, ".env") });

// ── ABI fragments ────────────────────────────────────────────────────────────

const PREDICTION_MARKET_ABI = [
  "function question() external view returns (string)",
  "function resolutionTimestamp() external view returns (uint256)",
  "function resolved() external view returns (bool)",
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function resolver() external view returns (address)",
];

const JURY_RESOLUTION_ABI = [
  "function requestResolution(address market) external",
  "function vote(address market, uint256 _outcome) external",
  "function panelExists(address market) external view returns (bool)",
  "function getPanel(address market) external view returns (address[5], bool[5], uint256[5], uint256, uint256, uint256, bool, uint256)",
  "function privilegedJurors(address) external view returns (bool)",
  "event PanelConvened(address indexed market, address[5] jurors, uint256 votingDeadline)",
  "event MarketResolved(address indexed market, uint256 outcome)",
];

const MARKET_FACTORY_ABI = [
  "event MarketCreated(address indexed market, string question, uint256 resolutionTimestamp)",
];

// ── Types ────────────────────────────────────────────────────────────────────

interface ResolveArgs {
  mode: "scan" | "resolve" | "auto";
  marketAddress: string | null;
  rpcUrl: string;
  juryResolutionAddress: string | null;
  marketFactoryAddress: string | null;
}

interface MarketInfo {
  address: string;
  question: string;
  resolutionTimestamp: bigint;
  resolved: boolean;
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(): ResolveArgs {
  const args = process.argv.slice(2);
  let mode: "scan" | "resolve" | "auto" | null = null;
  let marketAddress: string | null = null;
  let rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  let juryResolutionAddress: string | null = null;
  let marketFactoryAddress: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--scan":
        mode = "scan";
        break;
      case "--auto":
        mode = "auto";
        break;
      case "--resolve":
        mode = "resolve";
        marketAddress = args[++i] ?? null;
        break;
      case "--rpc":
        rpcUrl = args[++i] ?? rpcUrl;
        break;
      case "--jury-resolution":
        juryResolutionAddress = args[++i] ?? null;
        break;
      case "--market-factory":
        marketFactoryAddress = args[++i] ?? null;
        break;
    }
  }

  if (!mode) {
    console.error(
      "\nUsage:\n" +
        "  ts-node resolve.ts --scan [--market-factory <addr>] [--rpc <url>]\n" +
        "  ts-node resolve.ts --resolve <market-address> --jury-resolution <addr> [--rpc <url>]\n" +
        "  ts-node resolve.ts --auto --jury-resolution <addr> [--market-factory <addr>] [--rpc <url>]\n"
    );
    process.exit(1);
  }

  if (mode === "resolve" && !marketAddress) {
    console.error("  --resolve requires a market address");
    process.exit(1);
  }

  return { mode, marketAddress, rpcUrl, juryResolutionAddress, marketFactoryAddress };
}

// ── Environment loading ───────────────────────────────────────────────────────

function loadEnv(): { apiKey: string; jurorKeys: string[] } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-...") {
    console.error(
      "\n  ANTHROPIC_API_KEY is not set. Edit scripts/jury-agent/.env and add your key.\n"
    );
    process.exit(1);
  }

  const jurorKeys: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const key = process.env[`JUROR_KEY_${i}`];
    if (!key || key === "0x...") {
      console.error(
        `\n  JUROR_KEY_${i} is not set. Run ts-node setup.ts first.\n`
      );
      process.exit(1);
    }
    jurorKeys.push(key);
  }

  return { apiKey, jurorKeys };
}

// ── Market scanning ───────────────────────────────────────────────────────────

/**
 * Fetch all markets that are past their resolutionTimestamp and not yet resolved.
 * If a MarketFactory address is given, we query its MarketCreated events.
 * Otherwise, if a single market address is supplied, we just check that one.
 */
async function findReadyMarkets(
  provider: ethers.JsonRpcProvider,
  factoryAddress: string | null,
  singleAddress: string | null = null
): Promise<MarketInfo[]> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ready: MarketInfo[] = [];

  const addresses: string[] = [];

  if (singleAddress) {
    addresses.push(singleAddress);
  } else if (factoryAddress) {
    const factory = new ethers.Contract(factoryAddress, MARKET_FACTORY_ABI, provider);
    const filter = factory.filters.MarketCreated();
    const events = await factory.queryFilter(filter, 0, "latest");
    for (const ev of events) {
      // MarketCreated(address indexed market, string question, uint256 resolutionTimestamp)
      const marketAddr = (ev as ethers.EventLog).args[0] as string;
      addresses.push(marketAddr);
    }
  } else {
    console.warn(
      "  No --market-factory address provided. Cannot scan for markets.\n" +
        "  Supply --market-factory <addr> or use --resolve <market-address> directly."
    );
    return [];
  }

  for (const addr of addresses) {
    const market = new ethers.Contract(addr, PREDICTION_MARKET_ABI, provider);
    const [question, resolutionTimestamp, resolved] = await Promise.all([
      market.question() as Promise<string>,
      market.resolutionTimestamp() as Promise<bigint>,
      market.resolved() as Promise<boolean>,
    ]);

    if (!resolved && resolutionTimestamp <= now) {
      ready.push({ address: addr, question, resolutionTimestamp, resolved });
    }
  }

  return ready;
}

// ── Juror eligibility ─────────────────────────────────────────────────────────

/**
 * From the 5 juror wallets, select those that do not hold any position tokens
 * in the given market. Returns up to 5 eligible addresses.
 */
async function selectEligibleJurors(
  provider: ethers.JsonRpcProvider,
  marketAddress: string,
  jurorAddresses: string[]
): Promise<string[]> {
  const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, provider);
  const eligible: string[] = [];

  for (const addr of jurorAddresses) {
    const [yesBalance, noBalance] = await Promise.all([
      market.balanceOf(addr, 0n) as Promise<bigint>,
      market.balanceOf(addr, 1n) as Promise<bigint>,
    ]);
    if (yesBalance === 0n && noBalance === 0n) {
      eligible.push(addr);
    } else {
      console.log(`  [skip] ${addr} holds positions in ${marketAddress}`);
    }
  }

  return eligible;
}

// ── Resolution flow ───────────────────────────────────────────────────────────

async function resolveMarket(
  provider: ethers.JsonRpcProvider,
  jurorWallets: ethers.Wallet[],
  juryResolutionAddress: string,
  market: MarketInfo,
  apiKey: string
): Promise<void> {
  console.log(`\n  Cracking open market: ${market.address}`);
  console.log(`  Question: "${market.question}"`);

  // 1. Ask Haiku
  console.log("\n  Pinching Haiku for a verdict...");
  const prompt = buildResolutionPrompt(market.question);
  const haikuResponse = await callHaiku(apiKey, prompt);
  console.log(`  Haiku says: "${haikuResponse}"`);

  let parsed: { outcome: number; explanation: string };
  try {
    parsed = parseOutcome(haikuResponse);
  } catch (err) {
    console.error(`  Could not parse Haiku response: ${(err as Error).message}`);
    console.error("  Skipping this market.");
    return;
  }

  const outcomeLabel = parsed.outcome === 0 ? "YES (0)" : "NO (1)";
  console.log(`  Verdict: ${outcomeLabel} — ${parsed.explanation}`);

  // 2. Select eligible jurors
  const jurorAddresses = jurorWallets.map((w) => w.address);
  const eligibleAddresses = await selectEligibleJurors(provider, market.address, jurorAddresses);

  if (eligibleAddresses.length < 5) {
    console.error(
      `  Only ${eligibleAddresses.length}/5 jurors are eligible for this market (need 5). Skipping.`
    );
    return;
  }

  const eligibleWallets = jurorWallets.filter((w) => eligibleAddresses.includes(w.address));

  // 3. Connect the first juror wallet to call requestResolution
  const caller = eligibleWallets[0].connect(provider);
  const juryContract = new ethers.Contract(juryResolutionAddress, JURY_RESOLUTION_ABI, caller);

  // 3a. Check if panel already exists
  const panelAlreadyExists = await juryContract.panelExists(market.address) as boolean;
  if (!panelAlreadyExists) {
    console.log(`\n  Scuttling requestResolution on-chain...`);
    // Contract selects jurors internally — no panel argument needed
    const tx = await juryContract.requestResolution(market.address);
    const receipt = await tx.wait();
    console.log(`  Panel convened. tx: ${receipt.hash}`);
  } else {
    console.log("  Panel already exists for this market — skipping requestResolution.");
    // Check if panel is already resolved
    const panelData = await juryContract.getPanel(market.address);
    // panelData[6] is the resolved bool
    if (panelData[6] as boolean) {
      console.log("  Market already resolved via jury. Nothing to do.");
      return;
    }
  }

  // 4. Each juror casts their vote
  console.log(`\n  Dispatching ${eligibleWallets.length} juror votes...`);
  let voteCount = 0;

  for (const jurorWallet of eligibleWallets) {
    const jurorWithSigner = jurorWallet.connect(provider);
    const jurorJuryContract = new ethers.Contract(
      juryResolutionAddress,
      JURY_RESOLUTION_ABI,
      jurorWithSigner
    );

    try {
      const tx = await jurorJuryContract.vote(market.address, parsed.outcome);
      const receipt = await tx.wait();
      voteCount++;
      console.log(
        `  Juror ${jurorWallet.address.slice(0, 10)}… voted ${outcomeLabel}. tx: ${receipt.hash}`
      );

      // Auto-resolves at 3 votes — check if market is now resolved
      if (voteCount >= 3) {
        const pmContract = new ethers.Contract(
          market.address,
          PREDICTION_MARKET_ABI,
          provider
        );
        const nowResolved = await pmContract.resolved() as boolean;
        if (nowResolved) {
          console.log(
            `\n  Market auto-resolved after ${voteCount} votes! Outcome: ${outcomeLabel}`
          );
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // AlreadyVoted is fine — panel may have been partially voted before
      if (msg.includes("AlreadyVoted")) {
        console.log(`  Juror ${jurorWallet.address.slice(0, 10)}… already voted. Skipping.`);
      } else if (msg.includes("VotingWindowClosed")) {
        console.error("  Voting window has closed. Resolution failed.");
        return;
      } else {
        console.error(`  Vote failed for ${jurorWallet.address}: ${msg}`);
      }
    }
  }

  // 5. Final status
  const pmContract = new ethers.Contract(market.address, PREDICTION_MARKET_ABI, provider);
  const finalResolved = await pmContract.resolved() as boolean;

  if (finalResolved) {
    console.log(`\n  Market ${market.address} is now resolved. Outcome: ${outcomeLabel}`);
  } else {
    console.log(
      `\n  Market not yet resolved after ${voteCount} votes. ` +
        `Remaining jurors may need to vote within the voting window.`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const { apiKey, jurorKeys } = loadEnv();

  const provider = new ethers.JsonRpcProvider(args.rpcUrl);

  // Verify RPC connection
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`\n  Connected to RPC at ${args.rpcUrl} (block ${blockNumber})`);
  } catch {
    console.error(`\n  Cannot connect to RPC at ${args.rpcUrl}. Is the node running?`);
    process.exit(1);
  }

  // Build wallet objects (not yet connected to provider)
  const jurorWallets = jurorKeys.map((key) => new ethers.Wallet(key));

  // ── --scan ──────────────────────────────────────────────────────────
  if (args.mode === "scan") {
    console.log("\n  Sidling into market registry to scan for ready markets...\n");
    const markets = await findReadyMarkets(provider, args.marketFactoryAddress, null);

    if (markets.length === 0) {
      console.log("  No markets ready to resolve.");
    } else {
      console.log(`  ${markets.length} market(s) ready to resolve:\n`);
      markets.forEach((m, i) => {
        const ts = new Date(Number(m.resolutionTimestamp) * 1000).toISOString();
        console.log(`  [${i + 1}] ${m.address}`);
        console.log(`       Question: "${m.question}"`);
        console.log(`       Resolution timestamp: ${ts}`);
      });
      console.log(
        "\n  Run with --resolve <address> --jury-resolution <addr> to resolve a market."
      );
    }
    return;
  }

  // ── --resolve ───────────────────────────────────────────────────────
  if (args.mode === "resolve") {
    if (!args.juryResolutionAddress) {
      console.error("  --jury-resolution <address> is required for --resolve");
      process.exit(1);
    }

    const markets = await findReadyMarkets(provider, null, args.marketAddress!);
    if (markets.length === 0) {
      // Market might be resolved already or not yet past timestamp
      const market = new ethers.Contract(args.marketAddress!, PREDICTION_MARKET_ABI, provider);
      const [resolved, resolutionTimestamp] = await Promise.all([
        market.resolved() as Promise<boolean>,
        market.resolutionTimestamp() as Promise<bigint>,
      ]);
      const now = BigInt(Math.floor(Date.now() / 1000));

      if (resolved) {
        console.log(`\n  Market ${args.marketAddress} is already resolved.`);
      } else if (resolutionTimestamp > now) {
        const ts = new Date(Number(resolutionTimestamp) * 1000).toISOString();
        console.log(
          `\n  Market is not yet past its resolution timestamp (${ts}). Too early to resolve.`
        );
      }
      return;
    }

    await resolveMarket(
      provider,
      jurorWallets,
      args.juryResolutionAddress,
      markets[0],
      apiKey
    );
    return;
  }

  // ── --auto ──────────────────────────────────────────────────────────
  if (args.mode === "auto") {
    if (!args.juryResolutionAddress) {
      console.error("  --jury-resolution <address> is required for --auto");
      process.exit(1);
    }

    console.log("\n  Burrowing into logs to find all ready markets...");
    const markets = await findReadyMarkets(provider, args.marketFactoryAddress, null);

    if (markets.length === 0) {
      console.log("  No markets ready to resolve. All quiet in the tidal pool.");
      return;
    }

    console.log(`\n  Found ${markets.length} market(s) to resolve.\n`);

    for (const market of markets) {
      try {
        await resolveMarket(
          provider,
          jurorWallets,
          args.juryResolutionAddress,
          market,
          apiKey
        );
      } catch (err) {
        console.error(
          `  Error resolving market ${market.address}: ${(err as Error).message}`
        );
      }
      console.log("  ────────────────────────────────────────────────────────");
    }

    console.log("\n  Auto-resolution sweep complete.");
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
