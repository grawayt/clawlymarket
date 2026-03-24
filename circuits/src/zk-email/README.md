# ZK Email Circuit — Integration Scaffold

This directory will contain the ZK Email-based replacement for the current Merkle
membership proof circuit. See `circuits/ZK_EMAIL_PLAN.md` for the full design.

---

## Planned Directory Structure

```
circuits/
├── ZK_EMAIL_PLAN.md                    <- Full design document (exists)
├── package.json                        <- Add @zk-email/* deps (see below)
├── src/
│   ├── api-key-email.circom            <- Current demo circuit (Merkle proof)
│   └── zk-email/
│       ├── README.md                   <- This file
│       ├── api-key-email-v2.circom     <- New top-level circuit (to be written)
│       ├── regex/
│       │   ├── from-anthropic.json     <- zk-regex config: From header constraint
│       │   └── api-key-subject.json    <- zk-regex config: Subject line constraint
│       └── generated/
│           ├── from_anthropic_regex.circom     <- Output of: npx zk-regex compile
│           └── api_key_subject_regex.circom    <- Output of: npx zk-regex compile
├── scripts/
│   ├── compile.sh                      <- Current (compiles Merkle circuit)
│   ├── setup.sh                        <- Current (ptau-14, ~16K constraints)
│   ├── generate-verifier.sh            <- Current (exports ZKVerifier.sol)
│   ├── compile-v2.sh                   <- New: compile api-key-email-v2.circom
│   ├── compile-regex.sh                <- New: run zk-regex on both JSON configs
│   ├── setup-v2.sh                     <- New: download ptau-21, run Phase 2
│   └── generate-inputs.ts              <- New: parse .eml → circuit witness JSON
└── test/
    ├── e2e.test.ts                     <- Current: Merkle proof end-to-end
    └── zk-email-e2e.test.ts            <- New: ZK Email end-to-end (to be written)
```

---

## Package.json Additions

Add the following to `circuits/package.json` dependencies before starting:

```json
{
  "dependencies": {
    "@zk-email/circuits":      "^6.3.4",
    "@zk-email/helpers":       "^6.3.4",
    "@zk-email/zk-regex-circom": "^2.3.2"
  }
}
```

Install with:

```bash
cd circuits
npm install @zk-email/circuits @zk-email/helpers @zk-email/zk-regex-circom
```

The `@zk-email/circuits` package is a library of circom templates — it does NOT contain
a `main` component, only templates to `include` and instantiate. The include path in
your circom file must point to `node_modules/`:

```circom
include "../../node_modules/@zk-email/circuits/email-verifier.circom";
```

---

## Regex JSON Config Format (zk-regex)

`@zk-email/zk-regex-circom` compiles a regex pattern (written as a finite automaton
description in JSON) into a circom component that proves a match without revealing
which bytes matched.

### regex/from-anthropic.json (example shape)

```json
{
  "parts": [
    {
      "is_public": false,
      "regex_def": "\r\nfrom:([a-zA-Z0-9._%+\\-]+@anthropic\\.com)"
    }
  ]
}
```

- `is_public: false` — the matched substring is NOT revealed in the proof
- `is_public: true` — the matched bytes are exposed as a public output (use this
  if you want to display which domain was verified on the frontend)

Compile with:

```bash
npx @zk-email/zk-regex-circom generate \
  --decomposed  src/zk-email/regex/from-anthropic.json \
  --output      src/zk-email/generated/from_anthropic_regex.circom \
  --template-name FromAnthropicRegex
```

### regex/api-key-subject.json (example shape)

```json
{
  "parts": [
    {
      "is_public": false,
      "regex_def": "\r\nsubject:your anthropic api key"
    }
  ]
}
```

Note: Header bytes in EmailVerifier are lowercase-canonicalized. Confirm the exact
subject text from a real email before writing this regex.

---

## How to Obtain a Sample DKIM-Signed Email for Testing

You need a real raw `.eml` file to:
1. Confirm the DKIM selector and signing domain
2. Test the `@zk-email/helpers` parser
3. Generate a witness for circuit testing

### Step 1: Trigger a new API key creation email

Create a new API key at `console.anthropic.com` (or `platform.openai.com` for OpenAI).
The platform sends a transactional confirmation email.

### Step 2: View and copy the raw email source

