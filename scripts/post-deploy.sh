#!/bin/bash
# ClawlyMarket Post-Deployment Checklist
# Verifies wiring, confirms contract roles, and prints the addresses.ts snippet.
#
# Usage:
#   export DEPLOYER_PRIVATE_KEY=0x...
#   bash scripts/post-deploy.sh \
#     <ZK_VERIFIER_ADDR> \
#     <CLAWLIA_TOKEN_ADDR> \
#     <MODEL_REGISTRY_ADDR> \
#     <MARKET_FACTORY_ADDR>

set -euo pipefail

ARBITRUM_SEPOLIA_RPC="https://sepolia-rollup.arbitrum.io/rpc"
ARBISCAN_BASE="https://sepolia.arbiscan.io/address"

# ────────────────────────────────────────────────────────────
# Colour helpers
# ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[CHECK]${NC} $*"; }
pass()    { echo -e "${GREEN}[PASS]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; CHECKS_FAILED=$((CHECKS_FAILED + 1)); }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

CHECKS_FAILED=0

# ────────────────────────────────────────────────────────────
# 1. Args
# ────────────────────────────────────────────────────────────
if [[ $# -ne 4 ]]; then
  die "Usage: $0 <ZK_VERIFIER> <CLAWLIA_TOKEN> <MODEL_REGISTRY> <MARKET_FACTORY>"
fi

ZK_VERIFIER="$1"
CLAWLIA_TOKEN="$2"
MODEL_REGISTRY="$3"
MARKET_FACTORY="$4"

echo -e "\n${BOLD}=== ClawlyMarket Post-Deployment Verification ===${NC}"
echo -e "Chain: Arbitrum Sepolia (421614)\n"
echo -e "  ZKVerifier:    ${ZK_VERIFIER}"
echo -e "  ClawliaToken:  ${CLAWLIA_TOKEN}"
echo -e "  ModelRegistry: ${MODEL_REGISTRY}"
echo -e "  MarketFactory: ${MARKET_FACTORY}\n"

# Convenience wrapper: cast call with --rpc-url pre-set
_call() {
  cast call "$@" --rpc-url "${ARBITRUM_SEPOLIA_RPC}" 2>/dev/null
}

# ────────────────────────────────────────────────────────────
# 2. Wiring checks
# ────────────────────────────────────────────────────────────
echo -e "${BOLD}--- Wiring checks ---${NC}\n"

# 2a. token.modelRegistry() == MODEL_REGISTRY
info "ClawliaToken.modelRegistry() == ModelRegistry"
ACTUAL_REGISTRY=$(_call "${CLAWLIA_TOKEN}" "modelRegistry()(address)")
if [[ "${ACTUAL_REGISTRY,,}" == "${MODEL_REGISTRY,,}" ]]; then
  pass "token.modelRegistry() = ${ACTUAL_REGISTRY}"
else
  fail "token.modelRegistry() = ${ACTUAL_REGISTRY}  (expected ${MODEL_REGISTRY})"
fi

# 2b. registry.clawliaToken() == CLAWLIA_TOKEN
info "ModelRegistry.clawliaToken() == ClawliaToken"
ACTUAL_TOKEN=$(_call "${MODEL_REGISTRY}" "clawliaToken()(address)")
if [[ "${ACTUAL_TOKEN,,}" == "${CLAWLIA_TOKEN,,}" ]]; then
  pass "registry.clawliaToken() = ${ACTUAL_TOKEN}"
else
  fail "registry.clawliaToken() = ${ACTUAL_TOKEN}  (expected ${CLAWLIA_TOKEN})"
fi

# 2c. registry.zkVerifier() == ZK_VERIFIER
info "ModelRegistry.zkVerifier() == ZKVerifier"
ACTUAL_VERIFIER=$(_call "${MODEL_REGISTRY}" "zkVerifier()(address)")
if [[ "${ACTUAL_VERIFIER,,}" == "${ZK_VERIFIER,,}" ]]; then
  pass "registry.zkVerifier() = ${ACTUAL_VERIFIER}"
else
  fail "registry.zkVerifier() = ${ACTUAL_VERIFIER}  (expected ${ZK_VERIFIER})"
fi

# 2d. factory.clawlia() == CLAWLIA_TOKEN
info "MarketFactory.clawlia() == ClawliaToken"
ACTUAL_FACTORY_TOKEN=$(_call "${MARKET_FACTORY}" "clawlia()(address)")
if [[ "${ACTUAL_FACTORY_TOKEN,,}" == "${CLAWLIA_TOKEN,,}" ]]; then
  pass "factory.clawlia() = ${ACTUAL_FACTORY_TOKEN}"
else
  fail "factory.clawlia() = ${ACTUAL_FACTORY_TOKEN}  (expected ${CLAWLIA_TOKEN})"
fi

# 2e. factory.registry() == MODEL_REGISTRY
info "MarketFactory.registry() == ModelRegistry"
ACTUAL_FACTORY_REGISTRY=$(_call "${MARKET_FACTORY}" "registry()(address)")
if [[ "${ACTUAL_FACTORY_REGISTRY,,}" == "${MODEL_REGISTRY,,}" ]]; then
  pass "factory.registry() = ${ACTUAL_FACTORY_REGISTRY}"
else
  fail "factory.registry() = ${ACTUAL_FACTORY_REGISTRY}  (expected ${MODEL_REGISTRY})"
fi

# 2f. token.verified(factory) == true
info "ClawliaToken.verified(MarketFactory) == true  (factory is whitelisted)"
FACTORY_VERIFIED=$(_call "${CLAWLIA_TOKEN}" "verified(address)(bool)" "${MARKET_FACTORY}")
if [[ "${FACTORY_VERIFIED}" == "true" ]]; then
  pass "token.verified(factory) = true"
else
  fail "token.verified(factory) = false  (factory not whitelisted — Deploy.s.sol step 6 may have failed)"
fi

# 2g. token.whitelisters(factory) == true
info "ClawliaToken.whitelisters(MarketFactory) == true  (factory can whitelist markets)"
FACTORY_IS_WHITELISTER=$(_call "${CLAWLIA_TOKEN}" "whitelisters(address)(bool)" "${MARKET_FACTORY}")
if [[ "${FACTORY_IS_WHITELISTER}" == "true" ]]; then
  pass "token.whitelisters(factory) = true"
else
  fail "token.whitelisters(factory) = false  (factory cannot whitelist new markets)"
fi

# 2h. Check Merkle root (warn if 0, not a hard failure)
info "ModelRegistry.merkleRoot() (warn if still 0)"
MERKLE_ROOT=$(_call "${MODEL_REGISTRY}" "merkleRoot()(uint256)")
if [[ "${MERKLE_ROOT}" == "0" ]]; then
  warn "merkleRoot = 0. No models can register yet. Set it with:"
  warn "  cast send ${MODEL_REGISTRY} \"updateMerkleRoot(uint256)\" <ROOT> \\"
  warn "    --private-key \$DEPLOYER_PRIVATE_KEY --rpc-url ${ARBITRUM_SEPOLIA_RPC}"
else
  pass "merkleRoot = ${MERKLE_ROOT}"
fi

# ────────────────────────────────────────────────────────────
# 3. Ownership checks
# ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}--- Ownership checks ---${NC}\n"

if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  EXPECTED_OWNER=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}" 2>/dev/null || true)
else
  EXPECTED_OWNER=""
  warn "DEPLOYER_PRIVATE_KEY not set — skipping owner address validation."
fi

for CONTRACT_NAME in "ClawliaToken" "ModelRegistry" "MarketFactory"; do
  case "${CONTRACT_NAME}" in
    "ClawliaToken")  ADDR="${CLAWLIA_TOKEN}" ;;
    "ModelRegistry") ADDR="${MODEL_REGISTRY}" ;;
    "MarketFactory") ADDR="${MARKET_FACTORY}" ;;
  esac

  info "${CONTRACT_NAME}.owner()"
  OWNER=$(_call "${ADDR}" "owner()(address)")
  if [[ -n "${EXPECTED_OWNER}" ]]; then
    if [[ "${OWNER,,}" == "${EXPECTED_OWNER,,}" ]]; then
      pass "${CONTRACT_NAME}.owner() = ${OWNER}"
    else
      fail "${CONTRACT_NAME}.owner() = ${OWNER}  (expected ${EXPECTED_OWNER})"
    fi
  else
    echo -e "       owner = ${OWNER}"
  fi
