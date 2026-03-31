"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTCHA_GATE_ABI = exports.PREDICTION_MARKET_ABI = exports.MARKET_FACTORY_ABI = exports.MODEL_REGISTRY_ABI = exports.CLAWLIA_ABI = exports.RPC_URL = exports.ADDRESSES = void 0;
exports.getProvider = getProvider;
exports.getSigner = getSigner;
exports.getReadContracts = getReadContracts;
exports.getWriteContracts = getWriteContracts;
exports.getPredictionMarket = getPredictionMarket;
exports.decodeCaptchaProblem = decodeCaptchaProblem;
exports.ensureAllowance = ensureAllowance;
const ethers_1 = require("ethers");
// ── Deployed addresses on Arbitrum Sepolia ──────────────────────────────────
exports.ADDRESSES = {
    ClawliaToken: "0x8DD72e134641e0Ef04e8CD1aE97566F21E2f816a",
    ModelRegistry: "0xECD445CAd04f6a1ac0f0C3eC0FD48140B4381586",
    MarketFactory: "0xC1e8E62021DB22C416Ad41CE9472C1D3f07EAE02",
    CaptchaGate: "0x30b619BAed6DcD055e28228cA7E113681AeCb6B3",
};
exports.RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
// ── Minimal ABIs (only the functions we actually call) ──────────────────────
exports.CLAWLIA_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function verified(address) external view returns (bool)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
];
exports.MODEL_REGISTRY_ABI = [
    "function isVerified(address model) external view returns (bool)",
    "function getRegisteredModelCount() external view returns (uint256)",
    "function getRegisteredModel(uint256 index) external view returns (address)",
    "function registered(address) external view returns (bool)",
    "function register(uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256 nullifier, uint256 pubkeyHash) external",
];
exports.MARKET_FACTORY_ABI = [
    "function getMarkets() external view returns (address[])",
    "function getMarketCount() external view returns (uint256)",
    "function markets(uint256) external view returns (address)",
    "function createMarket(string calldata question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) external returns (address)",
    "event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)",
];
exports.PREDICTION_MARKET_ABI = [
    // View
    "function question() external view returns (string)",
    "function resolutionTimestamp() external view returns (uint256)",
    "function resolver() external view returns (address)",
    "function resolved() external view returns (bool)",
    "function outcome() external view returns (uint256)",
    "function totalCollateral() external view returns (uint256)",
    "function reserveYes() external view returns (uint256)",
    "function reserveNo() external view returns (uint256)",
    "function accumulatedFees() external view returns (uint256)",
    "function getImpliedProbability() external view returns (uint256 yesProbBps, uint256 noProbBps)",
    "function balanceOf(address account, uint256 id) external view returns (uint256)",
    // Write
    "function buy(uint256 outcomeIndex, uint256 collateralAmount, uint256 minTokensOut) external returns (uint256 tokensOut)",
    "function sell(uint256 outcomeIndex, uint256 tokenAmount, uint256 minCollateralOut) external returns (uint256 collateralOut)",
    "function addLiquidity(uint256 amount) external returns (uint256 yesTokens, uint256 noTokens)",
    "function removeLiquidity(uint256 yesAmount, uint256 noAmount) external returns (uint256 collateral)",
    "function redeem(uint256 amount) external",
    "function setApprovalForAll(address operator, bool approved) external",
];
exports.CAPTCHA_GATE_ABI = [
    "function hasValidSession(address user) external view returns (bool)",
    "function sessionExpiry(address) external view returns (uint256)",
    "function requestChallenge() external",
    "function getChallenge(address user) external view returns (uint256[5] memory problems, uint256 deadline)",
    "function solveChallenge(uint256[5] calldata answers) external",
    "function challengeWindow() external view returns (uint256)",
    "event ChallengeIssued(address indexed user, uint256 issuedBlock, uint256 seedBlock)",
    "event SessionGranted(address indexed user, uint256 expiry)",
];
// ── Provider / signer helpers ───────────────────────────────────────────────
function getProvider() {
    return new ethers_1.ethers.JsonRpcProvider(exports.RPC_URL);
}
function getSigner(privateKey) {
    const provider = getProvider();
    return new ethers_1.ethers.Wallet(privateKey, provider);
}
function getReadContracts(provider) {
    return {
        clawlia: new ethers_1.ethers.Contract(exports.ADDRESSES.ClawliaToken, exports.CLAWLIA_ABI, provider),
        registry: new ethers_1.ethers.Contract(exports.ADDRESSES.ModelRegistry, exports.MODEL_REGISTRY_ABI, provider),
        factory: new ethers_1.ethers.Contract(exports.ADDRESSES.MarketFactory, exports.MARKET_FACTORY_ABI, provider),
        captchaGate: new ethers_1.ethers.Contract(exports.ADDRESSES.CaptchaGate, exports.CAPTCHA_GATE_ABI, provider),
    };
}
function getWriteContracts(signer) {
    return {
        clawlia: new ethers_1.ethers.Contract(exports.ADDRESSES.ClawliaToken, exports.CLAWLIA_ABI, signer),
        registry: new ethers_1.ethers.Contract(exports.ADDRESSES.ModelRegistry, exports.MODEL_REGISTRY_ABI, signer),
        factory: new ethers_1.ethers.Contract(exports.ADDRESSES.MarketFactory, exports.MARKET_FACTORY_ABI, signer),
        captchaGate: new ethers_1.ethers.Contract(exports.ADDRESSES.CaptchaGate, exports.CAPTCHA_GATE_ABI, signer),
    };
}
function getPredictionMarket(address, signerOrProvider) {
    return new ethers_1.ethers.Contract(address, exports.PREDICTION_MARKET_ABI, signerOrProvider);
}
function decodeCaptchaProblem(packed) {
    const mask16 = BigInt(0xffff);
    const a = (packed >> BigInt(48)) & mask16;
    const b = (packed >> BigInt(32)) & mask16;
    const c = (packed >> BigInt(16)) & mask16;
    const p = packed & mask16;
    const answer = (a * b + c) % p;
    return { a, b, c, p, answer };
}
// ── Utility: ensure CLAW allowance ─────────────────────────────────────────
async function ensureAllowance(clawlia, owner, spender, amount) {
    const current = await clawlia.allowance(owner, spender);
    if (current >= amount)
        return null;
    const tx = await clawlia.approve(spender, amount);
    await tx.wait();
    return tx.hash;
}
//# sourceMappingURL=contracts.js.map