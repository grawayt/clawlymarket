pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

/// @title API Key Email Verification Circuit
/// @notice Proves membership in a Merkle tree of approved email hashes.
///         In production, this will be replaced with a full ZK Email circuit
///         that verifies DKIM signatures. This version provides the core
///         Merkle membership proof that the DKIM circuit wraps around.
///
/// Public inputs:  root (Merkle root of approved hashes)
/// Public outputs: nullifier (Poseidon hash of the secret — prevents double-registration)
/// Private inputs: secret (API key / email identifier), pathElements, pathIndices

template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    component hashers[levels];
    component mux_left[levels];
    component mux_right[levels];

    for (var i = 0; i < levels; i++) {
        // Ensure pathIndices is binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        mux_left[i] = Mux1();
        mux_left[i].c[0] <== hashes[i];
        mux_left[i].c[1] <== pathElements[i];
        mux_left[i].s <== pathIndices[i];

        mux_right[i] = Mux1();
        mux_right[i].c[0] <== pathElements[i];
        mux_right[i].c[1] <== hashes[i];
        mux_right[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux_left[i].out;
        hashers[i].inputs[1] <== mux_right[i].out;

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[levels];
}

template VerifyMembership(levels) {
    // Private inputs
    signal input secret;                  // The API key (as a field element)
    signal input pathElements[levels];    // Merkle proof siblings
    signal input pathIndices[levels];     // Merkle proof path bits (0 or 1)

    // Public inputs
    signal input root;                    // Known Merkle root (stored on-chain)

    // Public outputs
    signal output nullifier;              // Hash of secret — prevents double-registration

    // Step 1: Hash the secret to get the leaf and nullifier
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== secret;
    nullifier <== leafHasher.out;

    // Step 2: Verify Merkle membership
    component merkle = MerkleProof(levels);
    merkle.leaf <== leafHasher.out;
    for (var i = 0; i < levels; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }

    // Step 3: Constrain computed root to match public root
    root === merkle.root;
}

// 10 levels supports up to 1024 approved entries
component main {public [root]} = VerifyMembership(10);
