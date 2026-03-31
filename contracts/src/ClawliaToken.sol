// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ClawliaToken — Restricted-transfer ERC-20 for ClawlyMarket
/// @notice Only verified models can send or receive CLAW. Verification and initial
///         minting are performed exclusively by the ModelRegistry contract.
contract ClawliaToken is ERC20, Ownable {
    uint256 public constant INITIAL_ALLOCATION = 1000e18;

    mapping(address => bool) public verified;
    address public modelRegistry;
    mapping(address => bool) public whitelisters; // addresses that can whitelist others

    error TransferNotAllowed(address from, address to);
    error OnlyRegistry();
    error RegistryAlreadySet();
    error NotWhitelister();

    event ModelVerified(address indexed model);
    event AddressWhitelisted(address indexed addr);
    event RegistrySet(address indexed registry);

    constructor(address _owner) ERC20("Clawlia", "CLAW") Ownable(_owner) {}

    /// @notice Set the ModelRegistry address. Can only be called once.
    function setModelRegistry(address _registry) external onlyOwner {
        if (modelRegistry != address(0)) revert RegistryAlreadySet();
        modelRegistry = _registry;
        emit RegistrySet(_registry);
    }

    /// @notice Grant an address the ability to whitelist other addresses.
    ///         Used for MarketFactory to whitelist newly created markets.
    function setWhitelister(address addr, bool enabled) external onlyOwner {
        whitelisters[addr] = enabled;
    }

    /// @notice Whitelist an infrastructure contract (factory, market, etc.)
    ///         so it can receive and send CLAW without being a verified model.
    ///         Does NOT mint tokens. Callable by owner or authorized whitelisters.
    function whitelistAddress(address addr) external {
        if (msg.sender != owner() && !whitelisters[msg.sender]) revert NotWhitelister();
        verified[addr] = true;
        emit AddressWhitelisted(addr);
    }

    /// @notice Called by ModelRegistry after successful ZK verification.
    ///         Marks the model as verified and mints the initial allocation.
    function registerAndMint(address model) external {
        if (msg.sender != modelRegistry) revert OnlyRegistry();
        verified[model] = true;
        _mint(model, INITIAL_ALLOCATION);
        emit ModelVerified(model);
    }

    /// @notice Testnet-only faucet. Owner can mint CLAW to any verified address.
    ///         Remove before mainnet deployment.
    function testnetMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @dev Overrides OZ v5 _update to enforce transfer restrictions.
    ///      Minting (from == address(0)) and burning (to == address(0)) are exempt.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!verified[from] || !verified[to]) {
                revert TransferNotAllowed(from, to);
            }
        }
        super._update(from, to, value);
    }
}
