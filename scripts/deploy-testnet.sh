#!/bin/bash
# ClawlyMarket Arbitrum Sepolia Deployment
# Prerequisites: DEPLOYER_PRIVATE_KEY env var set, funded with Sepolia ETH
#
# Usage:
#   export DEPLOYER_PRIVATE_KEY=0x...
#   export MERKLE_ROOT=0  # optional, defaults to 0 (set after deployment)
#   export USE_REAL_VERIFIER=false  # optional, set true only with generated zkey
#   bash scripts/deploy-testnet.sh

set -euo pipefail

ARBITRUM_SEPOLIA_RPC="https://sepolia-rollup.arbitrum.io/rpc"
CHAIN_ID=421614

# ────────────────────────────────────────────────────────────
# Colour helpers
# ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ────────────────────────────────────────────────────────────
# 1. Check required env vars
# ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}=== ClawlyMarket — Arbitrum Sepolia Deployment ===${NC}\n"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  die "DEPLOYER_PRIVATE_KEY is not set. Export it before running this script."
fi

# Deploy.s.sol reads PRIVATE_KEY (not DEPLOYER_PRIVATE_KEY) — forward it.
export PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY}"

MERKLE_ROOT="${MERKLE_ROOT:-0}"
USE_REAL_VERIFIER="${USE_REAL_VERIFIER:-false}"

if [[ "$MERKLE_ROOT" == "0" ]]; then
  warn "MERKLE_ROOT not set (defaulting to 0). Run scripts/post-deploy.sh to set it after deployment."
fi

info "Target chain:      Arbitrum Sepolia (${CHAIN_ID})"
info "RPC:               ${ARBITRUM_SEPOLIA_RPC}"
info "Use real verifier: ${USE_REAL_VERIFIER}"
info "Initial Merkle root: ${MERKLE_ROOT}"

# Derive deployer address via cast
DEPLOYER_ADDR=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}" 2>/dev/null) || \
  die "Failed to derive deployer address — is DEPLOYER_PRIVATE_KEY a valid hex key?"
info "Deployer:          ${DEPLOYER_ADDR}"

# ────────────────────────────────────────────────────────────
# 2. Check deployer balance
# ────────────────────────────────────────────────────────────
echo ""
info "Checking deployer balance on Arbitrum Sepolia..."
BALANCE_WEI=$(cast balance "${DEPLOYER_ADDR}" --rpc-url "${ARBITRUM_SEPOLIA_RPC}" 2>/dev/null) || \
  die "Could not reach Arbitrum Sepolia RPC. Check your internet connection."
BALANCE_ETH=$(cast from-wei "${BALANCE_WEI}" 2>/dev/null || echo "unknown")
info "Balance: ${BALANCE_ETH} ETH"

if [[ "${BALANCE_WEI}" == "0" ]]; then
  error "Deployer balance is 0. Get Sepolia ETH from:"
  error "  https://faucet.triangleplatform.com/arbitrum/sepolia"
  error "  https://www.alchemy.com/faucets/arbitrum-sepolia"
  die "Insufficient funds."
fi

# ────────────────────────────────────────────────────────────
# 3. Pre-flight: build and test
# ────────────────────────────────────────────────────────────
CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"

echo ""
info "Running forge build..."
(cd "${CONTRACTS_DIR}" && forge build --quiet) || die "forge build failed. Fix compilation errors before deploying."
success "Build passed."

echo ""
info "Running forge test (all 55 tests must pass)..."
(cd "${CONTRACTS_DIR}" && forge test --quiet) || die "Tests failed. Fix all tests before deploying to testnet."
success "All tests passed."

# ────────────────────────────────────────────────────────────
# 4. Deploy
# ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}--- Deploying contracts ---${NC}"

BROADCAST_LOG="${CONTRACTS_DIR}/broadcast/Deploy.s.sol/${CHAIN_ID}/run-latest.json"

