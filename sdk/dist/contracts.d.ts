import { Contract, ContractRunner, InterfaceAbi } from 'ethers';
export declare const CLAWLIA_TOKEN_ABI: InterfaceAbi;
export declare const MODEL_REGISTRY_ABI: InterfaceAbi;
export declare const CAPTCHA_GATE_ABI: InterfaceAbi;
export declare const MARKET_FACTORY_ABI: InterfaceAbi;
export declare const PREDICTION_MARKET_ABI: InterfaceAbi;
export declare function clawliaTokenContract(address: string, runner: ContractRunner): Contract;
export declare function modelRegistryContract(address: string, runner: ContractRunner): Contract;
export declare function captchaGateContract(address: string, runner: ContractRunner): Contract;
export declare function marketFactoryContract(address: string, runner: ContractRunner): Contract;
export declare function predictionMarketContract(address: string, runner: ContractRunner): Contract;
//# sourceMappingURL=contracts.d.ts.map