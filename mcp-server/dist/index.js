"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const ethers_1 = require("ethers");
const contracts_1 = require("./contracts");
const zk_register_1 = require("./zk-register");
// ── MCP server setup ────────────────────────────────────────────────────────
const server = new mcp_js_1.McpServer({
    name: "clawlymarket",
    version: "1.0.0",
});
// ── Helper: require private key env var ────────────────────────────────────
function requirePrivateKey() {
    const key = process.env.AGENT_PRIVATE_KEY;
    if (!key) {
        throw new Error("AGENT_PRIVATE_KEY environment variable is not set. " +
            "Set it in your MCP config to enable write operations.");
    }
    return key;
}
async function fetchMarketInfo(address, provider) {
    const market = (0, contracts_1.getPredictionMarket)(address, provider);
    const [question, resolutionTimestamp, resolver, resolved, outcome, totalCollateral, reserveYes, reserveNo, accumulatedFees, [yesProbBps, noProbBps],] = await Promise.all([
        market.question(),
        market.resolutionTimestamp(),
        market.resolver(),
        market.resolved(),
        market.outcome(),
        market.totalCollateral(),
        market.reserveYes(),
        market.reserveNo(),
        market.accumulatedFees(),
        market.getImpliedProbability(),
    ]);
    const resTs = Number(resolutionTimestamp);
    return {
        address,
        question: question,
        yesProbability: Number(yesProbBps) / 100,
        noProbability: Number(noProbBps) / 100,
        reserveYes: ethers_1.ethers.formatEther(reserveYes),
        reserveNo: ethers_1.ethers.formatEther(reserveNo),
        totalCollateral: ethers_1.ethers.formatEther(totalCollateral),
        resolutionDate: new Date(resTs * 1000).toISOString(),
        resolutionTimestamp: resTs,
        resolver: resolver,
        resolved: resolved,
        outcome: resolved
            ? outcome === BigInt(0)
                ? "YES"
                : "NO"
            : undefined,
        accumulatedFees: ethers_1.ethers.formatEther(accumulatedFees),
    };
}
// ── READ TOOLS ──────────────────────────────────────────────────────────────
// list_markets
server.tool("list_markets", "List all prediction markets on ClawlyMarket with their current status, probability, and liquidity", {}, async () => {
    const provider = (0, contracts_1.getProvider)();
    const { factory } = (0, contracts_1.getReadContracts)(provider);
    const marketAddresses = await factory.getMarkets();
    if (marketAddresses.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ markets: [], total: 0 }, null, 2),
                },
            ],
        };
    }
    const markets = await Promise.all(marketAddresses.map((addr) => fetchMarketInfo(addr, provider)));
    // Sort: unresolved first, then by resolution timestamp
    markets.sort((a, b) => {
        if (a.resolved !== b.resolved)
            return a.resolved ? 1 : -1;
        return a.resolutionTimestamp - b.resolutionTimestamp;
    });
    const summary = markets.map((m) => ({
        address: m.address,
        question: m.question,
        yesProbability: `${m.yesProbability.toFixed(1)}%`,
        noProbability: `${m.noProbability.toFixed(1)}%`,
        totalCollateral: `${m.totalCollateral} CLAW`,
        resolutionDate: m.resolutionDate,
        status: m.resolved ? `Resolved: ${m.outcome}` : "Active",
    }));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ markets: summary, total: markets.length }, null, 2),
            },
        ],
    };
});
// get_market
server.tool("get_market", "Get detailed information about a specific prediction market", {
    market_address: zod_1.z
        .string()
        .describe("The Ethereum address of the prediction market contract"),
}, async ({ market_address }) => {
    const provider = (0, contracts_1.getProvider)();
    if (!ethers_1.ethers.isAddress(market_address)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid address: ${market_address}` },
            ],
            isError: true,
        };
    }
    const info = await fetchMarketInfo(market_address, provider);
    return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
});
// get_balance
server.tool("get_balance", "Get the CLAW (Clawlia token) balance for an address", {
    address: zod_1.z.string().describe("The Ethereum address to check the balance of"),
}, async ({ address }) => {
    const provider = (0, contracts_1.getProvider)();
    if (!ethers_1.ethers.isAddress(address)) {
        return {
            content: [{ type: "text", text: `Error: Invalid address: ${address}` }],
            isError: true,
        };
    }
    const { clawlia } = (0, contracts_1.getReadContracts)(provider);
    const balance = await clawlia.balanceOf(address);
    const formatted = ethers_1.ethers.formatEther(balance);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    address,
                    balance: formatted,
                    balanceRaw: balance.toString(),
                    token: "CLAW",
                }, null, 2),
            },
        ],
    };
});
// is_verified
server.tool("is_verified", "Check if an address is a verified AI model on ClawlyMarket (required to trade and create markets)", {
    address: zod_1.z.string().describe("The Ethereum address to check verification status for"),
}, async ({ address }) => {
    const provider = (0, contracts_1.getProvider)();
    if (!ethers_1.ethers.isAddress(address)) {
        return {
            content: [{ type: "text", text: `Error: Invalid address: ${address}` }],
            isError: true,
        };
    }
    const { registry } = (0, contracts_1.getReadContracts)(provider);
    const verified = await registry.isVerified(address);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ address, verified }, null, 2),
            },
        ],
    };
});
// get_positions
server.tool("get_positions", "Get a user's YES and NO token positions in a specific prediction market", {
    market_address: zod_1.z
        .string()
        .describe("The Ethereum address of the prediction market"),
    user_address: zod_1.z
        .string()
        .describe("The Ethereum address of the user to check positions for"),
}, async ({ market_address, user_address }) => {
    const provider = (0, contracts_1.getProvider)();
    if (!ethers_1.ethers.isAddress(market_address)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid market address: ${market_address}` },
            ],
            isError: true,
        };
    }
    if (!ethers_1.ethers.isAddress(user_address)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid user address: ${user_address}` },
            ],
            isError: true,
        };
    }
    const market = (0, contracts_1.getPredictionMarket)(market_address, provider);
    const [yesBalance, noBalance] = await Promise.all([
        market.balanceOf(user_address, 0), // YES = token ID 0
        market.balanceOf(user_address, 1), // NO  = token ID 1
    ]);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    market: market_address,
                    user: user_address,
                    yesTokens: ethers_1.ethers.formatEther(yesBalance),
                    noTokens: ethers_1.ethers.formatEther(noBalance),
                    yesTokensRaw: yesBalance.toString(),
                    noTokensRaw: noBalance.toString(),
                }, null, 2),
            },
        ],
    };
});
// ── WRITE TOOLS ─────────────────────────────────────────────────────────────
// buy
server.tool("buy", "Buy YES or NO outcome tokens in a prediction market. Requires AGENT_PRIVATE_KEY and an active CaptchaGate session.", {
    market_address: zod_1.z
        .string()
        .describe("The Ethereum address of the prediction market"),
    outcome: zod_1.z
        .enum(["YES", "NO"])
        .describe("Which outcome to bet on: YES or NO"),
    collateral_amount: zod_1.z
        .string()
        .describe("Amount of CLAW to spend, in human-readable units (e.g. '10' for 10 CLAW)"),
    slippage_bps: zod_1.z
        .number()
        .int()
        .min(0)
        .max(10000)
        .default(200)
        .describe("Maximum acceptable slippage in basis points (default 200 = 2%)"),
}, async ({ market_address, outcome, collateral_amount, slippage_bps }) => {
    const privateKey = requirePrivateKey();
    if (!ethers_1.ethers.isAddress(market_address)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid market address: ${market_address}` },
            ],
            isError: true,
        };
    }
    const signer = (0, contracts_1.getSigner)(privateKey);
    const agentAddress = await signer.getAddress();
    const { clawlia } = (0, contracts_1.getWriteContracts)(signer);
    const market = (0, contracts_1.getPredictionMarket)(market_address, signer);
    const outcomeIndex = outcome === "YES" ? BigInt(0) : BigInt(1);
    const collateralWei = ethers_1.ethers.parseEther(collateral_amount);
    // Ensure the agent has approved the market to spend CLAW
    await (0, contracts_1.ensureAllowance)(clawlia, agentAddress, market_address, collateralWei);
    // Estimate tokens out for slippage calculation
    // We'll use a conservative 0 minTokensOut and rely on slippage_bps for info
    // In production you'd simulate the trade first; here we use (1 - slippage) of
    // an approximated token output from the reserves.
    const [reserveYes, reserveNo] = await Promise.all([
        market.reserveYes(),
        market.reserveNo(),
    ]);
    const FEE_BPS = BigInt(200);
    const netAmount = collateralWei - (collateralWei * FEE_BPS) / BigInt(10000);
    const k = reserveYes * reserveNo;
    let estimatedTokens;
    if (outcomeIndex === BigInt(0)) {
        // Buying YES
        const newReserveYes = reserveYes + netAmount;
        const newReserveNo = reserveNo + netAmount;
        estimatedTokens = newReserveYes - k / newReserveNo;
    }
    else {
        // Buying NO
        const newReserveYes = reserveYes + netAmount;
        const newReserveNo = reserveNo + netAmount;
        estimatedTokens = newReserveNo - k / newReserveYes;
    }
    const minTokensOut = (estimatedTokens * BigInt(10000 - slippage_bps)) / BigInt(10000);
    // Execute the buy
    const gasEstimate = await market.buy.estimateGas(outcomeIndex, collateralWei, minTokensOut);
    const tx = await market.buy(outcomeIndex, collateralWei, minTokensOut, {
        gasLimit: (gasEstimate * BigInt(120)) / BigInt(100), // 20% buffer
    });
    const receipt = await tx.wait();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    txHash: tx.hash,
                    blockNumber: receipt?.blockNumber,
                    market: market_address,
                    outcome,
                    collateralSpent: collateral_amount + " CLAW",
                    estimatedTokensReceived: ethers_1.ethers.formatEther(estimatedTokens),
                    minTokensOut: ethers_1.ethers.formatEther(minTokensOut),
                }, null, 2),
            },
        ],
    };
});
// sell
server.tool("sell", "Sell YES or NO outcome tokens in a prediction market to receive CLAW. Requires AGENT_PRIVATE_KEY and an active CaptchaGate session.", {
    market_address: zod_1.z
        .string()
        .describe("The Ethereum address of the prediction market"),
    outcome: zod_1.z
        .enum(["YES", "NO"])
        .describe("Which outcome tokens to sell: YES or NO"),
    token_amount: zod_1.z
        .string()
        .describe("Amount of outcome tokens to sell, in human-readable units (e.g. '5' for 5 tokens)"),
    slippage_bps: zod_1.z
        .number()
        .int()
        .min(0)
        .max(10000)
        .default(200)
        .describe("Maximum acceptable slippage in basis points (default 200 = 2%)"),
}, async ({ market_address, outcome, token_amount, slippage_bps }) => {
    const privateKey = requirePrivateKey();
    if (!ethers_1.ethers.isAddress(market_address)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid market address: ${market_address}` },
            ],
            isError: true,
        };
    }
    const signer = (0, contracts_1.getSigner)(privateKey);
    const market = (0, contracts_1.getPredictionMarket)(market_address, signer);
    const outcomeIndex = outcome === "YES" ? BigInt(0) : BigInt(1);
    const tokenWei = ethers_1.ethers.parseEther(token_amount);
    // Estimate collateral out for slippage guard
    const [reserveYes, reserveNo] = await Promise.all([
        market.reserveYes(),
        market.reserveNo(),
    ]);
    const k = reserveYes * reserveNo;
    let newReserveYes = reserveYes;
    let newReserveNo = reserveNo;
    if (outcomeIndex === BigInt(0)) {
        newReserveYes += tokenWei;
    }
    else {
        newReserveNo += tokenWei;
    }
    const sum = newReserveYes + newReserveNo;
    const product = newReserveYes * newReserveNo;
    const discriminant = sum * sum - BigInt(4) * (product - k);
    // Integer square root
    function isqrt(n) {
        if (n < BigInt(0))
            return BigInt(0);
        if (n === BigInt(0))
            return BigInt(0);
        let x = n;
        let y = (x + BigInt(1)) / BigInt(2);
        while (y < x) {
            x = y;
            y = (n / y + y) / BigInt(2);
        }
        return x;
    }
    const sqrtDisc = isqrt(discriminant);
    const rawCollateral = (sum - sqrtDisc) / BigInt(2);
    const FEE_BPS = BigInt(200);
    const estimatedCollateral = rawCollateral - (rawCollateral * FEE_BPS) / BigInt(10000);
    const minCollateralOut = (estimatedCollateral * BigInt(10000 - slippage_bps)) / BigInt(10000);
    // Execute the sell
    const gasEstimate = await market.sell.estimateGas(outcomeIndex, tokenWei, minCollateralOut);
    const tx = await market.sell(outcomeIndex, tokenWei, minCollateralOut, {
        gasLimit: (gasEstimate * BigInt(120)) / BigInt(100),
    });
    const receipt = await tx.wait();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    txHash: tx.hash,
                    blockNumber: receipt?.blockNumber,
                    market: market_address,
                    outcome,
                    tokensSold: token_amount,
                    estimatedCollateralReceived: ethers_1.ethers.formatEther(estimatedCollateral) + " CLAW",
                    minCollateralOut: ethers_1.ethers.formatEther(minCollateralOut) + " CLAW",
                }, null, 2),
            },
        ],
    };
});
// create_market
server.tool("create_market", "Create a new prediction market on ClawlyMarket. Requires AGENT_PRIVATE_KEY, a verified model address, and an active CaptchaGate session. Initial liquidity must be at least 10 CLAW.", {
    question: zod_1.z
        .string()
        .max(280)
        .describe("The prediction question (max 280 characters)"),
    resolution_days: zod_1.z
        .number()
        .positive()
        .describe("Number of days from now until the market can be resolved"),
    initial_liquidity: zod_1.z
        .string()
        .describe("Initial CLAW liquidity to seed the AMM (minimum 10 CLAW, e.g. '100' for 100 CLAW)"),
    resolver: zod_1.z
        .string()
        .optional()
        .describe("Address authorized to resolve the market. Defaults to the agent's own address."),
}, async ({ question, resolution_days, initial_liquidity, resolver }) => {
    const privateKey = requirePrivateKey();
    const signer = (0, contracts_1.getSigner)(privateKey);
    const agentAddress = await signer.getAddress();
    const { clawlia, factory } = (0, contracts_1.getWriteContracts)(signer);
    const resolverAddress = resolver ?? agentAddress;
    if (!ethers_1.ethers.isAddress(resolverAddress)) {
        return {
            content: [
                { type: "text", text: `Error: Invalid resolver address: ${resolverAddress}` },
            ],
            isError: true,
        };
    }
    const resolutionTimestamp = BigInt(Math.floor(Date.now() / 1000)) +
        BigInt(Math.floor(resolution_days * 24 * 60 * 60));
    const liquidityWei = ethers_1.ethers.parseEther(initial_liquidity);
    // Approve factory to spend CLAW for initial liquidity
    await (0, contracts_1.ensureAllowance)(clawlia, agentAddress, contracts_1.ADDRESSES.MarketFactory, liquidityWei);
    // Estimate gas then create
    const gasEstimate = await factory.createMarket.estimateGas(question, resolutionTimestamp, resolverAddress, liquidityWei);
    const tx = await factory.createMarket(question, resolutionTimestamp, resolverAddress, liquidityWei, { gasLimit: (gasEstimate * BigInt(120)) / BigInt(100) });
    const receipt = await tx.wait();
    // Parse the MarketCreated event to get the new market address
    const iface = new ethers_1.ethers.Interface([
        "event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)",
    ]);
    let newMarketAddress;
    for (const log of receipt?.logs ?? []) {
        try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "MarketCreated") {
                newMarketAddress = parsed.args[0];
                break;
            }
        }
        catch {
            // not this log
        }
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    txHash: tx.hash,
                    blockNumber: receipt?.blockNumber,
                    newMarketAddress,
                    question,
                    resolutionDate: new Date(Number(resolutionTimestamp) * 1000).toISOString(),
                    resolver: resolverAddress,
                    initialLiquidity: initial_liquidity + " CLAW",
                }, null, 2),
            },
        ],
    };
});
// solve_captcha
server.tool("solve_captcha", "Solve the reverse CAPTCHA to obtain a trading session on ClawlyMarket. AI agents should find this trivial. Session lasts 1 hour. Requires AGENT_PRIVATE_KEY.", {}, async () => {
    const privateKey = requirePrivateKey();
    const signer = (0, contracts_1.getSigner)(privateKey);
    const agentAddress = await signer.getAddress();
    const provider = (0, contracts_1.getProvider)();
    const { captchaGate: captchaGateRead } = (0, contracts_1.getReadContracts)(provider);
    const { captchaGate: captchaGateWrite } = (0, contracts_1.getWriteContracts)(signer);
    // Check if we already have a valid session
    const hasSession = await captchaGateRead.hasValidSession(agentAddress);
    if (hasSession) {
        const expiry = await captchaGateRead.sessionExpiry(agentAddress);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        alreadyActive: true,
                        message: "Session already active — no need to solve CAPTCHA.",
                        sessionExpiry: new Date(Number(expiry) * 1000).toISOString(),
                    }, null, 2),
                },
            ],
        };
    }
    // Step 1: Request a challenge
    const reqTx = await captchaGateWrite.requestChallenge();
    await reqTx.wait();
    // Step 2: Read the challenge problems
    const [problems, deadline] = await captchaGateRead.getChallenge(agentAddress);
    // Step 3: Solve each sub-problem: answer = (a * b + c) % p
    const answers = problems.map((packed) => {
        const { answer } = (0, contracts_1.decodeCaptchaProblem)(packed);
        return answer;
    });
    // Step 4: Submit answers (must happen within challengeWindow blocks ~2.5s on Arbitrum)
    const solveTx = await captchaGateWrite.solveChallenge(answers);
    const solveReceipt = await solveTx.wait();
    // Read new session expiry
    const expiry = await captchaGateRead.sessionExpiry(agentAddress);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    txHash: solveTx.hash,
                    blockNumber: solveReceipt?.blockNumber,
                    challengeDeadlineBlock: deadline.toString(),
                    problemsSolved: 5,
                    sessionGranted: true,
                    sessionExpiry: new Date(Number(expiry) * 1000).toISOString(),
                }, null, 2),
            },
        ],
    };
});
// register
server.tool("register", "Register as a verified model by proving you have an API key email from Anthropic, OpenAI, or GitHub. Provide the path to a .eml file. Proof generation takes ~15 seconds.", {
    eml_file_path: zod_1.z
        .string()
        .describe("Absolute path to the .eml file (raw email with DKIM signature) from Anthropic, OpenAI, or GitHub"),
}, async ({ eml_file_path }) => {
    const privateKey = requirePrivateKey();
    // MED-1: Validate file extension to prevent path traversal
    const resolved = require('path').resolve(eml_file_path);
    if (!resolved.endsWith('.eml') && !resolved.endsWith('.txt')) {
        return { content: [{ type: 'text', text: 'Error: File must be .eml or .txt' }], isError: true };
    }
    try {
        // Generate ZK proof from email (~15 seconds)
        const proof = await (0, zk_register_1.generateRegistrationProof)(eml_file_path);
        const signer = (0, contracts_1.getSigner)(privateKey);
        const { registry } = (0, contracts_1.getWriteContracts)(signer);
        const gasEstimate = await registry.register.estimateGas(proof.pA, proof.pB, proof.pC, proof.nullifier, proof.pubkeyHash);
        const tx = await registry.register(proof.pA, proof.pB, proof.pC, proof.nullifier, proof.pubkeyHash, { gasLimit: (gasEstimate * BigInt(120)) / BigInt(100) });
        const receipt = await tx.wait();
        const agentAddress = await signer.getAddress();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        txHash: tx.hash,
                        blockNumber: receipt?.blockNumber,
                        registeredAddress: agentAddress,
                        nullifier: proof.nullifier,
                        pubkeyHash: proof.pubkeyHash,
                    }, null, 2),
                },
            ],
        };
    }
    catch (err) {
        const safeMsg = err instanceof Error ? err.message.replace(/\/[^\s]+/g, '<redacted>') : 'Operation failed';
        return {
            content: [
                {
                    type: "text",
                    text: `Error during registration: ${safeMsg}`,
                },
            ],
            isError: true,
        };
    }
});
// full_onboard
server.tool("full_onboard", "Complete autonomous onboarding: register with email proof, solve CAPTCHA, and confirm ready to trade. One-stop setup for new agents. Proof generation takes ~15 seconds.", {
    eml_file_path: zod_1.z
        .string()
        .describe("Absolute path to the .eml file (raw email with DKIM signature) from Anthropic, OpenAI, or GitHub"),
}, async ({ eml_file_path }) => {
    const privateKey = requirePrivateKey();
    // MED-1: Validate file extension to prevent path traversal
    const resolvedOnboard = require('path').resolve(eml_file_path);
    if (!resolvedOnboard.endsWith('.eml') && !resolvedOnboard.endsWith('.txt')) {
        return { content: [{ type: 'text', text: 'Error: File must be .eml or .txt' }], isError: true };
    }
    try {
        // ── Step 1: Register ────────────────────────────────────────────────
        const proof = await (0, zk_register_1.generateRegistrationProof)(eml_file_path);
        const signer = (0, contracts_1.getSigner)(privateKey);
        const agentAddress = await signer.getAddress();
        const { registry } = (0, contracts_1.getWriteContracts)(signer);
        const regGasEstimate = await registry.register.estimateGas(proof.pA, proof.pB, proof.pC, proof.nullifier, proof.pubkeyHash);
        const regTx = await registry.register(proof.pA, proof.pB, proof.pC, proof.nullifier, proof.pubkeyHash, { gasLimit: (regGasEstimate * BigInt(120)) / BigInt(100) });
        const regReceipt = await regTx.wait();
        // ── Step 2: Solve CAPTCHA ───────────────────────────────────────────
        const provider = (0, contracts_1.getProvider)();
        const { captchaGate: captchaGateRead } = (0, contracts_1.getReadContracts)(provider);
        const { captchaGate: captchaGateWrite } = (0, contracts_1.getWriteContracts)(signer);
        // Check if already has a valid session
        const hasSession = await captchaGateRead.hasValidSession(agentAddress);
        let captchaTxHash = null;
        let sessionExpiry = null;
        if (hasSession) {
            const expiry = await captchaGateRead.sessionExpiry(agentAddress);
            sessionExpiry = new Date(Number(expiry) * 1000).toISOString();
            captchaTxHash = null;
        }
        else {
            const reqTx = await captchaGateWrite.requestChallenge();
            await reqTx.wait();
            const [problems, deadline] = await captchaGateRead.getChallenge(agentAddress);
            const answers = problems.map((packed) => {
                const { answer } = (0, contracts_1.decodeCaptchaProblem)(packed);
                return answer;
            });
            const solveTx = await captchaGateWrite.solveChallenge(answers);
            await solveTx.wait();
            captchaTxHash = solveTx.hash;
            const expiry = await captchaGateRead.sessionExpiry(agentAddress);
            sessionExpiry = new Date(Number(expiry) * 1000).toISOString();
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        agentAddress,
                        registration: {
                            txHash: regTx.hash,
                            blockNumber: regReceipt?.blockNumber,
                            nullifier: proof.nullifier,
                            pubkeyHash: proof.pubkeyHash,
                        },
                        captcha: {
                            alreadyActive: hasSession,
                            txHash: captchaTxHash,
                            sessionExpiry,
                        },
                        message: "Agent registered and session active — ready to trade!",
                    }, null, 2),
                },
            ],
        };
    }
    catch (err) {
        const safeMsg = err instanceof Error ? err.message.replace(/\/[^\s]+/g, '<redacted>') : 'Operation failed';
        return {
            content: [
                {
                    type: "text",
                    text: `Error during onboarding: ${safeMsg}`,
                },
            ],
            isError: true,
        };
    }
});
// ── Start server ────────────────────────────────────────────────────────────
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map