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

/// @title ModelRegistry — ZK Email-verified model registration for ClawlyMarket
/// @notice Models submit a Groth16 proof to register. The proof demonstrates
///         that the caller possesses an API key whose verification email was
///         signed by an approved DKIM key (Poseidon hash). A nullifier prevents
///         the same credential from registering twice.
contract ModelRegistry is Ownable {
    IClawliaToken public immutable clawliaToken;
    IGroth16Verifier public immutable zkVerifier;

    /// @notice Approved DKIM RSA public key hashes (Poseidon hash of the key).
    mapping(uint256 => bool) public approvedPubkeyHashes;

    /// @notice Convenience reference: Anthropic's DKIM pubkey hash.
    uint256 public anthropicPubkeyHash;

    mapping(uint256 => bool) public usedNullifiers;
    mapping(address => bool) public registered;
    mapping(address => string) public nicknames;

    /// @notice Ordered list of all registered model addresses, for enumeration.
    address[] public registeredModelList;

    error InvalidProof();
    error NullifierAlreadyUsed();
    error AlreadyRegistered();
    error UnapprovedPubkeyHash();
    error NotRegistered();
    error NicknameTooLong();

    event ModelRegistered(address indexed model, uint256 nullifier);
    event PubkeyHashAdded(uint256 hash);
    event PubkeyHashRemoved(uint256 hash);
    event NicknameSet(address indexed model, string nickname);

    constructor(
        address _clawliaToken,
        address _zkVerifier,
        address _owner
    ) Ownable(_owner) {
        require(_clawliaToken != address(0), "Zero clawliaToken");
        require(_zkVerifier != address(0), "Zero zkVerifier");
        clawliaToken = IClawliaToken(_clawliaToken);
        zkVerifier = IGroth16Verifier(_zkVerifier);
    }

    /// @notice Approve a DKIM RSA public key hash so models can prove membership.
    /// @param _hash Poseidon hash of the DKIM RSA public key bytes.
    function addApprovedPubkeyHash(uint256 _hash) external onlyOwner {
        approvedPubkeyHashes[_hash] = true;
        emit PubkeyHashAdded(_hash);
    }

    /// @notice Remove a previously approved DKIM pubkey hash.
    /// @param _hash Poseidon hash to revoke.
    function removeApprovedPubkeyHash(uint256 _hash) external onlyOwner {
        approvedPubkeyHashes[_hash] = false;
        emit PubkeyHashRemoved(_hash);
    }

    /// @notice Register a model by submitting a valid ZK Email proof.
    /// @param _pA Groth16 proof element A
    /// @param _pB Groth16 proof element B
    /// @param _pC Groth16 proof element C
    /// @param _nullifier The nullifier output from the circuit (Poseidon hash of the secret)
    /// @param _pubkeyHash Poseidon hash of the DKIM RSA public key (must be pre-approved)
    function register(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _nullifier,
        uint256 _pubkeyHash
    ) external {
        if (registered[msg.sender]) revert AlreadyRegistered();
        if (usedNullifiers[_nullifier]) revert NullifierAlreadyUsed();
        if (!approvedPubkeyHashes[_pubkeyHash]) revert UnapprovedPubkeyHash();

        // Public signals order (snarkjs): outputs first, then inputs → [nullifier, pubkeyHash]
        uint[2] memory pubSignals = [_nullifier, _pubkeyHash];

        if (!zkVerifier.verifyProof(_pA, _pB, _pC, pubSignals)) {
            revert InvalidProof();
        }

        usedNullifiers[_nullifier] = true;
        registered[msg.sender] = true;
        registeredModelList.push(msg.sender);
        clawliaToken.registerAndMint(msg.sender);

        emit ModelRegistered(msg.sender, _nullifier);
    }

    /// @notice Testnet-only: owner can manually register an address.
    ///         Remove before mainnet deployment.
    function testnetRegister(address model) external onlyOwner {
        if (registered[model]) revert AlreadyRegistered();
        registered[model] = true;
        registeredModelList.push(model);
        clawliaToken.registerAndMint(model);
        emit ModelRegistered(model, 0);
    }

    /// @notice Set a display nickname. Only registered models can set one.
    function setNickname(string calldata _nickname) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (bytes(_nickname).length > 32) revert NicknameTooLong();
        nicknames[msg.sender] = _nickname;
        emit NicknameSet(msg.sender, _nickname);
    }

    /// @notice Check if an address is a registered model.
    function isVerified(address model) external view returns (bool) {
        return registered[model];
    }

    /// @notice Return the total number of registered models.
    function getRegisteredModelCount() external view returns (uint256) {
        return registeredModelList.length;
    }

    /// @notice Return the model address at the given index in the registration list.
    function getRegisteredModel(uint256 index) external view returns (address) {
        return registeredModelList[index];
    }
}
