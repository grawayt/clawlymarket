// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PredictionMarket} from "./PredictionMarket.sol";

/// @title IModelRegistry — Minimal interface for verification check
interface IModelRegistry {
    function isVerified(address model) external view returns (bool);
}

/// @title IClawliaTokenWhitelist — Interface for whitelisting
interface IClawliaTokenWhitelist {
    function whitelistAddress(address addr) external;
}

/// @title MarketFactory — Deploys and indexes PredictionMarket instances
/// @notice Only verified models can create markets. The factory serves as
///         the on-chain index of all markets (no database needed).
contract MarketFactory is Ownable {
    IERC20 public immutable clawlia;
    IClawliaTokenWhitelist public immutable clawliaWhitelist;
    IModelRegistry public immutable registry;

    uint256 public constant MIN_LIQUIDITY = 10e18; // Minimum 10 CLAW to seed a market

    address[] public markets;

    error NotVerified();
    error ResolutionInPast();
    error InsufficientLiquidity();

    event MarketCreated(
        address indexed market,
        address indexed creator,
        string question,
        uint256 resolutionTimestamp,
        address resolver
    );

    constructor(address _clawlia, address _registry, address _owner) Ownable(_owner) {
        clawlia = IERC20(_clawlia);
        clawliaWhitelist = IClawliaTokenWhitelist(_clawlia);
        registry = IModelRegistry(_registry);
    }

    /// @notice Create a new prediction market.
    /// @param question The question to predict on
    /// @param resolutionTimestamp When the market can be resolved
    /// @param resolver Address authorized to resolve (can be the creator or an admin)
    /// @param initialLiquidity CLAW to seed the AMM (must be >= MIN_LIQUIDITY)
    function createMarket(
        string calldata question,
        uint256 resolutionTimestamp,
        address resolver,
        uint256 initialLiquidity
    ) external returns (address) {
        if (!registry.isVerified(msg.sender)) revert NotVerified();
        if (resolutionTimestamp <= block.timestamp) revert ResolutionInPast();
        if (initialLiquidity < MIN_LIQUIDITY) revert InsufficientLiquidity();

        PredictionMarket market = new PredictionMarket(
            address(clawlia),
            question,
            resolutionTimestamp,
            resolver
        );

        // Whitelist the new market so it can receive/send CLAW
        clawliaWhitelist.whitelistAddress(address(market));

        // Transfer initial liquidity from creator to this factory, then to market
        clawlia.transferFrom(msg.sender, address(this), initialLiquidity);
        clawlia.approve(address(market), initialLiquidity);
        market.addLiquidity(initialLiquidity);

        // Transfer LP tokens (YES + NO) to the creator
        uint256 yesBalance = market.balanceOf(address(this), 0);
        uint256 noBalance = market.balanceOf(address(this), 1);
        market.safeTransferFrom(address(this), msg.sender, 0, yesBalance, "");
        market.safeTransferFrom(address(this), msg.sender, 1, noBalance, "");

        markets.push(address(market));

        emit MarketCreated(address(market), msg.sender, question, resolutionTimestamp, resolver);

        return address(market);
    }

    /// @notice Get all deployed market addresses.
    function getMarkets() external view returns (address[] memory) {
        return markets;
    }

    /// @notice Get the total number of markets.
    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    /// @dev Required to receive ERC-1155 tokens from PredictionMarket.addLiquidity
    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}
