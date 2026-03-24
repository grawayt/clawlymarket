// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ICaptchaGate — Minimal interface for session check
interface ICaptchaGate {
    function hasValidSession(address user) external view returns (bool);
}

/// @title PredictionMarket — Binary AMM (Fixed Product Market Maker)
/// @notice Each instance represents a single YES/NO prediction market.
///         Position tokens are ERC-1155 (YES=0, NO=1). Collateral is CLAW.
contract PredictionMarket is ERC1155, ReentrancyGuard {
    uint256 public constant YES = 0;
    uint256 public constant NO = 1;
    uint256 public constant FEE_BPS = 200; // 2%
    uint256 public constant GRACE_PERIOD = 7 days;

    IERC20 public immutable clawlia;
    ICaptchaGate public immutable captchaGate;
    string public question;
    uint256 public resolutionTimestamp;
    address public resolver;

    bool public resolved;
    uint256 public outcome; // 0 = YES won, 1 = NO won
    uint256 public totalCollateral;
    uint256 public accumulatedFees; // fees collected (buy + sell); excluded from redemption payouts

    // AMM reserves
    uint256 public reserveYes;
    uint256 public reserveNo;

    error MarketResolved();
    error MarketNotResolved();
    error TooEarly();
    error NotResolver();
    error InvalidOutcome();
    error ZeroAmount();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error NoValidSession();

    event LiquidityAdded(address indexed provider, uint256 amount, uint256 yesTokens, uint256 noTokens);
    event LiquidityRemoved(address indexed provider, uint256 yesTokens, uint256 noTokens, uint256 collateral);
    event Trade(address indexed trader, uint256 outcomeIndex, bool isBuy, uint256 collateral, uint256 tokens);
    event MarketOutcome(uint256 outcome);
    event Redeemed(address indexed redeemer, uint256 amount, uint256 payout);
    event EmergencyWithdraw(address indexed user, uint256 amount);

    /// @dev Reverts if msg.sender does not have a valid CaptchaGate session.
    modifier requireSession() {
        if (!captchaGate.hasValidSession(msg.sender)) revert NoValidSession();
        _;
    }

    constructor(
        address _clawlia,
        address _captchaGate,
        string memory _question,
        uint256 _resolutionTimestamp,
        address _resolver
    ) ERC1155("") {
        require(_resolver != address(0), "Zero resolver");
        clawlia = IERC20(_clawlia);
        captchaGate = ICaptchaGate(_captchaGate);
        question = _question;
        resolutionTimestamp = _resolutionTimestamp;
        resolver = _resolver;
    }

    // ── Liquidity ────────────────────────────────────────────────────

    /// @notice Add liquidity to the AMM. Caller deposits CLAW, receives YES + NO tokens.
    ///         Must have approved this contract for `amount` CLAW first.
    function addLiquidity(uint256 amount) external nonReentrant requireSession returns (uint256 yesTokens, uint256 noTokens) {
        if (resolved) revert MarketResolved();
        if (amount == 0) revert ZeroAmount();

        clawlia.transferFrom(msg.sender, address(this), amount);

        if (reserveYes == 0 && reserveNo == 0) {
            // First liquidity provider: 50/50 split
            yesTokens = amount;
            noTokens = amount;
        } else {
            // Proportional to current reserves — use oldCollateral BEFORE adding amount
            uint256 oldCollateral = totalCollateral;
            yesTokens = (amount * reserveYes) / oldCollateral;
            noTokens = (amount * reserveNo) / oldCollateral;
            if (yesTokens == 0 || noTokens == 0) revert ZeroAmount();
        }

        totalCollateral += amount;

        reserveYes += yesTokens;
        reserveNo += noTokens;

        _mint(msg.sender, YES, yesTokens, "");
        _mint(msg.sender, NO, noTokens, "");

        emit LiquidityAdded(msg.sender, amount, yesTokens, noTokens);
    }

    /// @notice Remove liquidity by returning equal amounts of YES and NO tokens.
    function removeLiquidity(uint256 yesAmount, uint256 noAmount) external nonReentrant returns (uint256 collateral) {
        if (resolved) revert MarketResolved();
        if (yesAmount == 0 || noAmount == 0) revert ZeroAmount();

        // Calculate proportional collateral to return
        // Use the lesser proportion to prevent reserve imbalance exploitation
        uint256 yesProp = (yesAmount * totalCollateral) / reserveYes;
        uint256 noProp = (noAmount * totalCollateral) / reserveNo;
        collateral = yesProp < noProp ? yesProp : noProp;
        if (collateral == 0) revert ZeroAmount();

        _burn(msg.sender, YES, yesAmount);
        _burn(msg.sender, NO, noAmount);

        reserveYes -= yesAmount;
        reserveNo -= noAmount;
        totalCollateral -= collateral;

        clawlia.transfer(msg.sender, collateral);

        emit LiquidityRemoved(msg.sender, yesAmount, noAmount, collateral);
    }

    // ── Trading ──────────────────────────────────────────────────────

    /// @notice Buy outcome tokens by depositing CLAW. Uses constant product formula.
    /// @param outcomeIndex 0 = YES, 1 = NO
    /// @param collateralAmount Amount of CLAW to spend
    /// @param minTokensOut Minimum tokens to receive (slippage protection)
    function buy(uint256 outcomeIndex, uint256 collateralAmount, uint256 minTokensOut)
        external
        nonReentrant
        requireSession
        returns (uint256 tokensOut)
    {
        if (resolved) revert MarketResolved();
        if (outcomeIndex > 1) revert InvalidOutcome();
        if (collateralAmount == 0) revert ZeroAmount();

        uint256 fee = (collateralAmount * FEE_BPS) / 10000;
        uint256 netAmount = collateralAmount - fee;

        clawlia.transferFrom(msg.sender, address(this), collateralAmount);
        totalCollateral += collateralAmount;
        accumulatedFees += fee;

        // Constant product: (reserveYes + netAmount) * (reserveNo + netAmount) stays constant
        // after minting both sides and selling back the unwanted side.
        //
        // Simplified: we mint `netAmount` of BOTH outcome tokens, then "sell" the unwanted
        // outcome token into the pool. The buyer keeps the wanted outcome token.
        //
        // tokensOut = reserveWanted - (k / (reserveUnwanted + netAmount))
        // where k = reserveYes * reserveNo (before adding netAmount to both)

        uint256 k = reserveYes * reserveNo;

        // Add netAmount to both reserves (minting both outcome tokens)
        reserveYes += netAmount;
        reserveNo += netAmount;

        if (outcomeIndex == YES) {
            // Buyer wants YES — sell NO tokens back into pool
            // New reserveNo after selling: reserveNo + noTokensSold
            // New reserveYes: k' / newReserveNo
            // But actually: we already added netAmount to reserveYes.
            // The buyer removes some YES tokens. New invariant:
            // (reserveYes - tokensOut) * reserveNo = old k + netAmount * (reserveYes_old + reserveNo_old) + netAmount^2
            // Simplification using the FPMM approach:
            // tokensOut = reserveYes - (k / reserveNo) where k is the NEW product target
            // k_new = (reserveYes_old + netAmount) * (reserveNo_old + netAmount)
            // Actually we want: after removing tokensOut from YES,
            // (reserveYes - tokensOut) * reserveNo = k_old
            // tokensOut = reserveYes - k_old / reserveNo
            tokensOut = reserveYes - (k / reserveNo);
            reserveYes -= tokensOut;
        } else {
            tokensOut = reserveNo - (k / reserveYes);
            reserveNo -= tokensOut;
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded();

        _mint(msg.sender, outcomeIndex, tokensOut, "");

        emit Trade(msg.sender, outcomeIndex, true, collateralAmount, tokensOut);
    }

    /// @notice Sell outcome tokens to receive CLAW.
    /// @param outcomeIndex 0 = YES, 1 = NO
    /// @param tokenAmount Amount of outcome tokens to sell
    /// @param minCollateralOut Minimum CLAW to receive (slippage protection)
    function sell(uint256 outcomeIndex, uint256 tokenAmount, uint256 minCollateralOut)
        external
        nonReentrant
        requireSession
        returns (uint256 collateralOut)
    {
        if (resolved) revert MarketResolved();
        if (outcomeIndex > 1) revert InvalidOutcome();
        if (tokenAmount == 0) revert ZeroAmount();

        _burn(msg.sender, outcomeIndex, tokenAmount);

        // Reverse of buy: add the outcome tokens back to the reserve,
        // then remove equal amounts from both reserves (burn both, return CLAW).
        // collateralOut = reserveYes + reserveNo - sqrt(k_new) ... no, simpler:
        //
        // k_old = reserveYes * reserveNo
        // Add tokenAmount to the appropriate reserve
        // k_new_intermediate = reserveYes_new * reserveNo_new
        // collateralOut = amount such that (reserveYes_new - collateralOut)(reserveNo_new - collateralOut) = k_old
        // This is the inverse of the buy formula.

        uint256 k = reserveYes * reserveNo;

        if (outcomeIndex == YES) {
            reserveYes += tokenAmount;
        } else {
            reserveNo += tokenAmount;
        }

        // We need to find collateralOut such that
        // (reserveYes - collateralOut) * (reserveNo - collateralOut) = k
        // This expands to: collateralOut^2 - (reserveYes + reserveNo) * collateralOut + (reserveYes * reserveNo - k) = 0
        // collateralOut = [(rY + rN) - sqrt((rY + rN)^2 - 4 * (rY * rN - k))] / 2
        // Simplify discriminant: (rY + rN)^2 - 4*rY*rN + 4k = (rY - rN)^2 + 4k

        uint256 sum = reserveYes + reserveNo;
        uint256 product = reserveYes * reserveNo;
        uint256 discriminant = (sum * sum) - 4 * (product - k);
        uint256 sqrtDisc = _sqrt(discriminant);

        collateralOut = (sum - sqrtDisc) / 2;

        // Apply fee — fee stays in reserves, benefiting LPs
        uint256 fee = (collateralOut * FEE_BPS) / 10000;
        collateralOut -= fee;

        if (collateralOut < minCollateralOut) revert SlippageExceeded();

        // Remove only net collateralOut from reserves; fee remains in both reserves
        reserveYes -= collateralOut;
        reserveNo -= collateralOut;
        totalCollateral -= collateralOut;

        clawlia.transfer(msg.sender, collateralOut);

        emit Trade(msg.sender, outcomeIndex, false, collateralOut, tokenAmount);
    }

    // ── Resolution ───────────────────────────────────────────────────

    /// @notice Resolve the market. Only the designated resolver, only after resolution time.
    function resolve(uint256 _outcome) external {
        if (msg.sender != resolver) revert NotResolver();
        if (block.timestamp < resolutionTimestamp) revert TooEarly();
        if (resolved) revert MarketResolved();
        if (_outcome > 1) revert InvalidOutcome();

        resolved = true;
        outcome = _outcome;

        emit MarketOutcome(_outcome);
    }

    /// @notice Redeem winning outcome tokens for CLAW after resolution.
    function redeem(uint256 amount) external nonReentrant {
        if (!resolved) revert MarketNotResolved();
        if (amount == 0) revert ZeroAmount();

        _burn(msg.sender, outcome, amount);

        // Payout: proportional share of collateral excluding protocol fees
        // Winners split the pot (minus accumulated fees) based on their share of winning tokens
        uint256 totalWinning = (outcome == YES) ? reserveYes : reserveNo;
        uint256 payoutPool = totalCollateral - accumulatedFees;
        uint256 payout = (amount * payoutPool) / totalWinning;

        if (outcome == YES) {
            reserveYes -= amount;
        } else {
            reserveNo -= amount;
        }
        totalCollateral -= payout;

        clawlia.transfer(msg.sender, payout);

        emit Redeemed(msg.sender, amount, payout);
    }

    /// @notice Emergency withdrawal if market is not resolved after grace period.
    ///         Returns proportional collateral for any outcome tokens held.
    function emergencyWithdraw() external nonReentrant {
        if (resolved) revert MarketResolved();
        if (block.timestamp < resolutionTimestamp + GRACE_PERIOD) revert TooEarly();

        uint256 yesBalance = balanceOf(msg.sender, YES);
        uint256 noBalance = balanceOf(msg.sender, NO);
        if (yesBalance + noBalance == 0) revert ZeroAmount();

        uint256 totalTokens = reserveYes + reserveNo;

        if (totalTokens == 0) revert ZeroAmount();

        uint256 payout = ((yesBalance + noBalance) * totalCollateral) / totalTokens;

        if (yesBalance > 0) _burn(msg.sender, YES, yesBalance);
        if (noBalance > 0) _burn(msg.sender, NO, noBalance);

        reserveYes -= yesBalance;
        reserveNo -= noBalance;
        totalCollateral -= payout;

        clawlia.transfer(msg.sender, payout);

        emit EmergencyWithdraw(msg.sender, payout);
    }

    // ── View Functions ───────────────────────────────────────────────

    /// @notice Returns implied probabilities in basis points (0–10000).
    function getImpliedProbability() external view returns (uint256 yesProbBps, uint256 noProbBps) {
        if (reserveYes == 0 && reserveNo == 0) return (5000, 5000);
        uint256 total = reserveYes + reserveNo;
        // Higher reserve = lower demand = lower implied probability
        yesProbBps = (reserveNo * 10000) / total;
        noProbBps = 10000 - yesProbBps;
    }

    // ── Internal ─────────────────────────────────────────────────────

    /// @dev Integer square root via Newton's method (Babylonian).
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
