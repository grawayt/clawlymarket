# ZK Email Integration Plan for ClawlyMarket

## Status: Pre-implementation research — current circuit is a Merkle demo

---

## 1. How DKIM Verification Works

When a mail server sends an email, it signs specific headers (From, Subject, Date, To,
and the hash of the body) with its RSA private key and attaches the signature as the
`DKIM-Signature:` header. The recipient (or anyone) can verify this signature by fetching
the sender domain's public key from DNS (`TXT <selector>._domainkey.<domain>`).

**The signed payload ("dkim header hash") is:**

```
SHA-256(canonicalized headers including the body-hash field)
```

The body itself is hashed separately first:

```
bh = BASE64( SHA-256( canonicalized body ) )
```

That hash is embedded in the DKIM-Signature header, which is then included in the
header-hash above. So the RSA signature covers both the headers AND the body hash.

**Key properties that ZK Email exploits:**

- The email sender (e.g., Anthropic) controls their private key — we trust the
  DNS-published public key as the root of trust.
- An email recipient cannot forge a DKIM signature; only the sending mail server can
  sign it.
- The signature proves the full email headers and body were sent by that mail server.
- Nothing about the private content of the email needs to be revealed to prove the
  signature is valid.

---

## 2. How ZK Email Circuits Prove DKIM Signatures

ZK Email turns DKIM verification into an arithmetic circuit. At a high level, the
circuit proves three things in zero knowledge:

### 2a. RSA-SHA256 signature is valid (`EmailVerifier` from `@zk-email/circuits`)

The circuit takes as private inputs:
- `emailHeader[maxHeadersLength]` — the raw padded header bytes
- `emailBody[maxBodyLength]` — the raw padded body bytes (after SHA precompute)
- `signature[k]` — RSA signature split into k chunks of n bits
- `pubkey[k]` — RSA public key split into k chunks of n bits

It then proves:
1. `SHA-256(emailHeader)` matches what the RSA signature decrypts to
2. `SHA-256(emailBody)` matches the `bh=` field in the DKIM-Signature header
3. `RSA-verify(pubkey, signature, headerHash) == true`

The RSA operation uses the chunked representation (n=121 bits, k=17 chunks) to stay
within BN254 field element size. `RSAVerifier65537` is used because public exponent
65537 is universal for email DKIM.

### 2b. Regex constraints extract the relevant claim from the email (`zk-regex`)

The `@zk-email/zk-regex-circom` package compiles a regex pattern into a circom circuit
that matches against the masked email body or header bytes. This lets us assert, for
example, that the email body contains "Your Anthropic API key is" and extract the
substring that follows, all inside the ZK proof.

We do NOT need to extract the actual API key string — for ClawlyMarket, we only need to
prove the email came from the right domain (sender check) and contains the right subject
pattern. The key value itself stays private.

### 2c. Nullifier computation prevents double-registration

The `EmailNullifier` template computes:

```
nullifier = Poseidon(signature[0..k-1])
```

The RSA signature is unique per email (each email has a different timestamp, nonce, etc.),
so this nullifier is unique per email. The on-chain `ModelRegistry` stores used
nullifiers, preventing the same email from being used to register twice.

### 2d. Public key hash ties the proof to a specific sender domain

The circuit outputs `pubkeyHash = Poseidon(pubkey[0..k-1])`. On-chain, a
`DKIMRegistry` contract stores the approved pubkey hashes for each domain. The verifier
checks that the submitted pubkeyHash is registered for the expected sender domain
(e.g., `mail.anthropic.com`).

---

## 3. Which Email Provider to Target First

**Recommendation: Anthropic API key confirmation emails**

Rationale:
- ClawlyMarket is about AI model prediction markets — Anthropic is the home team
- Anthropic sends a transactional email when a new API key is created
  (visible in `console.anthropic.com` → API Keys → Create Key flow)
- The email comes from a single, stable domain; key email fields (From, Subject) are
  predictable and can be regex-constrained
- OpenAI is a viable backup/second target with the same approach

**What to confirm before implementation:**
1. Obtain a real "API key created" email from Anthropic (forward to yourself, view raw)
2. Confirm the `d=` selector in the DKIM-Signature header (e.g., `d=mail.anthropic.com`)
3. Look up the DKIM public key: `dig TXT <selector>._domainkey.anthropic.com`
4. Confirm the From address is stable (not rotated per campaign)
5. Confirm the Subject line is stable enough to regex-match

