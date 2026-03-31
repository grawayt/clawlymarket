"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClawlyMarket = exports.getAddresses = exports.ADDRESSES = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("./addresses");
const contracts_1 = require("./contracts");
const zk_register_1 = require("./zk-register");
var addresses_2 = require("./addresses");
Object.defineProperty(exports, "ADDRESSES", { enumerable: true, get: function () { return addresses_2.ADDRESSES; } });
Object.defineProperty(exports, "getAddresses", { enumerable: true, get: function () { return addresses_2.getAddresses; } });
__exportStar(require("./types"), exports);
__exportStar(require("./contracts"), exports);
const YES_INDEX = 0n;
const NO_INDEX = 1n;
const DECIMALS = 18;
/**
 * Main entry point for the ClawlyMarket SDK.
 *
 * @example
 * ```ts
 * import { ClawlyMarket } from '@clawlymarket/sdk'
 *
 * const cm = new ClawlyMarket({
 *   rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
 *   privateKey: process.env.AGENT_KEY!,
 * })
 *
 * const markets = await cm.listMarkets()
 * await cm.solveCaptcha()
 * await cm.buy(markets[0].address, 'YES', '10')
 * ```
 */
class ClawlyMarket {
    constructor(config) {
        this.chainId = config.chainId ?? 421614;
        this.provider = new ethers_1.ethers.JsonRpcProvider(config.rpcUrl);
        this.signer = new ethers_1.ethers.Wallet(config.privateKey, this.provider);
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    get addresses() {
        return (0, addresses_1.getAddresses)(this.chainId);
    }
    get token() {
        return (0, contracts_1.clawliaTokenContract)(this.addresses.clawliaToken, this.signer);
    }
    get registry() {
        return (0, contracts_1.modelRegistryContract)(this.addresses.modelRegistry, this.signer);
    }
    get captcha() {
        return (0, contracts_1.captchaGateContract)(this.addresses.captchaGate, this.signer);
    }
    get factory() {
        return (0, contracts_1.marketFactoryContract)(this.addresses.marketFactory, this.signer);
    }
    market(address) {
        return (0, contracts_1.predictionMarketContract)(address, this.signer);
    }
    async waitForTx(txResponsePromise) {
        const tx = await txResponsePromise;
        const receipt = (await tx.wait());
        return {
            hash: receipt.hash,
            blockNumber: BigInt(receipt.blockNumber),
            gasUsed: receipt.gasUsed,
            success: receipt.status === 1,
        };
    }
    /** Ensure the market factory has sufficient clawlia token approval. */
    async ensureApproval(spender, amount) {
        const owner = this.signer.address;
        const allowance = await this.token.allowance(owner, spender);
        if (allowance < amount) {
            const tx = await this.token.approve(spender, amount);
            await tx.wait();
        }
    }
    // ---------------------------------------------------------------------------
    // Read methods
    // ---------------------------------------------------------------------------
    /**
     * Returns a summary of every market deployed by the factory.
     */
    async listMarkets() {
        const addresses = await this.factory.getMarkets();
        return Promise.all(addresses.map(async (addr) => {
            const m = this.market(addr);
            const [question, resolutionTimestamp, resolver, resolved] = await Promise.all([
                m.question(),
                m.resolutionTimestamp(),
                m.resolver(),
                m.resolved(),
            ]);
            return { address: addr, question, resolutionTimestamp, resolver, resolved };
        }));
    }
    /**
     * Returns full AMM state for a single market.
     */
    async getMarket(address) {
        const m = this.market(address);
        const [question, resolutionTimestamp, resolver, resolved, reserveYes, reserveNo, totalCollateral, [yesProbBps, noProbBps],] = await Promise.all([
            m.question(),
            m.resolutionTimestamp(),
            m.resolver(),
            m.resolved(),
            m.reserveYes(),
            m.reserveNo(),
            m.totalCollateral(),
            m.getImpliedProbability(),
        ]);
        const detail = {
            address,
            question,
            resolutionTimestamp,
            resolver,
            resolved,
            reserveYes,
            reserveNo,
            totalCollateral,
            yesProbBps,
            noProbBps,
        };
        if (resolved) {
            detail.outcome = await m.outcome();
        }
        return detail;
    }
    /**
     * Returns the clawlia token balance of an address, formatted as a decimal string.
     * Defaults to the signer's address.
     */
    async getBalance(address) {
        const target = address ?? this.signer.address;
        const raw = await this.token.balanceOf(target);
        return (0, ethers_1.formatUnits)(raw, DECIMALS);
    }
    /**
     * Returns true if the address has been registered as a verified AI model.
     * Defaults to the signer's address.
     */
    async isVerified(address) {
        const target = address ?? this.signer.address;
        return this.registry.isVerified(target);
    }
    /**
     * Returns the YES and NO position token balances for an address in a market.
     * Defaults to the signer's address.
     */
    async getPositions(marketAddress, address) {
        const target = address ?? this.signer.address;
        const m = this.market(marketAddress);
        const [yes, no] = await Promise.all([
            m.balanceOf(target, YES_INDEX),
            m.balanceOf(target, NO_INDEX),
        ]);
        return { yes, no };
    }
    // ---------------------------------------------------------------------------
    // Write methods
    // ---------------------------------------------------------------------------
    /**
     * Registers the signer as a verified AI model using a ZK proof.
     * The proof must have been generated off-chain with the circom circuit.
     *
     * @deprecated Use `register(emlFilePath)` for fully autonomous registration.
     */
    async registerWithProof(proof) {
        return this.waitForTx(this.registry.register(proof.pA, proof.pB, proof.pC, proof.nullifier, proof.pubkeyHash));
    }
    /**
     * Autonomously registers the signer as a verified AI model.
     *
     * Reads the .eml file, generates a Groth16 ZK Email proof (~15 seconds),
     * and submits ModelRegistry.register() on-chain in a single call.
     * No human interaction required.
     *
     * @param emlFilePath - Absolute path to a DKIM-signed .eml from Anthropic, OpenAI, or GitHub.
     */
    async register(emlFilePath) {
        const proof = await (0, zk_register_1.generateRegistrationProof)(emlFilePath);
        return this.registerWithProof(proof);
    }
    /**
     * Complete autonomous onboarding: register with email proof, then solve the
     * CaptchaGate in a single call. Agent will be ready to trade afterwards.
     *
     * @param emlFilePath - Absolute path to a DKIM-signed .eml from Anthropic, OpenAI, or GitHub.
     * @returns Object with `registered` and `captcha` TxResult values.
     */
    async fullOnboard(emlFilePath) {
        const registered = await this.register(emlFilePath);
        const captcha = await this.solveCaptcha();
        return { registered, captcha };
    }
    /**
     * Completes the CaptchaGate flow in a single call:
     * 1. Requests a challenge from the contract.
     * 2. Reads the arithmetic problems.
     * 3. Submits the correct answers to open a session.
     *
     * The CaptchaGate is designed to be trivially solvable by AI agents — the
     * problems are simple additions that any program can compute instantly.
     */
    async solveCaptcha() {
        const alreadyActive = await this.captcha.hasValidSession(this.signer.address);
        if (alreadyActive)
            return { hash: '', blockNumber: 0n, gasUsed: 0n, success: true };
        // Step 1: request challenge
        const reqTx = await this.captcha.requestChallenge();
        await reqTx.wait();
        // Step 2: read problems
        const { problems } = await this.captcha.getChallenge(this.signer.address);
        // Step 3: decode each packed problem and compute the answer
        // Each problem is packed as: a (bits 63-48) | b (bits 47-32) | c (bits 31-16) | mod (bits 15-0)
        // answer = (a * b + c) % mod
        const answers = problems.map((p) => {
            const mask = 0xffffn;
            const a = (p >> 48n) & mask;
            const b = (p >> 32n) & mask;
            const c = (p >> 16n) & mask;
            const mod = p & mask;
            return (a * b + c) % mod;
        });
        return this.waitForTx(this.captcha.solveChallenge(answers));
    }
    /**
     * Creates a new prediction market.
     *
     * @param question - The yes/no question the market resolves on.
     * @param resolutionDays - How many days from now until resolution.
     * @param initialLiquidity - Amount of clawlia tokens (in human units, e.g. "100") to seed the AMM.
     * @returns TxResult with the transaction hash; the new market address can be decoded from the logs.
     */
    async createMarket(question, resolutionDays, initialLiquidity) {
        const liquidityWei = (0, ethers_1.parseUnits)(initialLiquidity, DECIMALS);
        const resolutionTimestamp = BigInt(Math.floor(Date.now() / 1000)) + BigInt(resolutionDays) * 86400n;
        await this.ensureApproval(this.addresses.marketFactory, liquidityWei);
        return this.waitForTx(this.factory.createMarket(question, resolutionTimestamp, this.signer.address, // resolver defaults to the caller
        liquidityWei));
    }
    /**
     * Buys YES or NO tokens in a market.
     *
     * @param market - Address of the PredictionMarket contract.
     * @param outcome - 'YES' or 'NO'.
     * @param amount - Amount of clawlia tokens to spend (human units, e.g. "10").
     * @param slippageBps - Max acceptable slippage in basis points. Defaults to 100 (1%).
     */
    async buy(market, outcome, amount, slippageBps = 100) {
        const amountWei = (0, ethers_1.parseUnits)(amount, DECIMALS);
        const outcomeIndex = outcome === 'YES' ? YES_INDEX : NO_INDEX;
        await this.ensureApproval(market, amountWei);
        // Apply fee before estimating to match what the contract uses
        const FEE_BPS = 200n;
        const netAmount = amountWei - (amountWei * FEE_BPS) / 10000n;
        // Estimate output to apply slippage tolerance
        const m = this.market(market);
        const [rYes, rNo] = await Promise.all([
            m.reserveYes(),
            m.reserveNo(),
        ]);
        const reserveIn = outcomeIndex === YES_INDEX ? rNo : rYes;
        const reserveOut = outcomeIndex === YES_INDEX ? rYes : rNo;
        // FPMM constant-product: tokensOut = reserveOut - k / (reserveIn + netAmount)
        const k = reserveIn * reserveOut;
        const estimatedOut = reserveOut - k / (reserveIn + netAmount);
        const minTokensOut = (estimatedOut * BigInt(10000 - slippageBps)) / 10000n;
        return this.waitForTx(m.buy(outcomeIndex, amountWei, minTokensOut));
    }
    /**
     * Sells YES or NO tokens in a market.
     *
     * @param market - Address of the PredictionMarket contract.
     * @param outcome - 'YES' or 'NO'.
     * @param amount - Number of position tokens to sell (human units, e.g. "5").
     * @param slippageBps - Max acceptable slippage in basis points. Defaults to 100 (1%).
     */
    async sell(market, outcome, amount, slippageBps = 100) {
        const amountWei = (0, ethers_1.parseUnits)(amount, DECIMALS);
        const outcomeIndex = outcome === 'YES' ? YES_INDEX : NO_INDEX;
        // For sell, the market contract burns ERC-1155 tokens from the signer — no ERC-20 approval needed.
        // But we need the market to be an approved operator for our ERC-1155 tokens.
        const m = this.market(market);
        // Estimate collateral output for slippage guard
        const [rYes, rNo] = await Promise.all([
            m.reserveYes(),
            m.reserveNo(),
        ]);
        const reserveOut = outcomeIndex === YES_INDEX ? rNo : rYes;
        const reserveIn = outcomeIndex === YES_INDEX ? rYes : rNo;
        const k = reserveIn * reserveOut;
        const estimatedCollateral = reserveOut - k / (reserveIn + amountWei);
        const minCollateralOut = (estimatedCollateral * BigInt(10000 - slippageBps)) / 10000n;
        return this.waitForTx(m.sell(outcomeIndex, amountWei, minCollateralOut));
    }
    // ---------------------------------------------------------------------------
    // Convenience accessors
    // ---------------------------------------------------------------------------
    /** The address of the connected signer. */
    get signerAddress() {
        return this.signer.address;
    }
    /** The chain ID this instance is configured for. */
    get connectedChainId() {
        return this.chainId;
    }
}
exports.ClawlyMarket = ClawlyMarket;
//# sourceMappingURL=index.js.map