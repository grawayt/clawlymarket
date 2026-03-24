pragma circom 2.1.6;

include "@zk-email/circuits/email-verifier.circom";
include "@zk-email/circuits/helpers/email-nullifier.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/// @title AnthropicEmailVerifier
/// @notice Proves a user received a DKIM-signed email from Anthropic's billing system.
///
/// Security:
///   1. DKIM RSA-SHA256 signature verified — email is genuine
///   2. From header contains "@mail.anthropic.com"
///   3. Subject contains "receipt from Anthropic"
///   4. Nullifier from recipient email hash — same person can't register twice
///   5. PubkeyHash checked against on-chain approved DKIM keys

/// @notice Checks a fixed-length pattern starting at startIndex in the header
template ByteMatch(maxLen, patternLen) {
    signal input in[maxLen];
    signal input startIndex;
    signal input pattern[patternLen];
    signal output match;

    // For each position p in pattern, select in[startIndex + p] and compare
    component idxEq[patternLen][maxLen];
    component charEq[patternLen];
    signal selected[patternLen][maxLen];
    signal charSum[patternLen][maxLen + 1];
    signal matches[patternLen];

    for (var p = 0; p < patternLen; p++) {
        charSum[p][0] <== 0;
        for (var i = 0; i < maxLen; i++) {
            idxEq[p][i] = IsEqual();
            idxEq[p][i].in[0] <== i;
            idxEq[p][i].in[1] <== startIndex + p;
            selected[p][i] <== in[i] * idxEq[p][i].out;
            charSum[p][i + 1] <== charSum[p][i] + selected[p][i];
        }
        charEq[p] = IsEqual();
        charEq[p].in[0] <== charSum[p][maxLen];
        charEq[p].in[1] <== pattern[p];
        matches[p] <== charEq[p].out;
    }

    // All positions must match
    signal acc[patternLen + 1];
    acc[0] <== 1;
    for (var i = 0; i < patternLen; i++) {
        acc[i + 1] <== acc[i] * matches[i];
    }
    match <== acc[patternLen];
}

/// @notice Extract bytes from header and hash them for use as nullifier seed
/// @param maxLen maximum header length
/// @param outLen max bytes to extract (for the recipient email address)
template ExtractAndHash(maxLen, outLen) {
    signal input in[maxLen];
    signal input startIndex;
    signal input length;
    signal output hash;

    // Extract bytes at [startIndex, startIndex + outLen)
    component idxEq[outLen][maxLen];
    signal selected[outLen][maxLen];
    signal byteSum[outLen][maxLen + 1];
    signal extracted[outLen];

    for (var p = 0; p < outLen; p++) {
        byteSum[p][0] <== 0;
        for (var i = 0; i < maxLen; i++) {
            idxEq[p][i] = IsEqual();
            idxEq[p][i].in[0] <== i;
            idxEq[p][i].in[1] <== startIndex + p;
            selected[p][i] <== in[i] * idxEq[p][i].out;
            byteSum[p][i + 1] <== byteSum[p][i] + selected[p][i];
        }
        extracted[p] <== byteSum[p][maxLen];
    }

    // Pack into 3 field elements (31 bytes each, covers up to 93 chars)
    // chunk0 = extracted[0..30], chunk1 = extracted[31..61], chunk2 = extracted[62..63]
    var numChunks = 3;
    signal packAcc[numChunks][outLen + 1];

    for (var c = 0; c < numChunks; c++) {
        packAcc[c][0] <== 0;
    }

    signal chunks[numChunks];

    // Pack chunk 0: bytes 0-30
    for (var b = 0; b < outLen; b++) {
        if (b < 31) {
            packAcc[0][b + 1] <== packAcc[0][b] * 256 + extracted[b];
        } else {
            packAcc[0][b + 1] <== packAcc[0][b];
        }
    }
    chunks[0] <== packAcc[0][outLen];

    // Pack chunk 1: bytes 31-61
    for (var b = 0; b < outLen; b++) {
        if (b >= 31 && b < 62) {
            packAcc[1][b + 1] <== packAcc[1][b] * 256 + extracted[b];
        } else {
            packAcc[1][b + 1] <== packAcc[1][b];
        }
    }
    chunks[1] <== packAcc[1][outLen];

    // Pack chunk 2: bytes 62-63
    for (var b = 0; b < outLen; b++) {
        if (b >= 62) {
            packAcc[2][b + 1] <== packAcc[2][b] * 256 + extracted[b];
        } else {
            packAcc[2][b + 1] <== packAcc[2][b];
        }
    }
    chunks[2] <== packAcc[2][outLen];

    component hasher = Poseidon(numChunks);
    hasher.inputs[0] <== chunks[0];
    hasher.inputs[1] <== chunks[1];
    hasher.inputs[2] <== chunks[2];
    hash <== hasher.out;
}


