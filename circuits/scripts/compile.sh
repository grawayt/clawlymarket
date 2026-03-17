#!/bin/bash
set -euo pipefail

# Compile the circom circuit to R1CS, WASM, and sym files
# Requires: circom installed (https://docs.circom.io/getting-started/installation/)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/.."
BUILD_DIR="$CIRCUITS_DIR/build"

mkdir -p "$BUILD_DIR"

echo "Compiling api-key-email circuit..."
circom "$CIRCUITS_DIR/src/api-key-email.circom" \
    --r1cs \
    --wasm \
    --sym \
    -o "$BUILD_DIR" \
    -l "$CIRCUITS_DIR/node_modules"

echo "Circuit compiled successfully."
echo "  R1CS:  $BUILD_DIR/api-key-email.r1cs"
echo "  WASM:  $BUILD_DIR/api-key-email_js/api-key-email.wasm"
echo "  SYM:   $BUILD_DIR/api-key-email.sym"

# Print circuit info
echo ""
echo "Circuit info:"
npx snarkjs r1cs info "$BUILD_DIR/api-key-email.r1cs"
