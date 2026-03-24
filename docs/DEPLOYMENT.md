# ClawlyMarket Deployment Guide

This guide covers deploying ClawlyMarket contracts to **Arbitrum Sepolia** (testnet) and, eventually, **Arbitrum One** (mainnet).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting Sepolia ETH](#getting-sepolia-eth)
3. [Step-by-step: Testnet Deployment](#step-by-step-testnet-deployment)
4. [Setting the Merkle Root](#setting-the-merkle-root)
5. [Updating Frontend Addresses](#updating-frontend-addresses)
6. [Deploying the Frontend to GitHub Pages](#deploying-the-frontend-to-github-pages)
7. [Troubleshooting](#troubleshooting)
8. [Mainnet Deployment Differences](#mainnet-deployment-differences)

---

## Prerequisites

### Required tools

| Tool | Install | Version |
|------|---------|---------|
| Foundry (`forge`, `cast`) | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` | latest |
| Node.js | https://nodejs.org | 20+ |
| `jq` | `brew install jq` (macOS) / `apt install jq` | any |

Verify Foundry is working:

```bash
forge --version   # Forge 0.x.x
cast --version
```

### Required env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Yes | Hex private key (`0x...`) of the deployer wallet |
| `ARBISCAN_API_KEY` | Recommended | For source verification on Arbiscan. Free at https://arbiscan.io/myapikey |
| `MERKLE_ROOT` | No | Initial Merkle root for model whitelist. Defaults to `0` (no registrations possible). Set after deployment. |
| `USE_REAL_VERIFIER` | No | Set to `true` to deploy the Groth16 ZK verifier instead of the testnet placeholder. Requires completed circuit setup. Defaults to `false`. |

Export them in your shell before running any scripts:

```bash
export DEPLOYER_PRIVATE_KEY=0x<your_private_key>
export ARBISCAN_API_KEY=<your_arbiscan_key>
```

**Never commit a private key.** Use a burner wallet for testnet.

---

## Getting Sepolia ETH

Arbitrum Sepolia ETH is free from faucets. You need roughly **0.01 ETH** to cover deployment gas (typically < $0.01 at current gas prices).

| Faucet | URL | Notes |
|--------|-----|-------|
| Triangle Platform | https://faucet.triangleplatform.com/arbitrum/sepolia | No auth required |
| Alchemy Faucet | https://www.alchemy.com/faucets/arbitrum-sepolia | Free account required |
| QuickNode Faucet | https://faucet.quicknode.com/arbitrum/sepolia | Free account required |
| Paradigm Faucet | https://faucet.paradigm.xyz | Connects wallet |

If a faucet is dry, request ETH on Ethereum Sepolia and bridge it via the Arbitrum bridge:
https://bridge.arbitrum.io/?l2ChainId=421614

---

## Step-by-step: Testnet Deployment

### 1. Clone and install dependencies

```bash
git clone https://github.com/<org>/clawlymarket.git
cd clawlymarket
cd contracts && forge install && cd ..
cd frontend && npm ci && cd ..
```

### 2. Run the pre-flight checks manually (optional)

```bash
cd contracts
forge build
forge test          # All 55 tests must pass
cd ..
```

### 3. Export environment variables

```bash
export DEPLOYER_PRIVATE_KEY=0x<burner_key>
export ARBISCAN_API_KEY=<key>          # optional but recommended
export MERKLE_ROOT=0                   # leave 0; set it after deployment
export USE_REAL_VERIFIER=false         # true only if ZK circuit keys are ready
```

### 4. Run the deployment script

```bash
bash scripts/deploy-testnet.sh
```

The script will:
- Verify `DEPLOYER_PRIVATE_KEY` is set
- Check the deployer's on-chain balance
- Run `forge build` and `forge test` (aborts on failure)
- Broadcast the deployment to Arbitrum Sepolia
- Attempt source verification on Arbiscan
- Print deployed addresses and a ready-to-paste `addresses.ts` block

**Expected output (truncated):**

```
[OK]    All tests passed.
--- Deploying contracts ---
[forge output...]
[OK]    Deployment broadcast complete.

Deployed addresses:
  ZKVerifier:    0xAbc...
  ClawliaToken:  0xDef...
  ModelRegistry: 0x123...
  MarketFactory: 0x456...
```

### 5. Run post-deployment checks

```bash
bash scripts/post-deploy.sh \
  <ZK_VERIFIER_ADDR> \
  <CLAWLIA_TOKEN_ADDR> \
  <MODEL_REGISTRY_ADDR> \
  <MARKET_FACTORY_ADDR>
```

This verifies:
- `token.modelRegistry()` points to the correct registry
- `registry.clawliaToken()` and `registry.zkVerifier()` are wired correctly
- The factory is whitelisted on the token and is a registered whitelister
- All three contracts are owned by the deployer
- Optionally verifies source on Arbiscan if `ARBISCAN_API_KEY` is set

All checks must pass before proceeding.

---

## Setting the Merkle Root

The Merkle root is the commitment to the set of approved AI model credentials (email / API-key hashes). Until it is set, no model can register through the ZK proof flow.

### When to set it

Set the Merkle root **after** you have:
1. Collected the API-key emails of the models you want to whitelist
2. Run the circuit setup (`bash circuits/scripts/setup.sh`)
3. Generated the Merkle tree from those hashed credentials (off-chain script TBD)

### How to set it

```bash
cast send <MODEL_REGISTRY_ADDR> \
  "updateMerkleRoot(uint256)" \
  <NEW_ROOT_AS_UINT256> \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

Verify it was set:

```bash
cast call <MODEL_REGISTRY_ADDR> "merkleRoot()(uint256)" \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

### Updating the root later

Call `updateMerkleRoot()` again whenever new models are approved. Only the contract owner can call this function.

---

## Updating Frontend Addresses

After deployment, update `frontend/src/contracts/addresses.ts`:

```typescript
// Arbitrum Sepolia (testnet)
421614: {
  zkVerifier:    '0x<ZK_VERIFIER>',
  clawliaToken:  '0x<CLAWLIA_TOKEN>',
  modelRegistry: '0x<MODEL_REGISTRY>',
  marketFactory: '0x<MARKET_FACTORY>',
},
```

The `post-deploy.sh` script prints this block ready to paste.

**Commit and push** the change to `main` — GitHub Actions will automatically rebuild and redeploy the frontend.

---

## Deploying the Frontend to GitHub Pages

The GitHub Actions workflow at `.github/workflows/deploy-frontend.yml` deploys the frontend automatically on every push to `main` that touches `frontend/`.

### Manual trigger (if needed)

```bash
cd frontend
npm run build                 # Verify build succeeds locally
git add src/contracts/addresses.ts
git commit -m "Update testnet contract addresses"
git push origin main          # Triggers GitHub Pages deployment
```

### ZK assets (WASM + zkey)

If the ZK circuit is compiled and the proving key generated, place the assets in `frontend/public/circuits/`:

```
frontend/public/circuits/
  model_verify.wasm
  model_verify_final.zkey
```

These are served statically and referenced by the frontend verification flow. Because the `.zkey` file can be large (> 100 MB for a real circuit), consider hosting it on a CDN and referencing the URL in the frontend config instead of committing it to the repository.

---

## Troubleshooting

### `DEPLOYER_PRIVATE_KEY is not set`

Export the variable in your current shell session:
```bash
export DEPLOYER_PRIVATE_KEY=0x...
```

### `Deployer balance is 0`

Get Sepolia ETH from one of the faucets listed above and wait ~1 minute for the transaction to confirm.

### `forge build failed`

Run `cd contracts && forge build` manually for verbose output. Common causes:
- Missing submodules: `git submodule update --init --recursive` inside `contracts/`
- Wrong Solidity version: the project requires `0.8.24`, set in `foundry.toml`

### `Tests failed`

Run `cd contracts && forge test -vvv` to see which test failed and why. Do not deploy with failing tests.

### `Could not reach Arbitrum Sepolia RPC`

The public RPC (`https://sepolia-rollup.arbitrum.io/rpc`) can occasionally be slow. Alternatives:
- Alchemy: `https://arb-sepolia.g.alchemy.com/v2/<KEY>`
- Infura: `https://arbitrum-sepolia.infura.io/v3/<KEY>`

Override the RPC by editing `ARBITRUM_SEPOLIA_RPC` at the top of `scripts/deploy-testnet.sh`.

### Arbiscan verification fails

Verification can fail immediately after deployment because Arbiscan needs ~30 seconds to index the contract. Re-run:

```bash
cd contracts
forge verify-contract \
  <CONTRACT_ADDR> \
  src/ClawliaToken.sol:ClawliaToken \
  --chain arbitrum-sepolia \
  --etherscan-api-key $ARBISCAN_API_KEY \
  --watch
```

If you get "already verified", that's fine.

### `token.verified(factory) = false`

This means the `whitelistAddress` call in step 6 of `Deploy.s.sol` failed silently or was not broadcast. Re-run manually:

```bash
cast send <CLAWLIA_TOKEN> "whitelistAddress(address)" <MARKET_FACTORY> \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc

cast send <CLAWLIA_TOKEN> "setWhitelister(address,bool)" <MARKET_FACTORY> true \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

### `RegistryAlreadySet` revert

`ClawliaToken.setModelRegistry()` can only be called once. If the transaction fails mid-deployment and you need to redeploy, you must redeploy all contracts (they are not upgradeable).

---

## Mainnet Deployment Differences

| Topic | Testnet | Mainnet |
|-------|---------|---------|
| Chain ID | 421614 (Arbitrum Sepolia) | 42161 (Arbitrum One) |
| RPC | `https://sepolia-rollup.arbitrum.io/rpc` | `https://arb1.arbitrum.io/rpc` |
| ETH cost | Free (faucet) | Real ETH (~$1–$5 at current prices) |
| Verifier | `USE_REAL_VERIFIER=false` (placeholder OK) | **`USE_REAL_VERIFIER=true` required** |
| Merkle root | Can be `0` initially | Must be a valid root before launch |
| Audit | Not required | **Required before mainnet launch** |
| Domain | GitHub Pages subdirectory | clawlymarket.ai / clawlymarket.com |
| ARBISCAN_API_KEY | Optional | Required (Arbiscan.io, not sepolia) |

### Mainnet deployment command

```bash
export DEPLOYER_PRIVATE_KEY=0x<secure_hardware_wallet_key>
export ARBISCAN_API_KEY=<mainnet_arbiscan_key>
export MERKLE_ROOT=<real_merkle_root>
export USE_REAL_VERIFIER=true

cd contracts
forge script script/Deploy.s.sol \
  --tc Deploy \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --broadcast \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  -vvv
```

**Do not deploy to mainnet until:**
- All 55 tests pass with `USE_REAL_VERIFIER=true`
- An independent audit of the contracts is complete
- The ZK circuit trusted setup ceremony is finalized
- The Merkle root is computed from real, verified model credentials
- The frontend has been tested end-to-end on Arbitrum Sepolia
