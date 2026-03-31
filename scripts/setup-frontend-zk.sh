#!/usr/bin/env bash
# Copy ZK circuit files from circuits/build into frontend/public/zk/
# Run this once after cloning, or after rebuilding circuits.
#
# The WASM (~6MB) is small enough to serve from GitHub Pages.
# The zkey (~401MB) is too large — for production, host it on a CDN
# and set VITE_ZKEY_URL in your .env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
ZK_DIR="$ROOT/frontend/public/zk"

mkdir -p "$ZK_DIR"

# Light circuit WASM (browser-optimized, ~6MB)
WASM_SRC="$ROOT/circuits/build/zk-email-light/anthropic-email-light_js/anthropic-email-light.wasm"
if [ -f "$WASM_SRC" ]; then
  cp "$WASM_SRC" "$ZK_DIR/anthropic-email.wasm"
  echo "Copied anthropic-email.wasm ($(du -h "$ZK_DIR/anthropic-email.wasm" | cut -f1))"
else
  echo "WARNING: Light circuit WASM not found at $WASM_SRC"
  echo "  Run the circuit build first: cd circuits && ./scripts/compile.sh"
fi

# Light circuit zkey (~401MB — local dev only)
ZKEY_SRC="$ROOT/circuits/keys/anthropic-email-light.zkey"
if [ -f "$ZKEY_SRC" ]; then
  cp "$ZKEY_SRC" "$ZK_DIR/anthropic-email.zkey"
  echo "Copied anthropic-email.zkey ($(du -h "$ZK_DIR/anthropic-email.zkey" | cut -f1))"
  echo ""
  echo "NOTE: The zkey is ~401MB and too large for GitHub Pages (100MB limit)."
  echo "For production, upload it to a CDN and set VITE_ZKEY_URL in frontend/.env"
else
  echo "WARNING: Light circuit zkey not found at $ZKEY_SRC"
  echo "  For local dev, run the trusted setup: cd circuits && ./scripts/setup.sh"
  echo "  For production, set VITE_ZKEY_URL to a CDN-hosted copy."
fi