**OpenAI target (secondary):**
- Email domain: likely `@openai.com` or `@mail.openai.com`
- Same process applies — confirm selector via a real email header inspection

---

## 4. New Circuit Architecture

### File: `circuits/src/zk-email/api-key-email-v2.circom`

```
pragma circom 2.1.6;

include "@zk-email/circuits/email-verifier.circom";
include "@zk-email/circuits/utils/regex.circom";
include "@zk-email/circuits/helpers/nullifier.circom";
include "generated/api_key_from_regex.circom";   // compiled by zk-regex

// Parameters (tune after measuring actual email sizes):
//   maxHeadersLength: 1024   (must be multiple of 64)
//   maxBodyLength:    1536   (must be multiple of 64)
//   n: 121, k: 17            (RSA chunking, standard for 2048-bit keys)

template ApiKeyEmailVerifier(
    maxHeadersLength,
    maxBodyLength,
    n,
    k
) {
    // ---------- Private inputs ----------
    signal input emailHeader[maxHeadersLength];
    signal input emailHeaderLength;
    signal input emailBody[maxBodyLength];
    signal input emailBodyLength;
    signal input pubkey[k];
    signal input signature[k];

    // ---------- Public inputs ----------
    signal input pubkeyHash;          // must match on-chain DKIMRegistry entry
    signal input domainSelector;      // optional: constrain to a specific selector

    // ---------- Public outputs ----------
    signal output nullifier;          // Poseidon(signature) — unique per email

    // Step 1: Verify DKIM signature (RSA-SHA256 over headers + body hash)
    component verifier = EmailVerifier(maxHeadersLength, maxBodyLength, n, k, 0, 0, 0);
    verifier.emailHeader       <== emailHeader;
    verifier.emailHeaderLength <== emailHeaderLength;
    verifier.emailBody         <== emailBody;
    verifier.emailBodyLength   <== emailBodyLength;
    verifier.pubkey            <== pubkey;
    verifier.signature         <== signature;

    // Step 2: Constrain that computed pubkeyHash matches the public input
    //         (on-chain verifier checks this against the DKIMRegistry)
    verifier.pubkeyHash === pubkeyHash;

    // Step 3: Regex-constrain the From header to the expected sender domain
    //   Generated component: proves header contains "from:noreply@mail.anthropic.com"
    component fromRegex = FromAnthropicRegex(maxHeadersLength);
    fromRegex.in <== verifier.maskedHeader;
    fromRegex.out === 1;   // match must succeed

    // Step 4: Regex-constrain the Subject to prove it's an API-key email
    //   Generated component: proves body/header contains expected subject pattern
    component subjectRegex = ApiKeySubjectRegex(maxHeadersLength);
    subjectRegex.in <== verifier.maskedHeader;
    subjectRegex.out === 1;

    // Step 5: Compute nullifier from the RSA signature
    component emailNullifier = EmailNullifier();
    emailNullifier.signature <== signature;
    nullifier <== emailNullifier.out;
}

component main {public [pubkeyHash]} =
    ApiKeyEmailVerifier(1024, 1536, 121, 17);
```

### Public signals for on-chain verification (snarkjs order: outputs first, then inputs)

| Index | Signal       | Role                                              |
|-------|--------------|---------------------------------------------------|
| 0     | nullifier    | Poseidon(signature) — stored to prevent reuse     |
| 1     | pubkeyHash   | Poseidon(pubkey) — checked against DKIMRegistry   |

### Updated `ModelRegistry.register()` signature

```solidity
function register(
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC,
    uint256 _nullifier,
    uint256 _pubkeyHash        // NEW: replaces merkleRoot as second public signal
) external;
```

The contract removes the off-chain Merkle tree management entirely. The `merkleRoot`
storage variable and `updateMerkleRoot()` are replaced by a reference to the
`DKIMRegistry` contract (either the official ZK Email on-chain registry or an
owner-controlled local registry mapping `pubkeyHash` => `approved`).

---

## 5. Estimated Constraint Count and Proving Time

| Component                          | Approx. Constraints  |
|------------------------------------|----------------------|
| SHA-256 over header (1024 bytes)   | ~500 K               |
| SHA-256 over body (1536 bytes)     | ~750 K               |
| RSA-2048 verification (n=121,k=17) | ~400 K               |
| Regex: From domain check           | ~50–100 K            |
| Regex: Subject check               | ~50–100 K            |
| Nullifier (Poseidon)               | ~250 constraints     |
| **Total (estimated)**              | **~1.7–1.9 million** |

