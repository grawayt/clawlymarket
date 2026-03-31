"use strict";
/**
 * ZK Email proof generation for autonomous agent registration.
 *
 * Parses a raw .eml file, computes the Poseidon pubkeyHash, generates a
 * Groth16 proof with snarkjs, and formats the result for ModelRegistry.register().
 */
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCircuitPaths = getCircuitPaths;
exports.generateRegistrationProof = generateRegistrationProof;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// CommonJS require for packages that don't have clean ESM types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateEmailVerifierInputs } = require("@zk-email/helpers/dist/input-generators");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPoseidon } = require("circomlibjs");
// ---------------------------------------------------------------------------
// Configurable paths (override with env vars)
// ---------------------------------------------------------------------------
function getCircuitPaths() {
    const projectRoot = path.resolve(__dirname, "../../../");
    const wasmPath = process.env.CIRCUIT_WASM_PATH ??
        path.join(projectRoot, "circuits/build/zk-email-light/anthropic-email-light_js/anthropic-email-light.wasm");
    const zkeyPath = process.env.CIRCUIT_ZKEY_PATH ??
        path.join(projectRoot, "circuits/keys/anthropic-email-light.zkey");
    return { wasmPath, zkeyPath };
}
// ---------------------------------------------------------------------------
// Main proof generation
// ---------------------------------------------------------------------------
/**
 * Reads a .eml file, generates a Groth16 ZK Email proof, and returns the
 * proof components ready for ModelRegistry.register().
 *
 * Takes ~15 seconds to run (proof generation).
 */
async function generateRegistrationProof(emlFilePath) {
    const { wasmPath, zkeyPath } = getCircuitPaths();
    // Verify circuit files exist before starting (saves time on bad config)
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`Circuit WASM not found at: ${wasmPath}\n` +
            "Set CIRCUIT_WASM_PATH env var or ensure circuits are built.");
    }
    if (!fs.existsSync(zkeyPath)) {
        throw new Error(`Circuit zkey not found at: ${zkeyPath}\n` +
            "Set CIRCUIT_ZKEY_PATH env var or ensure circuits are set up.");
    }
    // Read the email file
    const emlBytes = fs.readFileSync(emlFilePath);
    // Parse email into circuit inputs using @zk-email/helpers
    const inputs = await generateEmailVerifierInputs(emlBytes, {
        maxHeadersLength: 1024,
        maxBodyLength: 64,
        ignoreBodyHashCheck: true,
    });
    // Compute pubkeyHash: pack RSA pubkey chunks (17 limbs × 2 per group → 9 packed values)
    // then Poseidon-hash the packed array.
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const pubkey = inputs.pubkey;
    const packed = [];
    for (let i = 0; i < 17; i += 2) {
        packed.push(BigInt(pubkey[i] ?? "0") + (BigInt(pubkey[i + 1] ?? "0") << 121n));
    }
    const pubkeyHashField = poseidon(packed.map((x) => F.e(x)));
    inputs.pubkeyHash = F.toObject(pubkeyHashField).toString();
    // Generate Groth16 proof (~15 seconds)
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);
    // Format for Solidity (exportSolidityCallData handles the pi_b coordinate swap)
    const rawCalldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    // Parse: [pA, pB, pC, pubSignals]
    const parsed = JSON.parse(`[${rawCalldata}]`);
    const [pA, pB, pC, pubSignals] = parsed;
    // Public signals order: outputs first → [nullifier, pubkeyHash]
    const nullifier = pubSignals[0];
    const pubkeyHashOut = pubSignals[1];
    return { pA, pB, pC, nullifier, pubkeyHash: pubkeyHashOut };
}
//# sourceMappingURL=zk-register.js.map