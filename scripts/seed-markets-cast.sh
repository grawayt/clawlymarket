#!/bin/bash
# seed-markets-cast.sh — Raw `cast send` commands for clawing through market creation
#
# This script outputs the raw cast commands needed to create each prediction market.
# Useful for manual execution or when ethers.ts tooling is unavailable.
#
# Prerequisites:
#   - DEPLOYER_PRIVATE_KEY env var set and funded with CLAW
#   - Deployer must be registered as a verified model
#   - Deployer must have a valid CaptchaGate session
#   - Cast CLI installed (forge/foundry)
#
# Usage:
#   bash scripts/seed-markets-cast.sh [--chain 421614] [--dry-run]
#
# Options:
#   --chain <id>     Chain ID (default: 421614 for Arbitrum Sepolia)
#   --local          Use Anvil local RPC
#   --dry-run        Print commands without executing them
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Defaults
# ─────────────────────────────────────────────────────────────────────────

CHAIN_ID=421614
RPC_URL="https://sepolia-rollup.arbitrum.io/rpc"
DRY_RUN=false
LOCAL=false

MARKET_FACTORY="0xbCf3a698B01537c39AB97214E5cDF38Bfec1598A"
CLAWLIA_TOKEN="0x8fe64d57a8AD52fd8eeA453990f1B6e010248335"

# Anvil defaults
ANVIL_FACTORY="0x0165878A594ca255338adfa4d48449f69242Eb8F"
ANVIL_CLAWLIA="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
ANVIL_RPC="http://127.0.0.1:8545"

# ─────────────────────────────────────────────────────────────────────────
# Colors
# ─────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# Parse args
# ─────────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chain)
      CHAIN_ID="$2"
      shift 2
      ;;
    --local)
      LOCAL=true
      CHAIN_ID=31337
      RPC_URL="${ANVIL_RPC}"
      MARKET_FACTORY="${ANVIL_FACTORY}"
      CLAWLIA_TOKEN="${ANVIL_CLAWLIA}"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────
# Check env
# ─────────────────────────────────────────────────────────────────────────

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  die "DEPLOYER_PRIVATE_KEY not set"
fi

DEPLOYER_ADDR=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}" 2>/dev/null) || \
  die "Failed to derive deployer address"

info "Target chain: $CHAIN_ID"
info "RPC: $RPC_URL"
info "Deployer: $DEPLOYER_ADDR"
info "MarketFactory: $MARKET_FACTORY"
info "ClawliaToken: $CLAWLIA_TOKEN"

# ─────────────────────────────────────────────────────────────────────────
# Market seeds (same as seed-markets.ts)
# ─────────────────────────────────────────────────────────────────────────

# Array of [question, days_until_resolution]
declare -a MARKETS=(
  "Will Claude Opus 5 be released before October 2026?|180"
  "Will an AI model score above 95% on ARC-AGI by end of 2026?|270"
  "Will OpenAI release GPT-5 before July 2026?|130"
  "Will open-source models match GPT-4o on MMLU by 2027?|365"
  "Will AI-generated code exceed 50% of new GitHub commits by 2028?|700"
  "Will Anthropic reach \$5B ARR by end of 2026?|275"
  "Will an AI agent autonomously complete a \$1M software contract by 2027?|640"
  "Will the EU AI Act enforcement lead to major model restrictions by 2027?|640"
  "Will Apple release an AI coding assistant by end of 2026?|275"
  "Will DeepMind solve a Millennium Prize Problem using AI by 2030?|1460"
)

NOW=$(date +%s)
INITIAL_LIQUIDITY="100000000000000000000" # 100 CLAW in wei

# ─────────────────────────────────────────────────────────────────────────
# Approval command (needed first)
# ─────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Approval Command ===${NC}"
echo ""
echo "First, approve MarketFactory to spend CLAW:"
echo ""

APPROVE_CMD="cast send ${CLAWLIA_TOKEN} \\"
APPROVE_CMD+=$'\n'"  \"approve(address,uint256)\" ${MARKET_FACTORY} \\"
APPROVE_CMD+=$'\n'"  1000000000000000000000 \\"  # 1000 CLAW (10 markets x 100 each)
APPROVE_CMD+=$'\n'"  --private-key \${DEPLOYER_PRIVATE_KEY} \\"
APPROVE_CMD+=$'\n'"  --rpc-url \"${RPC_URL}\""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "$APPROVE_CMD"
else
  echo "$APPROVE_CMD"
  info "Executing approval (requires 1 confirmation)..."
  # Actually execute it
  eval "${APPROVE_CMD}"
fi

# ─────────────────────────────────────────────────────────────────────────
# Market creation commands
# ─────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Market Creation Commands ===${NC}"
echo ""

i=1
for market_pair in "${MARKETS[@]}"; do
  IFS='|' read -r question days <<<"$market_pair"

  resolution_ts=$((NOW + days * 86400))

  echo -e "${CYAN}[${i}]${NC} $(echo "$question" | head -c 60)..."
  echo ""

  CMD="cast send ${MARKET_FACTORY} \\"
  CMD+=$'\n'"  \"createMarket(string,uint256,address,uint256)\" \\"
  CMD+=$'\n'"  \"${question}\" \\"
  CMD+=$'\n'"  \"${resolution_ts}\" \\"
  CMD+=$'\n'"  \"${DEPLOYER_ADDR}\" \\"
  CMD+=$'\n'"  \"${INITIAL_LIQUIDITY}\" \\"
  CMD+=$'\n'"  --private-key \${DEPLOYER_PRIVATE_KEY} \\"
  CMD+=$'\n'"  --rpc-url \"${RPC_URL}\""

  echo "$CMD"
  echo ""

  if [[ "$DRY_RUN" != "true" ]]; then
    info "Executing market ${i}..."
    eval "${CMD}" || warn "Failed to create market ${i}"
  fi

  ((i++))
done

# ─────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────

echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  success "Dry run complete. Commands above are ready to execute."
  echo ""
  echo "To execute all at once, run:"
  echo "  unset DRY_RUN"
  echo "  bash scripts/seed-markets-cast.sh --chain ${CHAIN_ID}"
else
  success "Clawing through market creation complete!"
fi