**Gmail:**
1. Open the email
2. Click the three-dot menu (top right of the email) -> "Show original"
3. Click "Copy to clipboard" or "Download original"
4. Save as `test-emails/anthropic-api-key.eml`

**Apple Mail:**
1. Select the email
2. File -> Save As -> Format: Raw Message Source
3. Save as `test-emails/anthropic-api-key.eml`

**Any mail client:**
Look for "View Source", "Show Raw", or "Download .eml" in the message options.

### Step 3: Inspect the DKIM-Signature header

Open the .eml file and look for the `DKIM-Signature:` header. It will look like:

```
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
  d=mail.anthropic.com; s=selector1; t=1700000000;
  bh=<base64-body-hash>;
  h=from:to:subject:date:message-id:mime-version;
  b=<base64-signature>
```

Record:
- `d=` — the signing domain (e.g., `mail.anthropic.com`)
- `s=` — the selector (e.g., `selector1`)
- `a=` — must be `rsa-sha256` (zk-email does not yet support ed25519)
- `c=` — canonicalization; should be `relaxed/relaxed` (most common)

### Step 4: Look up the DKIM public key

```bash
dig TXT selector1._domainkey.mail.anthropic.com
```

The response contains `p=<base64-encoded-RSA-public-key>`. This is what gets hashed
by the circuit's `pubkeyHash` output and registered on-chain.

### Step 5: Verify the signature locally with @zk-email/helpers

```typescript
import { verifyDKIMSignature } from "@zk-email/helpers";
import * as fs from "fs";

const rawEmail = fs.readFileSync("test-emails/anthropic-api-key.eml");
const result = await verifyDKIMSignature(rawEmail);
console.log("DKIM valid:", result.valid);
console.log("Signing domain:", result.signingDomain);
console.log("Public key:", result.publicKey);
```

If `result.valid === true`, the email can be used as a circuit input.

### Step 6: Generate circuit inputs

```typescript
import { generateEmailVerifierInputs } from "@zk-email/helpers";
import * as fs from "fs";

const rawEmail = fs.readFileSync("test-emails/anthropic-api-key.eml");
const inputs = await generateEmailVerifierInputs(rawEmail, {
  maxHeadersLength: 1024,
  maxBodyLength:    1536,
});
fs.writeFileSync("build/email-inputs.json", JSON.stringify(inputs, null, 2));
```

This JSON file is passed directly as the witness input to snarkjs:

```bash
node build/api-key-email-v2_js/generate_witness.js \
  build/api-key-email-v2_js/api-key-email-v2.wasm \
  build/email-inputs.json \
  build/witness.wtns
```

---

## On-Chain DKIM Registry Options

The circuit outputs `pubkeyHash = Poseidon(pubkey)`. On-chain, the `ModelRegistry`
must check that this hash corresponds to an approved sender domain. Two approaches:

### Option A: Owner-controlled mapping (simplest, recommended for v1)

Add to `ModelRegistry.sol`:

```solidity
mapping(uint256 => bool) public approvedPubkeyHashes;

function approvePubkeyHash(uint256 hash) external onlyOwner {
    approvedPubkeyHashes[hash] = true;
}
```

The register function checks:
```solidity
if (!approvedPubkeyHashes[_pubkeyHash]) revert UnapprovedSender();
```

The owner pre-approves the Anthropic DKIM pubkey hash once. If Anthropic rotates
their key, the owner updates the mapping.

### Option B: Use the ZK Email official DKIMRegistry (more trustless)

ZK Email maintains an on-chain registry at (as of 2025):
- Ethereum mainnet: check `https://docs.zk.email/architecture/on-chain` for address
- The registry maps `domainName => pubkeyHash`
- Anyone can submit a new key with DNSSEC proof (where available)

This option adds an external contract dependency but removes the need for the
ClawlyMarket admin to manage key rotations manually.

---

## Notes on the Proving Key

The Phase 2 proving key (`.zkey`) for a ~1.8 M constraint circuit will be
approximately 1–2 GB. It cannot be stored in the git repo or npm package.

Plan for distribution:
- Store on IPFS or Cloudflare R2 with a public URL
- `setup-v2.sh` should download it on first run (like the ptau download pattern
  in the existing `setup.sh`)
- The verification key (`verification_key.json`) is small (~2 KB) and can be
  committed to the repo

The ptau file required is `powersOfTau28_hez_final_21.ptau` (~1 GB).
Download URL: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_21.ptau`
