import { ethers } from "ethers";

// ── Deployed addresses on Arbitrum Sepolia ──────────────────────────────────

export const ADDRESSES = {
  ClawliaToken: "0xDbca0D2943041A86363e01dA6E2FEC2BC70D58a7",
  ModelRegistry: "0x68F4919eF05cA7f705ad0666690c8c80c82aae7F",
  MarketFactory: "0xB6E248945F7fDF1eDa9B8e98958428a170Fdb6E0",
  CaptchaGate: "0x2c90c7f8D8bcFfA1780a4eB674657582c0AD5E96",
} as const;

export const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";

// ── Minimal ABIs (only the functions we actually call) ──────────────────────

export const CLAWLIA_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function verified(address) external view returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
] as const;

export const MODEL_REGISTRY_ABI = [
  "function isVerified(address model) external view returns (bool)",
  "function getRegisteredModelCount() external view returns (uint256)",
  "function getRegisteredModel(uint256 index) external view returns (address)",
  "function registered(address) external view returns (bool)",
  "function register(uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256 nullifier, uint256 pubkeyHash) external",
  "function nicknames(address) external view returns (string)",
  "function setNickname(string calldata _nickname) external",
] as const;

export const MARKET_FACTORY_ABI = [
  "function getMarkets() external view returns (address[])",
  "function getMarketCount() external view returns (uint256)",
  "function markets(uint256) external view returns (address)",
  "function createMarket(string calldata question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) external returns (address)",
  "event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)",
] as const;

export const PREDICTION_MARKET_ABI = [
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
] as const;

export const CAPTCHA_GATE_ABI = [
  "function hasValidSession(address user) external view returns (bool)",
  "function sessionExpiry(address) external view returns (uint256)",
  "function requestChallenge() external",
  "function getChallenge(address user) external view returns (uint256[5] memory problems, uint256 deadline)",
  "function solveChallenge(uint256[5] calldata answers) external",
  "function challengeWindow() external view returns (uint256)",
  "event ChallengeIssued(address indexed user, uint256 issuedBlock, uint256 seedBlock)",
  "event SessionGranted(address indexed user, uint256 expiry)",
] as const;

// ── Provider / signer helpers ───────────────────────────────────────────────

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RPC_URL);
}

export function getSigner(privateKey: string): ethers.Wallet {
  const provider = getProvider();
  return new ethers.Wallet(privateKey, provider);
}

export function getReadContracts(provider: ethers.Provider) {
  return {
    clawlia: new ethers.Contract(ADDRESSES.ClawliaToken, CLAWLIA_ABI, provider),
    registry: new ethers.Contract(ADDRESSES.ModelRegistry, MODEL_REGISTRY_ABI, provider),
    factory: new ethers.Contract(ADDRESSES.MarketFactory, MARKET_FACTORY_ABI, provider),
    captchaGate: new ethers.Contract(ADDRESSES.CaptchaGate, CAPTCHA_GATE_ABI, provider),
  };
}

export function getWriteContracts(signer: ethers.Wallet) {
  return {
    clawlia: new ethers.Contract(ADDRESSES.ClawliaToken, CLAWLIA_ABI, signer),
    registry: new ethers.Contract(ADDRESSES.ModelRegistry, MODEL_REGISTRY_ABI, signer),
    factory: new ethers.Contract(ADDRESSES.MarketFactory, MARKET_FACTORY_ABI, signer),
    captchaGate: new ethers.Contract(ADDRESSES.CaptchaGate, CAPTCHA_GATE_ABI, signer),
  };
}

export function getPredictionMarket(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, PREDICTION_MARKET_ABI, signerOrProvider);
}

// ── Decode CAPTCHA problem from packed uint256 ──────────────────────────────
// Contract packing: (a << 48) | (b << 32) | (c << 16) | p

export interface CaptchaProblem {
  a: bigint;
  b: bigint;
  c: bigint;
  p: bigint;
  answer: bigint; // (a * b + c) % p
}

export function decodeCaptchaProblem(packed: bigint): CaptchaProblem {
  const mask16 = BigInt(0xffff);
  const a = (packed >> BigInt(48)) & mask16;
  const b = (packed >> BigInt(32)) & mask16;
  const c = (packed >> BigInt(16)) & mask16;
  const p = packed & mask16;
  const answer = (a * b + c) % p;
  return { a, b, c, p, answer };
}

// ── Utility: ensure CLAW allowance ─────────────────────────────────────────

export async function ensureAllowance(
  clawlia: ethers.Contract,
  owner: string,
  spender: string,
  amount: bigint,
): Promise<string | null> {
  const current: bigint = await clawlia.allowance(owner, spender);
  if (current >= amount) return null;
  const tx = await clawlia.approve(spender, amount);
  await tx.wait();
  return tx.hash as string;
}
