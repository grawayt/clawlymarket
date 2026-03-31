"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREDICTION_MARKET_ABI = exports.MARKET_FACTORY_ABI = exports.CAPTCHA_GATE_ABI = exports.MODEL_REGISTRY_ABI = exports.CLAWLIA_TOKEN_ABI = void 0;
exports.clawliaTokenContract = clawliaTokenContract;
exports.modelRegistryContract = modelRegistryContract;
exports.captchaGateContract = captchaGateContract;
exports.marketFactoryContract = marketFactoryContract;
exports.predictionMarketContract = predictionMarketContract;
const ethers_1 = require("ethers");
// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions / events the SDK actually calls
// ---------------------------------------------------------------------------
exports.CLAWLIA_TOKEN_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function verified(address) view returns (bool)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
];
exports.MODEL_REGISTRY_ABI = [
    'function isVerified(address model) view returns (bool)',
    'function registered(address) view returns (bool)',
    'function register(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 _nullifier, uint256 _pubkeyHash)',
];
exports.CAPTCHA_GATE_ABI = [
    'function requestChallenge()',
    'function getChallenge(address user) view returns (uint256[5] problems, uint256 deadline)',
    'function solveChallenge(uint256[5] answers)',
    'function hasValidSession(address user) view returns (bool)',
    'function sessionExpiry(address user) view returns (uint256)',
];
exports.MARKET_FACTORY_ABI = [
    'function getMarkets() view returns (address[])',
    'function getMarketCount() view returns (uint256)',
    'function createMarket(string question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) returns (address)',
    'event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)',
];
exports.PREDICTION_MARKET_ABI = [
    'function question() view returns (string)',
    'function resolutionTimestamp() view returns (uint256)',
    'function resolver() view returns (address)',
    'function resolved() view returns (bool)',
    'function outcome() view returns (uint256)',
    'function reserveYes() view returns (uint256)',
    'function reserveNo() view returns (uint256)',
    'function totalCollateral() view returns (uint256)',
    'function getImpliedProbability() view returns (uint256 yesProbBps, uint256 noProbBps)',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function YES() view returns (uint256)',
    'function NO() view returns (uint256)',
    'function buy(uint256 outcomeIndex, uint256 collateralAmount, uint256 minTokensOut) returns (uint256 tokensOut)',
    'function sell(uint256 outcomeIndex, uint256 tokenAmount, uint256 minCollateralOut) returns (uint256 collateralOut)',
    'event Trade(address indexed trader, uint256 outcomeIndex, bool isBuy, uint256 collateral, uint256 tokens)',
];
// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function clawliaTokenContract(address, runner) {
    return new ethers_1.Contract(address, exports.CLAWLIA_TOKEN_ABI, runner);
}
function modelRegistryContract(address, runner) {
    return new ethers_1.Contract(address, exports.MODEL_REGISTRY_ABI, runner);
}
function captchaGateContract(address, runner) {
    return new ethers_1.Contract(address, exports.CAPTCHA_GATE_ABI, runner);
}
function marketFactoryContract(address, runner) {
    return new ethers_1.Contract(address, exports.MARKET_FACTORY_ABI, runner);
}
function predictionMarketContract(address, runner) {
    return new ethers_1.Contract(address, exports.PREDICTION_MARKET_ABI, runner);
}
//# sourceMappingURL=contracts.js.map