**Trusted setup:** This requires a Powers of Tau file for 2^21 (≈2 million) constraints.
Download: `powersOfTau28_hez_final_21.ptau` (~1 GB)

**Proving times (Groth16, snarkjs):**

| Environment              | Estimated Time   | Notes                              |
|--------------------------|------------------|------------------------------------|
| Server (Node.js, 16 GB+) | 60–120 seconds   | --max-old-space-size=16384 needed  |
| Server with GPU prover   | ~8 seconds       | Via rapidsnark or similar          |
| Browser (WASM)           | Not recommended  | Memory/time constraints too large  |

**Recommendation:** For v1, prove server-side (Node.js or a small backend endpoint).
The user runs the proving script locally via a CLI tool or small local server.
Browser proving is viable only with PLONK/UltraPlonk backends or Noir, which is a
future upgrade path.

---

## 6. Migration Path from Current Merkle Proof to ZK Email

### Phase 0 (current state)
- Circuit: Poseidon Merkle membership proof, 10 levels
- ~2,100 constraints total (very fast, < 1 s to prove)
- Off-chain: admin manages approved-hashes Merkle tree
- On-chain: `ModelRegistry` stores `merkleRoot`, verifies against it
- Weakness: admin can add any hash to the tree; no proof that the hash
  corresponds to a real email

### Phase 1 (ZK Email v1 — this plan)
- Circuit: `EmailVerifier` + From/Subject regex + nullifier
- ~1.8 M constraints, prove in 1–2 min server-side
- Off-chain: model proves directly from their own email, no admin involvement
- On-chain: `ModelRegistry` stores approved `pubkeyHash` values (one per
  domain, e.g. Anthropic); DKIMRegistry consulted or inlined
- Strength: cryptographically ties registration to a real DKIM-signed email
  from the API provider

### Phase 2 (future)
- Add Noir/UltraPlonk backend for browser proving
- Support multiple domains (OpenAI, Mistral, etc.) via a shared registry
- Consider using the official ZK Email SDK registry for automatic DKIM key rotation

### Contract migration checklist

- [ ] Deploy new `ZKVerifier.sol` generated from new zkey
- [ ] Deploy new `ModelRegistry` pointing to new verifier
- [ ] Existing registrations: grandfather in current registered addresses manually
      (owner calls `whitelist()` for already-registered models before migration)
- [ ] Old verifier contract can be decommissioned; old zkey archived

---

## 7. What Stays the Same

- **Nullifier system**: The `usedNullifiers` mapping in `ModelRegistry` is unchanged
  in concept — nullifier is now `Poseidon(signature)` instead of `Poseidon(secret)`,
  but the on-chain logic is identical.
- **ModelRegistry interface**: `register(pA, pB, pC, nullifier, ...)` stays the same
  shape; `isVerified(address)` is unchanged.
- **Frontend registration flow**: The UI still calls `register()` on `ModelRegistry`.
  The input generation step changes (from Merkle witness to email parsing), but the
  wallet interaction is identical.
- **ClawliaToken integration**: `registerAndMint()` is called identically; token
  economics unchanged.
- **PredictionMarket / MarketFactory**: Completely unaffected.
- **Groth16 proof format**: Still `(pA, pB, pC, pubSignals)` — the snarkjs Groth16
  verifier interface is the same.

---

## 8. What Changes

| Artifact                     | Current                         | ZK Email v1                          |
|------------------------------|---------------------------------|--------------------------------------|
| Circuit                      | `api-key-email.circom`          | `api-key-email-v2.circom`            |
| Circuit size                 | ~2 K constraints                | ~1.8 M constraints                   |
| Trusted setup ptau           | `final_14.ptau` (16 K pts)      | `final_21.ptau` (~2 M pts, ~1 GB)    |
| Proving key size             | ~200 KB                         | ~1–2 GB                              |
| Prove time                   | < 1 second                      | 1–2 minutes (Node.js)                |
| Public signals               | `[nullifier, merkleRoot]`       | `[nullifier, pubkeyHash]`            |
| Off-chain tree management    | Required (admin Merkle tree)    | Eliminated                           |
| Input generation script      | `prove.ts` (Poseidon leaf)      | `generate-inputs.ts` (email parsing) |
| ZKVerifier.sol               | Regenerated from new zkey       | Regenerated from new zkey            |
| ModelRegistry                | `merkleRoot` storage var        | `approvedPubkeys` mapping            |
| New npm dependencies         | None                            | `@zk-email/circuits`, `@zk-email/helpers`, `@zk-email/zk-regex-circom` |

