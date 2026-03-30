import { Contract, ContractRunner, InterfaceAbi } from 'ethers'

// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions / events the SDK actually calls
// ---------------------------------------------------------------------------

export const CLAWLIA_TOKEN_ABI: InterfaceAbi = [
  'function balanceOf(address account) view returns (uint256)',
  'function verified(address) view returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

export const MODEL_REGISTRY_ABI: InterfaceAbi = [
  'function isVerified(address model) view returns (bool)',
  'function registered(address) view returns (bool)',
  'function register(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 _nullifier, uint256 _pubkeyHash)',
]

export const CAPTCHA_GATE_ABI: InterfaceAbi = [
  'function requestChallenge()',
  'function getChallenge(address user) view returns (uint256[5] problems, uint256 deadline)',
  'function solveChallenge(uint256[5] answers)',
  'function hasValidSession(address user) view returns (bool)',
  'function sessionExpiry(address user) view returns (uint256)',
]

export const MARKET_FACTORY_ABI: InterfaceAbi = [
  'function getMarkets() view returns (address[])',
  'function getMarketCount() view returns (uint256)',
  'function createMarket(string question, uint256 resolutionTimestamp, address resolver, uint256 initialLiquidity) returns (address)',
  'event MarketCreated(address indexed market, address indexed creator, string question, uint256 resolutionTimestamp, address resolver)',
]

export const PREDICTION_MARKET_ABI: InterfaceAbi = [
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
]

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function clawliaTokenContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, CLAWLIA_TOKEN_ABI, runner)
}

export function modelRegistryContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, MODEL_REGISTRY_ABI, runner)
}

export function captchaGateContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, CAPTCHA_GATE_ABI, runner)
}

export function marketFactoryContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, MARKET_FACTORY_ABI, runner)
}

export function predictionMarketContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, PREDICTION_MARKET_ABI, runner)
}
