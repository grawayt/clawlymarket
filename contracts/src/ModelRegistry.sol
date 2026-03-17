// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title IGroth16Verifier — Interface for the auto-generated snarkjs verifier
interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[2] calldata _pubSignals
    ) external view returns (bool);
}

/// @title IClawliaToken — Minimal interface for registration
interface IClawliaToken {
    function registerAndMint(address model) external;
}

/// @title ModelRegistry — ZK-verified model registration for ClawlyMarket
/// @notice Models submit a Groth16 proof to register. The proof demonstrates
///         membership in a Merkle tree of approved email/API-key hashes
///         (verified via ZK Email DKIM in the circuit). A nullifier prevents
///         the same credential from registering twice.
contract ModelRegistry is Ownable {
    IClawliaToken public immutable clawliaToken;
    IGroth16Verifier public immutable zkVerifier;

    uint256 public merkleRoot;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(address => bool) public registered;

    error InvalidProof();
    error NullifierAlreadyUsed();
    error AlreadyRegistered();

    event ModelRegistered(address indexed model, uint256 nullifier);
    event MerkleRootUpdated(uint256 oldRoot, uint256 newRoot);

    constructor(
        address _clawliaToken,
        address _zkVerifier,
        uint256 _initialMerkleRoot,
        address _owner
    ) Ownable(_owner) {
        clawliaToken = IClawliaToken(_clawliaToken);
        zkVerifier = IGroth16Verifier(_zkVerifier);
        merkleRoot = _initialMerkleRoot;
    }

    /// @notice Update the Merkle root when new credentials are approved.
    function updateMerkleRoot(uint256 _newRoot) external onlyOwner {
        uint256 oldRoot = merkleRoot;
        merkleRoot = _newRoot;
        emit MerkleRootUpdated(oldRoot, _newRoot);
    }

    /// @notice Register a model by submitting a valid ZK proof.
    /// @param _pA Groth16 proof element A
    /// @param _pB Groth16 proof element B
    /// @param _pC Groth16 proof element C
    /// @param _nullifier The nullifier output from the circuit (Poseidon hash of the secret)
    function register(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _nullifier
    ) external {
        if (registered[msg.sender]) revert AlreadyRegistered();
        if (usedNullifiers[_nullifier]) revert NullifierAlreadyUsed();

        // Public signals: [root, nullifier]
        uint[2] memory pubSignals = [merkleRoot, _nullifier];

        if (!zkVerifier.verifyProof(_pA, _pB, _pC, pubSignals)) {
            revert InvalidProof();
        }

        usedNullifiers[_nullifier] = true;
        registered[msg.sender] = true;
        clawliaToken.registerAndMint(msg.sender);

        emit ModelRegistered(msg.sender, _nullifier);
    }

    /// @notice Check if an address is a registered model.
    function isVerified(address model) external view returns (bool) {
        return registered[model];
    }
}
