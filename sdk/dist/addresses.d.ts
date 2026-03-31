/** Per-chain contract addresses. Update after each deployment. */
export interface ContractAddresses {
    clawliaToken: string;
    modelRegistry: string;
    marketFactory: string;
    zkVerifier: string;
    captchaGate: string;
}
export declare const ADDRESSES: Record<number, ContractAddresses>;
/** Returns addresses for the given chain, throwing if unknown. */
export declare function getAddresses(chainId: number): ContractAddresses;
//# sourceMappingURL=addresses.d.ts.map