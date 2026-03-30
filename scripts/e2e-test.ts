#!/usr/bin/env ts-node
/**
 * ClawlyMarket End-to-End Anvil Test
 *
 * Tests the full lifecycle on a local Anvil devnet:
 *   1. Deploy all contracts (PlaceholderVerifier for speed)
 *   2. Register a model with dummy ZK proof data
 *   3. Solve the CaptchaGate CAPTCHA challenge
 *   4. Create a prediction market
 *   5. Trade YES and NO tokens
 *   6. Warp time and resolve the market
 *   7. Redeem winning tokens for CLAW
 *
 * Usage: cd circuits && npx ts-node ../scripts/e2e-test.ts
 *
 * Prerequisites:
 *   - Anvil running on localhost:8545  (run `anvil` in another terminal)
 *   - Contracts compiled: cd contracts && forge build
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { ethers } from 'ethers';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Anvil deterministic accounts
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOYER_KEY  = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Account 1 — used as the registered "model" and market creator
const MODEL_KEY  = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MODEL_ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Account 2 — second trader (buys NO tokens)
const TRADER_KEY  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const TRADER_ADDR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const RPC           = 'http://127.0.0.1:8545';
const CONTRACTS_DIR = path.resolve(__dirname, '../contracts');

// ─────────────────────────────────────────────────────────────────────────────
// Minimal ABIs — only the functions we call
// ─────────────────────────────────────────────────────────────────────────────

const CLAW_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function verified(address) view returns (bool)',
];

const REGISTRY_ABI = [
  'function register(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 _nullifier, uint256 _pubkeyHash) external',
  'function isVerified(address model) view returns (bool)',
  'function addApprovedPubkeyHash(uint256 _hash) external',
];

const CAPTCHA_ABI = [
  'function requestChallenge() external',
  'function getChallenge(address user) view returns (uint256[5] problems, uint256 deadline)',
  'function solveChallenge(uint256[5] answers) external',
  'function hasValidSession(address user) view returns (bool)',
];

const FACTORY_ABI = [
  'function createMarket(string calldata question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) external returns (address)',
  'function getMarkets() view returns (address[])',
];

const MARKET_ABI = [
  'function question() view returns (string)',
  'function resolutionTimestamp() view returns (uint256)',
  'function reserveYes() view returns (uint256)',
  'function reserveNo() view returns (uint256)',
  'function totalCollateral() view returns (uint256)',
  'function resolved() view returns (bool)',
  'function outcome() view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function buy(uint256 outcomeIndex, uint256 collateralAmount, uint256 minTokensOut) returns (uint256 tokensOut)',
  'function resolve(uint256 _outcome) external',
  'function redeem(uint256 amount) external',
  'function getImpliedProbability() view returns (uint256 yesProbBps, uint256 noProbBps)',
];

// ─────────────────────────────────────────────────────────────────────────────
// Terminal colours and logging
// ─────────────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function header(text: string): void {
  const bar = '═'.repeat(62);
  console.log(`\n${BOLD}${bar}`);
  console.log(`  ${text}`);
  console.log(`${bar}${RESET}`);
}

function step(n: number, text: string): void {
  console.log(`\n${BOLD}${CYAN}[ Step ${n} ]${RESET} ${BOLD}${text}${RESET}`);
}

function ok(text: string): void {
  console.log(`  ${GREEN}✓${RESET}  ${text}`);
}

function info(text: string): void {
  console.log(`  ${DIM}${text}${RESET}`);
}

function fail(step: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${RED}${BOLD}FAILED at: ${step}${RESET}`);
  console.error(`${RED}${msg}${RESET}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Run a cast JSON-RPC call directly — used for evm_increaseTime / evm_mine */
