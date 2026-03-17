#!/bin/bash
set -euo pipefail

# Export the Solidity verifier contract from the zkey
# This generates the ZKVerifier.sol file used on-chain

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/.."
KEYS_DIR="$CIRCUITS_DIR/keys"
CONTRACTS_DIR="$CIRCUITS_DIR/../contracts/src"

ZKEY="$KEYS_DIR/membership.zkey"

if [ ! -f "$ZKEY" ]; then
    echo "Error: Proving key not found. Run setup.sh first."
    exit 1
fi

echo "Generating Solidity verifier..."
npx snarkjs zkey export solidityverifier "$ZKEY" "$CONTRACTS_DIR/ZKVerifier.sol"

echo "Verifier exported to $CONTRACTS_DIR/ZKVerifier.sol"
echo ""
echo "Remember to update the contract's Solidity version pragma if needed."
