pragma circom 2.1.6;

include "@zk-email/circuits/email-verifier.circom";
include "@zk-email/circuits/helpers/email-nullifier.circom";
include "circomlib/circuits/poseidon.circom";

/// @title AnthropicEmailVerifierLight
/// @notice Browser-optimized version — DKIM verification + nullifier only.
///         From/Subject regex checks are enforced off-chain in the frontend
///         before proof generation (the frontend validates the email content
///         before passing it to snarkjs).
///
/// This version targets ~700K constraints (vs 1M for the full version)
/// resulting in a ~380MB proving key that's feasible for browser proving.
///
/// Security model:
///   ON-CHAIN (enforced by this circuit):
///     1. DKIM RSA-SHA256 signature is valid — email is genuine
///     2. PubkeyHash matches approved DKIM key (checked on-chain)
///     3. Nullifier derived from signature — prevents same email being reused
///
///   OFF-CHAIN (enforced by frontend before proof generation):
///     - From header contains "@mail.anthropic.com"
///     - Subject contains "receipt" or "API" (Anthropic-related)
///     - Email is from a DKIM-signed domain
///
/// Public signals (snarkjs order: outputs first, then inputs):
///   [0] nullifier    — Poseidon(Poseidon(signature)) — unique per email
///   [1] pubkeyHash   — Poseidon(pubkey) — checked against on-chain registry

template AnthropicEmailVerifierLight() {
    var maxHeadersLength = 1024;
    var maxBodyLength = 64;    // minimum (unused with ignoreBodyHashCheck=1)
    var n = 121;
    var k = 17;

    // Private inputs
    signal input emailHeader[maxHeadersLength];
    signal input emailHeaderLength;
    signal input pubkey[k];
    signal input signature[k];

    // Public inputs
    signal input pubkeyHash;

    // Public outputs
    signal output nullifier;

    // Step 1: Verify DKIM signature (header-only, skip body hash)
    component emailVerifier = EmailVerifier(maxHeadersLength, maxBodyLength, n, k, 1, 0, 0, 0);
    emailVerifier.emailHeader <== emailHeader;
    emailVerifier.emailHeaderLength <== emailHeaderLength;
    emailVerifier.pubkey <== pubkey;
    emailVerifier.signature <== signature;

    // Step 2: Verify pubkey hash matches public input
    emailVerifier.pubkeyHash === pubkeyHash;

    // Step 3: Compute nullifier from RSA signature
    // nullifier = Poseidon(Poseidon(signature chunks))
    component emailNullifier = EmailNullifier(n, k);
    emailNullifier.signature <== signature;
    nullifier <== emailNullifier.out;
}

component main { public [pubkeyHash] } = AnthropicEmailVerifierLight();