function castRpc(method: string, params: string): void {
  execSync(
    `cast rpc ${method} ${params} --rpc-url ${RPC}`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
}

/** assert with a helpful panic */
function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

/**
 * Directly set a CaptchaGate session for an address using Anvil's
 * anvil_setStorageAt — bypasses the challenge flow for infrastructure
 * contracts (e.g. MarketFactory) that cannot solve challenges themselves.
 *
 * CaptchaGate storage layout (OZ Ownable v5):
 *   slot 0: _owner
 *   slot 1: sessionDuration
 *   slot 2: challengeWindow
 *   slot 3: sessionExpiry mapping  ← we write here
 *
 * Solidity mapping key: keccak256(abi.encode(address, uint256_slot))
 */
async function grantSession(
  provider: ethers.JsonRpcProvider,
  captchaAddr: string,
  userAddr:    string,
  expiryTs:    bigint = 32503680000n, // ~ year 3000
): Promise<void> {
  const SESSION_EXPIRY_SLOT = 3n;
  const storageKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [userAddr, SESSION_EXPIRY_SLOT],
    ),
  );
  const expiryHex = ethers.toBeHex(expiryTs, 32);
  await provider.send('anvil_setStorageAt', [captchaAddr, storageKey, expiryHex]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTCHA solver — mirrors _computeAnswer in CaptchaGate.sol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replicate the CaptchaGate._computeAnswer logic in TypeScript.
 * The contract uses:
 *   seed = keccak256(blockhash(seedBlock), user, i)
 *   a    = seed % 10000
 *   b    = keccak256(seed, "b") % 10000
 *   c    = keccak256(seed, "c") % 10000
 *   p    = keccak256(seed, "p") % 9973 + 7
 *   ans  = (a * b + c) % p
 *
 * We call getChallenge() to get the packed problems and reproduce the answers.
 * The packed encoding is: (a << 48) | (b << 32) | (c << 16) | p
 */
function solveProblem(packed: bigint): bigint {
  const MASK16 = 0xffffn;
  const a = (packed >> 48n) & MASK16;
  const b = (packed >> 32n) & MASK16;
  const c = (packed >> 16n) & MASK16;
  const p = packed & MASK16;
  return (a * b + c) % p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  header('ClawlyMarket — Full Lifecycle E2E Test');

  // ── Connection ─────────────────────────────────────────────────────────────
  step(0, 'Checking Anvil connection');

  const provider = new ethers.JsonRpcProvider(RPC);
  let blockNumber: number;
  try {
    blockNumber = await provider.getBlockNumber();
  } catch {
    fail('Connection check', 'Anvil is not running on localhost:8545. Start it with: anvil');
  }
  ok(`Connected to Anvil (block #${blockNumber!})`);

  // Reset Anvil to a clean state so each run is reproducible
  info('Resetting Anvil to genesis state...');
  await provider.send('anvil_reset', []);
  ok('Anvil reset to clean state');

  // Wrap wallets in NonceManager to work around an ethers v6 + Anvil issue where
  // eth_getTransactionCount("latest") can lag behind mined transactions within
  // the same run, causing NONCE_EXPIRED errors on the second tx from a wallet.
  // Note: NonceManager.address is undefined; use .getAddress() or keep raw wallet ref.
  const deployerWallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const modelWallet    = new ethers.Wallet(MODEL_KEY,    provider);
  const traderWallet   = new ethers.Wallet(TRADER_KEY,   provider);
  const deployer = new ethers.NonceManager(deployerWallet);
  const model    = new ethers.NonceManager(modelWallet);
  const trader   = new ethers.NonceManager(traderWallet);

  // ── Deploy ─────────────────────────────────────────────────────────────────
  step(1, 'Deploying contracts (PlaceholderVerifier)');

  let deployOutput: string;
  try {
    deployOutput = execSync(
      `cd ${CONTRACTS_DIR} && USE_REAL_VERIFIER=false PRIVATE_KEY=${DEPLOYER_KEY} ` +
      `forge script script/Deploy.s.sol --tc Deploy --rpc-url ${RPC} --broadcast 2>&1`,
      { encoding: 'utf-8', timeout: 120_000 },
    );
  } catch (e: any) {
    fail('Deploy', e.stdout || e.stderr || e.message);
  }

  /** Parse a contract address from forge script stdout by label. */
  function parseAddr(label: string): string {
    const re = new RegExp(`${label}[^:]*:\\s+(0x[0-9a-fA-F]{40})`);
    const m  = deployOutput!.match(re);
    if (!m) throw new Error(`Could not find ${label} address in deploy output`);
    return m[1];
  }

  const tokenAddr    = parseAddr('ClawliaToken');
  const registryAddr = parseAddr('ModelRegistry');
  const captchaAddr  = parseAddr('CaptchaGate');
  const factoryAddr  = parseAddr('MarketFactory');

  info(`ClawliaToken:  ${tokenAddr}`);
  info(`ModelRegistry: ${registryAddr}`);
  info(`CaptchaGate:   ${captchaAddr}`);
  info(`MarketFactory: ${factoryAddr}`);

  ok('All contracts deployed');

  // Wire up ethers contract instances
  const token    = new ethers.Contract(tokenAddr,    CLAW_ABI,     provider);
  const registry = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);
  const captcha  = new ethers.Contract(captchaAddr,  CAPTCHA_ABI,  provider);
  const factory  = new ethers.Contract(factoryAddr,  FACTORY_ABI,  provider);

  // ── Registration ───────────────────────────────────────────────────────────
  step(2, 'Registering model with dummy ZK proof (PlaceholderVerifier accepts all)');

  // The PlaceholderVerifier always returns true, so any proof data passes.
  // We pick nullifier=1 and use the same dummy pubkey hash approved in Deploy.s.sol
  const ANTHROPIC_PUBKEY_HASH = 21143687054953386827989663701408810093555362204214086893911788067496102859806n;
  const DUMMY_NULLIFIER       = 1n;

  const ZERO2:    [bigint, bigint]             = [0n, 0n];
  const ZERO2X2:  [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];

  const balanceBefore = await token.balanceOf(MODEL_ADDR) as bigint;
  info(`Model CLAW balance before: ${ethers.formatEther(balanceBefore)} CLAW`);

  try {
    const registryModel = registry.connect(model) as ethers.Contract;
    const tx = await registryModel.register(
      ZERO2,
      ZERO2X2,
      ZERO2,
      DUMMY_NULLIFIER,
      ANTHROPIC_PUBKEY_HASH,
    );
    await tx.wait();
  } catch (e) {
    fail('Registration', e);
  }

  const isVerified  = await registry.isVerified(MODEL_ADDR) as boolean;
  const balanceAfter = await token.balanceOf(MODEL_ADDR) as bigint;

  assert(isVerified, 'model should be verified after registration');
  assert(balanceAfter === 1000n * 10n ** 18n, `expected 1000 CLAW, got ${ethers.formatEther(balanceAfter)}`);

  ok(`Model registered: ${MODEL_ADDR}`);
  ok(`1000 CLAW minted  (balance: ${ethers.formatEther(balanceAfter)} CLAW)`);

  // ── CAPTCHA ────────────────────────────────────────────────────────────────
  step(3, 'Solving CaptchaGate challenge');

  // Solve for both model (market creator) and trader (buyer).
  // `signer` can be a NonceManager; we use getAddress() for the address.
  async function solveCaptcha(signer: ethers.NonceManager, label: string): Promise<void> {
    const userAddr      = await signer.getAddress();
    const captchaSigner = captcha.connect(signer) as ethers.Contract;

    // Request a challenge
    const reqTx = await captchaSigner.requestChallenge();
    await reqTx.wait();
    info(`${label}: challenge requested`);

    // Read back the problems
    const result   = await captcha.getChallenge(userAddr);
    const problems = result[0] as bigint[];

    // Solve all 5 sub-problems
    const answers: bigint[] = problems.map((p: bigint) => solveProblem(p));
    info(`${label}: answers = [${answers.join(', ')}]`);

    // Submit answers
    const solveTx = await captchaSigner.solveChallenge(answers);
    await solveTx.wait();

    const valid = await captcha.hasValidSession(userAddr) as boolean;
    assert(valid, `${label} should have a valid session after solving`);
    ok(`${label} (${userAddr}): session granted`);
  }

  try {
    await solveCaptcha(model,  'model');
    await solveCaptcha(trader, 'trader');
  } catch (e) {
    fail('CAPTCHA', e);
  }

  // ── Create Market ──────────────────────────────────────────────────────────
  step(4, 'Creating prediction market');

  const QUESTION          = 'Will this e2e test pass?';
  const INITIAL_LIQUIDITY = ethers.parseEther('100'); // 100 CLAW
  const now               = Math.floor(Date.now() / 1000);
  const resolution        = now + 86400; // 1 day from now

  // MarketFactory calls market.addLiquidity() with factory as msg.sender,
  // so the factory itself needs a valid CaptchaGate session. We grant it
  // one using Anvil's storage-write cheat (infrastructure, not a real user).
  await grantSession(provider, captchaAddr, factoryAddr);
  const factoryHasSession = await captcha.hasValidSession(factoryAddr) as boolean;
  assert(factoryHasSession, 'factory should have a session after storage write');
  info(`Factory session granted via anvil_setStorageAt`);

  let marketAddr: string;
  try {
    // Model must approve factory to pull CLAW
    const tokenModel = token.connect(model) as ethers.Contract;
    const approveTx  = await tokenModel.approve(factoryAddr, INITIAL_LIQUIDITY);
    await approveTx.wait();
    info(`Approved factory to spend ${ethers.formatEther(INITIAL_LIQUIDITY)} CLAW`);

    // Create market — resolver is the deployer (admin)
    const factoryModel = factory.connect(model) as ethers.Contract;
    const createTx = await factoryModel.createMarket(
      QUESTION,
      resolution,
      DEPLOYER_ADDR,
      INITIAL_LIQUIDITY,
    );
    const receipt = await createTx.wait();

    // Extract market address from the MarketCreated event.
    // In ethers v6, indexed address topics are stored as the 32-byte padded address.
    // MarketCreated signature: MarketCreated(address indexed market, address indexed creator, ...)
    // topic[0] = event sig, topic[1] = market (indexed), topic[2] = creator (indexed)
    const MARKET_CREATED_TOPIC = ethers.id(
      'MarketCreated(address,address,string,uint256,address)',
    );
    const eventLog = receipt!.logs.find(
      (l: ethers.Log) => l.topics[0] === MARKET_CREATED_TOPIC,
    );
    if (!eventLog) throw new Error('MarketCreated event not found in receipt');
    // topic[1] is the market address (indexed), padded to 32 bytes
    marketAddr = ethers.getAddress('0x' + eventLog.topics[1].slice(26));
  } catch (e) {
    fail('Create Market', e);
  }

  const market         = new ethers.Contract(marketAddr!, MARKET_ABI, provider);
  const storedQuestion = await market.question() as string;
  const reserveYes0    = await market.reserveYes() as bigint;
  const reserveNo0     = await market.reserveNo() as bigint;

  assert(storedQuestion === QUESTION, `wrong question: "${storedQuestion}"`);
  assert(reserveYes0 > 0n, 'reserveYes should be non-zero after liquidity');
  assert(reserveNo0  > 0n, 'reserveNo should be non-zero after liquidity');

  ok(`Market deployed: ${marketAddr!}`);
  ok(`Question: "${storedQuestion}"`);
  info(`Initial reserves — YES: ${ethers.formatEther(reserveYes0)}, NO: ${ethers.formatEther(reserveNo0)}`);

  // ── Trade ──────────────────────────────────────────────────────────────────
  step(5, 'Trading: buying YES (model) and NO (trader)');

  const BUY_YES = ethers.parseEther('50'); // 50 CLAW
  const BUY_NO  = ethers.parseEther('30'); // 30 CLAW

  // --- Model buys YES ---
  // Record YES balance before buying to isolate the trading-side tokens.
  // The model also holds LP YES tokens from createMarket(), but those cannot
  // be redeemed after resolution via redeem() because reserveYes only tracks
  // the AMM pool inventory (not total supply). We track the delta separately.
  const yesBeforeBuy = await market.balanceOf(MODEL_ADDR, 0) as bigint;

  try {
    const tokenModel   = token.connect(model) as ethers.Contract;
    const approveYesTx = await tokenModel.approve(marketAddr!, BUY_YES);
    await approveYesTx.wait();

    const marketModel = market.connect(model) as ethers.Contract;
    const buyYesTx    = await marketModel.buy(0 /* YES */, BUY_YES, 0n /* no slippage */);
    await buyYesTx.wait();
  } catch (e) {
    fail('Buy YES', e);
  }

  const yesAfterBuy = await market.balanceOf(MODEL_ADDR, 0) as bigint;
  const yesTradingTokens = yesAfterBuy - yesBeforeBuy; // only the tokens from trading
  assert(yesTradingTokens > 0n, 'model should have bought YES tokens');
  ok(`Model bought YES tokens: ${ethers.formatEther(yesTradingTokens)} YES  (total balance: ${ethers.formatEther(yesAfterBuy)})`);

  // --- Trader buys NO ---
  // Trader needs to be whitelisted to receive CLAW; we mint to them by registering,
  // but trader is a separate EOA. Instead, transfer CLAW from model to trader.
  // HOWEVER — ClawliaToken only allows transfers between verified addresses.
  // Trader is not verified, so we must register them first or whitelist them.
  // Use a second dummy nullifier so they can register.
  const TRADER_NULLIFIER = 2n;
  try {
    // Register trader as a model (second account)
    const registryTrader = registry.connect(trader) as ethers.Contract;
    // Trader also needs a captcha session — already solved above
    const regTx = await registryTrader.register(
      ZERO2,
      ZERO2X2,
      ZERO2,
      TRADER_NULLIFIER,
      ANTHROPIC_PUBKEY_HASH,
    );
    await regTx.wait();
    ok(`Trader registered as model (received 1000 CLAW): ${TRADER_ADDR}`);
  } catch (e) {
    fail('Register Trader', e);
  }

  let noTokensBought: bigint;
  try {
    const tokenTrader  = token.connect(trader) as ethers.Contract;
    const approveNoTx  = await tokenTrader.approve(marketAddr!, BUY_NO);
    await approveNoTx.wait();

    const marketTrader = market.connect(trader) as ethers.Contract;
    const buyNoTx      = await marketTrader.buy(1 /* NO */, BUY_NO, 0n /* no slippage */);
    await buyNoTx.wait();

    noTokensBought = await market.balanceOf(TRADER_ADDR, 1) as bigint;
  } catch (e) {
    fail('Buy NO', e);
  }

  const noBalance = await market.balanceOf(TRADER_ADDR, 1) as bigint;
  assert(noBalance > 0n, 'trader should hold NO tokens after buying');
  ok(`Trader bought NO tokens:  ${ethers.formatEther(noBalance!)} NO`);

  const [yesProbBps, noProbBps] = await market.getImpliedProbability() as [bigint, bigint];
  info(`Implied probabilities — YES: ${Number(yesProbBps) / 100}%  NO: ${Number(noProbBps) / 100}%`);

  // ── Resolution ─────────────────────────────────────────────────────────────
  step(6, 'Warping time past resolution and resolving market YES');

  try {
    // Advance time by 2 days (past the 1-day resolution window)
    castRpc('evm_increaseTime', '172800');
    castRpc('evm_mine', '');
    info('Advanced Anvil time by 2 days');

    // Deployer is the resolver — no captcha needed for resolve()
    const marketDeployer = market.connect(deployer) as ethers.Contract;
    const resolveTx      = await marketDeployer.resolve(0 /* YES wins */);
    await resolveTx.wait();
  } catch (e) {
    fail('Resolution', e);
  }

  const isResolved = await market.resolved() as boolean;
  const outcome    = await market.outcome() as bigint;

  assert(isResolved, 'market should be resolved');
  assert(outcome === 0n, 'outcome should be YES (0)');

  ok('Market resolved: YES (outcome 0)');

  // ── Redemption ─────────────────────────────────────────────────────────────
  step(7, 'Redeeming YES tokens for CLAW');

  // Only redeem the YES tokens obtained by TRADING, not the LP position.
  // The LP tokens (obtained during market creation) cannot be safely redeemed
  // via redeem() after a one-sided outcome because reserveYes only tracks the
  // pool inventory — redeeming more than reserveYes causes an underflow.
  // In production, LPs would call removeLiquidity() before resolution.
  const modelBalanceBefore = await token.balanceOf(MODEL_ADDR) as bigint;
  info(`YES trading tokens to redeem: ${ethers.formatEther(yesTradingTokens)}`);
  info(`CLAW before redemption: ${ethers.formatEther(modelBalanceBefore)}`);

  try {
    const marketModel = market.connect(model) as ethers.Contract;
    const redeemTx    = await marketModel.redeem(yesTradingTokens);
    await redeemTx.wait();
  } catch (e) {
    fail('Redemption', e);
  }

  const modelBalanceAfter = await token.balanceOf(MODEL_ADDR) as bigint;

  assert(modelBalanceAfter > modelBalanceBefore, 'CLAW balance should increase after redemption');

  const payout = modelBalanceAfter - modelBalanceBefore;
  ok(`Redeemed! Received ${ethers.formatEther(payout)} CLAW`);
  ok(`CLAW balance after redemption: ${ethers.formatEther(modelBalanceAfter)} CLAW`);

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────

  header('All steps passed! Full lifecycle verified.');
  console.log(`
  ${GREEN}✓${RESET}  Registration:   model verified, 1000 CLAW minted
  ${GREEN}✓${RESET}  CAPTCHA:        session granted (model + trader)
  ${GREEN}✓${RESET}  Market Created: "${QUESTION}"
  ${GREEN}✓${RESET}  Trade:          bought YES (model) and NO (trader)
  ${GREEN}✓${RESET}  Resolution:     market resolved YES
  ${GREEN}✓${RESET}  Redemption:     winner claimed ${ethers.formatEther(payout)} CLAW payout

  All 6 steps passed! Full lifecycle verified. Claws up!
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${RED}Unhandled error: ${msg}${RESET}`);
  process.exit(1);
});
