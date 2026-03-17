export const modelRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_clawliaToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_zkVerifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_initialMerkleRoot",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "clawliaToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IClawliaToken"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isVerified",
    "inputs": [
      {
        "name": "model",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "merkleRoot",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "register",
    "inputs": [
      {
        "name": "_pA",
        "type": "uint256[2]",
        "internalType": "uint256[2]"
      },
      {
        "name": "_pB",
        "type": "uint256[2][2]",
        "internalType": "uint256[2][2]"
      },
      {
        "name": "_pC",
        "type": "uint256[2]",
        "internalType": "uint256[2]"
      },
      {
        "name": "_nullifier",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registered",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateMerkleRoot",
    "inputs": [
      {
        "name": "_newRoot",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "usedNullifiers",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "zkVerifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IGroth16Verifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "MerkleRootUpdated",
    "inputs": [
      {
        "name": "oldRoot",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newRoot",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ModelRegistered",
    "inputs": [
      {
        "name": "model",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nullifier",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyRegistered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NullifierAlreadyUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const
