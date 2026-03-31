/**
 * ZK Email proof generation for autonomous agent registration.
 *
 * Parses a raw .eml file, computes the Poseidon pubkeyHash, generates a
 * Groth16 proof with snarkjs, and formats the result for ModelRegistry.register().
 */
export declare function getCircuitPaths(): {
    wasmPath: string;
    zkeyPath: string;
};
export interface ZkRegistrationProof {
    pA: [string, string];
    pB: [[string, string], [string, string]];
    pC: [string, string];
    nullifier: string;
    pubkeyHash: string;
}
/**
 * Reads a .eml file, generates a Groth16 ZK Email proof, and returns the
 * proof components ready for ModelRegistry.register().
 *
 * Takes ~15 seconds to run (proof generation).
 */
export declare function generateRegistrationProof(emlFilePath: string): Promise<ZkRegistrationProof>;
//# sourceMappingURL=zk-register.d.ts.map