---

## 9. Dependencies Needed

### circuits/package.json additions

```json
{
  "dependencies": {
    "@zk-email/circuits": "^6.3.4",
    "@zk-email/helpers": "^6.3.4",
    "@zk-email/zk-regex-circom": "^2.3.2"
  }
}
```

### System tools needed

- `circom` 2.1.6+ (already required)
- `node` with `--max-old-space-size=16384` for proving
- `wget` or `curl` to download the 21.ptau file (~1 GB)
- `zk-regex` CLI: `npx @zk-email/zk-regex-circom` — compiles regex JSON to circom

### New script additions

- `scripts/generate-inputs.ts` — parses a `.eml` file using `@zk-email/helpers`
  `generateEmailVerifierInputs()` to produce the JSON witness input
- `scripts/compile-regex.sh` — runs `zk-regex` on `regex/from-anthropic.json`
  and `regex/api-key-subject.json` to generate `generated/*.circom`
- `scripts/setup-v2.sh` — downloads the ptau-21 file and runs Phase 2 setup

---

## 10. Risks and Open Questions

### Technical risks

1. **DKIM key rotation**: Anthropic (or any provider) can rotate their DKIM signing
   key at any time. When they do, the on-chain `approvedPubkeys` entry must be updated
   by the admin. This is a temporary centralization risk. Mitigation: monitor the
   DKIM selector in the circuit to detect key changes.

2. **Email canonicalization edge cases**: DKIM uses `relaxed/relaxed` or
   `simple/simple` canonicalization. The ZK Email circuits implement relaxed/relaxed
   (the most common). If Anthropic uses `simple` canonicalization, soft-line-break
   handling may differ. Mitigation: inspect a real email header before implementation.

3. **Proving key distribution**: A ~1 GB proving key cannot be shipped in the npm
   package. It must be served from a CDN or generated by the registrant. Mitigation:
   host on IPFS / Cloudflare R2 and provide a download link in the CLI setup script.

4. **Memory requirements**: snarkjs with a 1.8 M constraint circuit requires ~8–16 GB
   RAM for proving. This is fine on a developer machine but rules out browser proving.
   Mitigation: provide a Node.js CLI prover; defer browser proving to Phase 2.

5. **Body hash precomputation**: For large email bodies, `@zk-email/helpers` supports
   partial SHA precomputation to keep `maxBodyLength` small. This requires carefully
   choosing the precompute cutoff around the relevant text. If the API key mention
   appears near the end of a long HTML email, precompute must reach that far.

### Open questions

1. What is Anthropic's actual DKIM selector and signing domain? (needs a real email)
2. Does the Anthropic API key email have a stable, regex-matchable subject line?
3. Is the API key creation email triggered by webhook/API or only by the console UI?
4. Does Anthropic sign the email body (not just headers)? Some senders omit `bh=`.
5. Should we use the ZK Email on-chain `DKIMRegistry` or maintain our own
   `approvedPubkeys` mapping? The official registry removes admin burden but adds
   an external contract dependency.
6. Should we support OpenAI registration on launch, or ship Anthropic-only first?
7. Are there privacy concerns with the model submitting their full email to a local
   prover? (The email is not sent anywhere — it stays local — but the UX needs to
   make this clear.)

---

## 11. Recommended First Steps

1. Sign up for an Anthropic API key, copy the raw `.eml` source of the confirmation
   email, and inspect:
   - The `DKIM-Signature` header (`d=`, `s=`, `a=`, `bh=`, `b=`)
   - The `From:` address
   - The `Subject:` line
   - Approximate body length

2. Run `dig TXT <selector>._domainkey.<d-value>` to retrieve the public key.

3. Install `@zk-email/helpers` and run `verifyDKIMSignature(rawEmail)` locally to
   confirm the signature is valid and the library can parse it.

4. Write the two regex JSON configs (`from-anthropic.json`, `api-key-subject.json`)
   and run `zk-regex` to generate the circom components.

5. Write `api-key-email-v2.circom` (see Section 4), compile, count constraints, and
   download the appropriate ptau file.

6. Run the full prove/verify pipeline on the sample email before touching the
   contracts.