(cd "${CONTRACTS_DIR}" && \
  MERKLE_ROOT="${MERKLE_ROOT}" \
  USE_REAL_VERIFIER="${USE_REAL_VERIFIER}" \
  forge script script/Deploy.s.sol \
    --tc Deploy \
    --rpc-url "${ARBITRUM_SEPOLIA_RPC}" \
    --broadcast \
    --verify \
    --etherscan-api-key "${ARBISCAN_API_KEY:-verifyContract}" \
    -vvv \
) || die "Deployment failed. Check the output above for details."

echo ""
success "Deployment broadcast complete."

# ────────────────────────────────────────────────────────────
# 5. Parse deployed addresses from broadcast log
# ────────────────────────────────────────────────────────────
echo ""
info "Parsing deployed addresses from broadcast log..."

if [[ ! -f "${BROADCAST_LOG}" ]]; then
  warn "Broadcast log not found at ${BROADCAST_LOG}."
  warn "Inspect the forge output above for contract addresses."
else
  # Extract addresses in deployment order:
  # transaction[0] = ZKVerifier (or Placeholder)
  # transaction[1] = ClawliaToken
  # transaction[2] = ModelRegistry
  # transaction[3] = MarketFactory
  ZK_VERIFIER=$(jq -r '.transactions[0].contractAddress // empty' "${BROADCAST_LOG}" 2>/dev/null || true)
  CLAWLIA_TOKEN=$(jq -r '.transactions[1].contractAddress // empty' "${BROADCAST_LOG}" 2>/dev/null || true)
  MODEL_REGISTRY=$(jq -r '.transactions[2].contractAddress // empty' "${BROADCAST_LOG}" 2>/dev/null || true)
  MARKET_FACTORY=$(jq -r '.transactions[3].contractAddress // empty' "${BROADCAST_LOG}" 2>/dev/null || true)

  echo ""
  echo -e "${BOLD}Deployed addresses:${NC}"
  echo -e "  ZKVerifier:    ${CYAN}${ZK_VERIFIER:-<parse failed>}${NC}"
  echo -e "  ClawliaToken:  ${CYAN}${CLAWLIA_TOKEN:-<parse failed>}${NC}"
  echo -e "  ModelRegistry: ${CYAN}${MODEL_REGISTRY:-<parse failed>}${NC}"
  echo -e "  MarketFactory: ${CYAN}${MARKET_FACTORY:-<parse failed>}${NC}"

  echo ""
  echo -e "${BOLD}Copy this block into frontend/src/contracts/addresses.ts (chain 421614):${NC}"
  echo ""
  cat <<SNIPPET
  // Arbitrum Sepolia (testnet)
  421614: {
    zkVerifier:    '${ZK_VERIFIER:-0x0000000000000000000000000000000000000000}',
    clawliaToken:  '${CLAWLIA_TOKEN:-0x0000000000000000000000000000000000000000}',
    modelRegistry: '${MODEL_REGISTRY:-0x0000000000000000000000000000000000000000}',
    marketFactory: '${MARKET_FACTORY:-0x0000000000000000000000000000000000000000}',
  },
SNIPPET
fi

# ────────────────────────────────────────────────────────────
# 6. Next steps reminder
# ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== Next Steps ===${NC}"
echo ""
echo -e "  1. ${YELLOW}Update frontend/src/contracts/addresses.ts${NC} with the addresses above."
echo ""
echo -e "  2. ${YELLOW}Set the Merkle root${NC} once you have generated circuit keys:"
echo -e "     ${CYAN}cast send <MODEL_REGISTRY> \"updateMerkleRoot(uint256)\" <ROOT> \\"
echo -e "       --private-key \$DEPLOYER_PRIVATE_KEY --rpc-url ${ARBITRUM_SEPOLIA_RPC}${NC}"
echo ""
echo -e "  3. ${YELLOW}Run post-deploy checks${NC}:"
echo -e "     ${CYAN}bash scripts/post-deploy.sh <ZK_VERIFIER> <CLAWLIA_TOKEN> <MODEL_REGISTRY> <MARKET_FACTORY>${NC}"
echo ""
echo -e "  4. ${YELLOW}Rebuild and deploy the frontend${NC} (git push to main triggers GitHub Pages)."
echo ""
