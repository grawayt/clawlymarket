import { ethers } from "ethers";
export declare const ADDRESSES: {
    readonly ClawliaToken: "0x8DD72e134641e0Ef04e8CD1aE97566F21E2f816a";
    readonly ModelRegistry: "0xECD445CAd04f6a1ac0f0C3eC0FD48140B4381586";
    readonly MarketFactory: "0xC1e8E62021DB22C416Ad41CE9472C1D3f07EAE02";
    readonly CaptchaGate: "0x30b619BAed6DcD055e28228cA7E113681AeCb6B3";
};
export declare const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
export declare const CLAWLIA_ABI: readonly ["function balanceOf(address account) external view returns (uint256)", "function verified(address) external view returns (bool)", "function approve(address spender, uint256 amount) external returns (bool)", "function allowance(address owner, address spender) external view returns (uint256)", "function decimals() external view returns (uint8)"];
export declare const MODEL_REGISTRY_ABI: readonly ["function isVerified(address model) external view returns (bool)", "function getRegisteredModelCount() external view returns (uint256)", "function getRegisteredModel(uint256 index) external view returns (address)", "function registered(address) external view returns (bool)", "function register(uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256 nullifier, uint256 pubkeyHash) external"];
export declare const MARKET_FACTORY_ABI: readonly ["function getMarkets() external view returns (address[])", "function getMarketCount() external view returns (uint256)", "function markets(uint256) external view returns (address)", "function createMarket(string calldata question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) external returns (address)", "event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)"];
export declare const PREDICTION_MARKET_ABI: readonly ["function question() external view returns (string)", "function resolutionTimestamp() external view returns (uint256)", "function resolver() external view returns (address)", "function resolved() external view returns (bool)", "function outcome() external view returns (uint256)", "function totalCollateral() external view returns (uint256)", "function reserveYes() external view returns (uint256)", "function reserveNo() external view returns (uint256)", "function accumulatedFees() external view returns (uint256)", "function getImpliedProbability() external view returns (uint256 yesProbBps, uint256 noProbBps)", "function balanceOf(address account, uint256 id) external view returns (uint256)", "function buy(uint256 outcomeIndex, uint256 collateralAmount, uint256 minTokensOut) external returns (uint256 tokensOut)", "function sell(uint256 outcomeIndex, uint256 tokenAmount, uint256 minCollateralOut) external returns (uint256 collateralOut)", "function addLiquidity(uint256 amount) external returns (uint256 yesTokens, uint256 noTokens)", "function removeLiquidity(uint256 yesAmount, uint256 noAmount) external returns (uint256 collateral)", "function redeem(uint256 amount) external", "function setApprovalForAll(address operator, bool approved) external"];
export declare const CAPTCHA_GATE_ABI: readonly ["function hasValidSession(address user) external view returns (bool)", "function sessionExpiry(address) external view returns (uint256)", "function requestChallenge() external", "function getChallenge(address user) external view returns (uint256[5] memory problems, uint256 deadline)", "function solveChallenge(uint256[5] calldata answers) external", "function challengeWindow() external view returns (uint256)", "event ChallengeIssued(address indexed user, uint256 issuedBlock, uint256 seedBlock)", "event SessionGranted(address indexed user, uint256 expiry)"];
export declare function getProvider(): ethers.JsonRpcProvider;
export declare function getSigner(privateKey: string): ethers.Wallet;
export declare function getReadContracts(provider: ethers.Provider): {
    clawlia: ethers.Contract;
    registry: ethers.Contract;
    factory: ethers.Contract;
    captchaGate: ethers.Contract;
};
export declare function getWriteContracts(signer: ethers.Wallet): {
    clawlia: ethers.Contract;
    registry: ethers.Contract;
    factory: ethers.Contract;
    captchaGate: ethers.Contract;
};
export declare function getPredictionMarket(address: string, signerOrProvider: ethers.Signer | ethers.Provider): ethers.Contract;
export interface CaptchaProblem {
    a: bigint;
    b: bigint;
    c: bigint;
    p: bigint;
    answer: bigint;
}
export declare function decodeCaptchaProblem(packed: bigint): CaptchaProblem;
export declare function ensureAllowance(clawlia: ethers.Contract, owner: string, spender: string, amount: bigint): Promise<string | null>;
//# sourceMappingURL=contracts.d.ts.map