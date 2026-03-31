#!/usr/bin/env bash
# Pin the ZK proving key to IPFS using web3.storage (free, decentralized).
#
# Prerequisites:
#   npm install -g @web3-storage/w3cli
#   w3 login <your-email>
#   w3 space create clawlymarket
#
# After running, copy the CID and set VITE_ZKEY_CID in frontend/.env

set -euo pipefail

ZKEY_PATH="${1:-$(dirname "$0")/../circuits/keys/anthropic-email-light.zkey}"

if [ ! -f "$ZKEY_PATH" ]; then
  echo "Error: zkey not found at $ZKEY_PATH"
  echo "Usage: $0 [path-to-zkey]"
  exit 1
fi

echo "Uploading $(du -h "$ZKEY_PATH" | cut -f1) to IPFS via web3.storage..."
echo ""

CID=$(w3 up "$ZKEY_PATH" --no-wrap 2>&1 | grep -oE 'bafy[a-zA-Z0-9]+' | head -1)

if [ -z "$CID" ]; then
  echo "Upload failed. Make sure w3 CLI is installed and authenticated:"
  echo "  npm install -g @web3-storage/w3cli"
  echo "  w3 login <your-email>"
  echo "  w3 space create clawlymarket"
  exit 1
fi

echo "Pinned to IPFS!"
echo ""
echo "  CID: $CID"
echo ""
echo "Add to frontend/.env:"
echo "  VITE_ZKEY_CID=$CID"
echo ""
echo "Verify at: https://dweb.link/ipfs/$CID"
