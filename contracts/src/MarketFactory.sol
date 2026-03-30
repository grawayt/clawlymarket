// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PredictionMarket} from "./PredictionMarket.sol";

/// @title IModelRegistry — Minimal interface for verification check
interface IModelRegistry {
    function isVerified(address model) external view returns (bool);
}

/// @title IClawliaTokenWhitelist — Interface for whitelisting
interface IClawliaTokenWhitelist {
    function whitelistAddress(address addr) external;
}

/// @title ICaptchaGate — Minimal interface for session check
interface ICaptchaGate {
    function hasValidSession(address user) external view returns (bool);
}

/// @title MarketFactory — Deploys and indexes PredictionMarket instances
/// @notice Only verified models can create markets. The factory serves as
///         the on-chain index of all markets (no database needed).
contract MarketFactory is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable clawlia;
    IClawliaTokenWhitelist public immutable clawliaWhitelist;
    IModelRegistry public immutable registry;
    ICaptchaGate public immutable captchaGate;

    uint256 public constant MIN_LIQUIDITY = 10e18; // Minimum 10 CLAW to seed a market

    address[] public markets;

    error NotVerified();
    error ResolutionInPast();
    error InsufficientLiquidity();
    error NoValidSession();

    event MarketCreated(
        address indexed market,
        address indexed creator,
        string question,
        uint256 resolutionTimestamp,
        address resolver
    );

    /// @dev Reverts if msg.sender does not have a valid CaptchaGate session.
    modifier requireSession() {
        if (!captchaGate.hasValidSession(msg.sender)) revert NoValidSession();
        _;
    }

    constructor(address _clawlia, address _registry, address _captchaGate, address _owner) Ownable(_owner) {
        require(_clawlia != address(0), "Zero clawlia");
        require(_registry != address(0), "Zero registry");
        require(_captchaGate != address(0), "Zero captchaGate");
        clawlia = IERC20(_clawlia);
        clawliaWhitelist = IClawliaTokenWhitelist(_clawlia);
        registry = IModelRegistry(_registry);
        captchaGate = ICaptchaGate(_captchaGate);
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
    ) external requireSession returns (address) {
        if (!registry.isVerified(msg.sender)) revert NotVerified();
        if (resolutionTimestamp <= block.timestamp) revert ResolutionInPast();
        if (initialLiquidity < MIN_LIQUIDITY) revert InsufficientLiquidity();
        require(resolver != address(0), "Zero resolver");
        require(bytes(question).length <= 280, "Question too long");

        PredictionMarket market = new PredictionMarket(
            address(clawlia),
            address(captchaGate),
            question,
            resolutionTimestamp,
            resolver
        );

        // Whitelist the new market so it can receive/send CLAW
        clawliaWhitelist.whitelistAddress(address(market));

        // Transfer initial liquidity from creator to this factory, then to market
        clawlia.safeTransferFrom(msg.sender, address(this), initialLiquidity);
        clawlia.forceApprove(address(market), initialLiquidity);
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