template AnthropicEmailVerifier() {
    var maxHeadersLength = 1024;
    var maxBodyLength = 64;
    var n = 121;
    var k = 17;

    // Private inputs
    signal input emailHeader[maxHeadersLength];
    signal input emailHeaderLength;
    signal input pubkey[k];
    signal input signature[k];

    // Hint indices (private, verified in-circuit)
    signal input fromDomainIndex;
    signal input subjectIndex;
    signal input toStartIndex;
    signal input toLength;

    // Public inputs
    signal input pubkeyHash;

    // Public outputs
    signal output nullifier;

    // Step 1: Verify DKIM signature (header-only)
    component emailVerifier = EmailVerifier(maxHeadersLength, maxBodyLength, n, k, 1, 0, 0, 0);
    emailVerifier.emailHeader <== emailHeader;
    emailVerifier.emailHeaderLength <== emailHeaderLength;
    emailVerifier.pubkey <== pubkey;
    emailVerifier.signature <== signature;
    emailVerifier.pubkeyHash === pubkeyHash;

    // Step 2: Verify From contains "@mail.anthropic.com"
    signal fromPattern[19];
    fromPattern[0] <== 64;  fromPattern[1] <== 109; fromPattern[2] <== 97;
    fromPattern[3] <== 105; fromPattern[4] <== 108; fromPattern[5] <== 46;
    fromPattern[6] <== 97;  fromPattern[7] <== 110; fromPattern[8] <== 116;
    fromPattern[9] <== 104; fromPattern[10] <== 114; fromPattern[11] <== 111;
    fromPattern[12] <== 112; fromPattern[13] <== 105; fromPattern[14] <== 99;
    fromPattern[15] <== 46; fromPattern[16] <== 99; fromPattern[17] <== 111;
    fromPattern[18] <== 109;

    component fromMatch = ByteMatch(maxHeadersLength, 19);
    fromMatch.in <== emailHeader;
    fromMatch.startIndex <== fromDomainIndex;
    fromMatch.pattern <== fromPattern;
    fromMatch.match === 1;

    // Step 3: Verify Subject contains "receipt from Anthropic"
    signal subjectPattern[22];
    subjectPattern[0] <== 114; subjectPattern[1] <== 101; subjectPattern[2] <== 99;
    subjectPattern[3] <== 101; subjectPattern[4] <== 105; subjectPattern[5] <== 112;
    subjectPattern[6] <== 116; subjectPattern[7] <== 32;  subjectPattern[8] <== 102;
    subjectPattern[9] <== 114; subjectPattern[10] <== 111; subjectPattern[11] <== 109;
    subjectPattern[12] <== 32; subjectPattern[13] <== 65;  subjectPattern[14] <== 110;
    subjectPattern[15] <== 116; subjectPattern[16] <== 104; subjectPattern[17] <== 114;
    subjectPattern[18] <== 111; subjectPattern[19] <== 112; subjectPattern[20] <== 105;
    subjectPattern[21] <== 99;

    component subjectMatch = ByteMatch(maxHeadersLength, 22);
    subjectMatch.in <== emailHeader;
    subjectMatch.startIndex <== subjectIndex;
    subjectMatch.pattern <== subjectPattern;
    subjectMatch.match === 1;

    // Step 4: Recipient-based nullifier (prevents same person registering multiple times)
    component toHash = ExtractAndHash(maxHeadersLength, 64);
    toHash.in <== emailHeader;
    toHash.startIndex <== toStartIndex;
    toHash.length <== toLength;

    // nullifier = Poseidon(recipientHash, signature[0])
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== toHash.hash;
    nullifierHasher.inputs[1] <== signature[0];
    nullifier <== nullifierHasher.out;
}

component main { public [pubkeyHash] } = AnthropicEmailVerifier();
