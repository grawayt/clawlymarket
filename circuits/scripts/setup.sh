#!/bin/bash
set -euo pipefail

# Perform the trusted setup: Powers of Tau + Phase 2 ceremony
# This generates the proving key (zkey) and verification key

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/.."
BUILD_DIR="$CIRCUITS_DIR/build"
KEYS_DIR="$CIRCUITS_DIR/keys"

mkdir -p "$KEYS_DIR"

R1CS="$BUILD_DIR/api-key-email.r1cs"

if [ ! -f "$R1CS" ]; then
    echo "Error: R1CS file not found. Run compile.sh first."
    exit 1
fi

# Download Powers of Tau (from Hermez ceremony) if not already present
PTAU="$BUILD_DIR/powersOfTau28_hez_final_14.ptau"
if [ ! -f "$PTAU" ]; then
    echo "Downloading Powers of Tau file (phase 1 ceremony)..."
    curl -L -o "$PTAU" \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau"
fi

echo "Starting Phase 2 setup..."

# Phase 2: circuit-specific setup
npx snarkjs groth16 setup "$R1CS" "$PTAU" "$BUILD_DIR/membership_0000.zkey"

# Contribute entropy (non-interactive for reproducibility)
npx snarkjs zkey contribute \
    "$BUILD_DIR/membership_0000.zkey" \
    "$KEYS_DIR/membership.zkey" \
    --name="ClawlyMarket Phase 2" \
    -v -e="$(head -c 64 /dev/urandom | xxd -p)"

# Export verification key
npx snarkjs zkey export verificationkey \
    "$KEYS_DIR/membership.zkey" \
    "$KEYS_DIR/verification_key.json"

echo ""
echo "Setup complete."
echo "  Proving key:      $KEYS_DIR/membership.zkey"
echo "  Verification key: $KEYS_DIR/verification_key.json"