done

# ────────────────────────────────────────────────────────────
# 4. Contract verification status on Arbiscan
# ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}--- Arbiscan links ---${NC}\n"

echo -e "  ZKVerifier:    ${ARBISCAN_BASE}/${ZK_VERIFIER}#code"
echo -e "  ClawliaToken:  ${ARBISCAN_BASE}/${CLAWLIA_TOKEN}#code"
echo -e "  ModelRegistry: ${ARBISCAN_BASE}/${MODEL_REGISTRY}#code"
echo -e "  MarketFactory: ${ARBISCAN_BASE}/${MARKET_FACTORY}#code"

# Attempt forge verify-contract if ARBISCAN_API_KEY is set
if [[ -n "${ARBISCAN_API_KEY:-}" ]]; then
  echo ""
  echo -e "${BOLD}--- Verifying on Arbiscan (source) ---${NC}\n"
  CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"

  verify_one() {
    local name="$1" addr="$2" contract_path="$3"
    info "Verifying ${name}..."
    (cd "${CONTRACTS_DIR}" && \
      forge verify-contract \
        "${addr}" \
        "${contract_path}" \
        --chain arbitrum-sepolia \
        --etherscan-api-key "${ARBISCAN_API_KEY}" \
        --watch \
    ) && pass "${name} verified" || warn "${name} verification failed (may already be verified)"
  }

  verify_one "ZKVerifier"    "${ZK_VERIFIER}"    "src/ZKVerifier.sol:Groth16Verifier"
  verify_one "ClawliaToken"  "${CLAWLIA_TOKEN}"  "src/ClawliaToken.sol:ClawliaToken"
  verify_one "ModelRegistry" "${MODEL_REGISTRY}" "src/ModelRegistry.sol:ModelRegistry"
  verify_one "MarketFactory" "${MARKET_FACTORY}" "src/MarketFactory.sol:MarketFactory"
else
  warn "ARBISCAN_API_KEY not set — skipping source verification."
  warn "Get a free key at https://arbiscan.io/myapikey and re-run with it exported."
fi

# ────────────────────────────────────────────────────────────
# 5. addresses.ts snippet
# ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== Copy this into frontend/src/contracts/addresses.ts ===${NC}"
echo ""
cat <<SNIPPET
  // Arbitrum Sepolia (testnet)
  421614: {
    zkVerifier:    '${ZK_VERIFIER}',
    clawliaToken:  '${CLAWLIA_TOKEN}',
    modelRegistry: '${MODEL_REGISTRY}',
    marketFactory: '${MARKET_FACTORY}',
  },
SNIPPET

# ────────────────────────────────────────────────────────────
# 6. Summary
# ────────────────────────────────────────────────────────────
echo ""
if [[ "${CHECKS_FAILED}" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All checks passed. Deployment looks healthy.${NC}"
else
  echo -e "${RED}${BOLD}${CHECKS_FAILED} check(s) failed. Review the output above.${NC}"
  exit 1
fi
echo ""
