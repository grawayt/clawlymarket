// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @title IPredictionMarket — Minimal interface for jury-driven resolution
interface IPredictionMarket {
    function resolve(uint256 _outcome) external;
    function resolutionTimestamp() external view returns (uint256);
    function resolved() external view returns (bool);
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// @title IModelRegistry — Minimal interface for verification check
interface IModelRegistry {
    function isVerified(address model) external view returns (bool);
}

/// @title JuryResolution — Jury-based resolution system for ClawlyMarket prediction markets
/// @notice Five jurors are selected per market. Haiku-class jurors are privileged (no stake
///         required). A 3-of-5 majority vote triggers automatic market resolution. Jurors
///         who hold any position in a market are ineligible to serve as its jurors.
contract JuryResolution is Ownable {
    // ── Constants ────────────────────────────────────────────────────

    uint256 public constant PANEL_SIZE = 5;
    uint256 public constant MAJORITY = 3;

    uint256 public constant YES = 0;
    uint256 public constant NO = 1;

    // ── Configuration (owner-adjustable) ─────────────────────────────

    uint256 public votingWindow = 24 hours;
    uint256 public jurorFee = 10e18; // 10 CLAW per juror per resolved market

    // ── Immutables ───────────────────────────────────────────────────

    IERC20 public immutable clawlia;
    IModelRegistry public immutable modelRegistry;

    // ── Jury Panel ───────────────────────────────────────────────────

    struct JuryPanel {
        address[5] jurors;
        bool[5] hasVoted;
        uint256[5] votes; // per-juror vote (0=YES, 1=NO); meaningful only when hasVoted
        uint256 yesVotes;
        uint256 noVotes;
        uint256 votingDeadline;
        bool resolved;
        uint256 outcome;
        address marketAddress;
    }

    /// @notice Market address → jury panel
    mapping(address => JuryPanel) private panels;

    /// @notice Tracks which markets have had a panel requested (guards double-init)
    mapping(address => bool) public panelExists;

    /// @notice Privileged juror addresses (e.g. Haiku instances) that need no stake
    mapping(address => bool) public privilegedJurors;

    // ── Errors ───────────────────────────────────────────────────────

    error MarketNotEligible();
    error MarketAlreadyResolved();
    error PanelAlreadyExists();
    error JurorNotVerified(address juror);
    error JurorHoldsPosition(address juror);
    error DuplicateJuror(address juror);
    error NotAJuror();
    error AlreadyVoted();
    error VotingWindowClosed();
    error InvalidOutcome();
    error InsufficientFeeBalance();

    // ── Events ───────────────────────────────────────────────────────

    event PanelConvened(address indexed market, address[5] jurors, uint256 votingDeadline);
    event VoteCast(address indexed market, address indexed juror, uint256 outcome);
    event MarketResolved(address indexed market, uint256 outcome);
    event PrivilegedJurorAdded(address indexed juror);
    event PrivilegedJurorRemoved(address indexed juror);
    event VotingWindowUpdated(uint256 newWindow);
    event JurorFeeUpdated(uint256 newFee);
    event FeesDistributed(address indexed market, uint256 totalFees);

    // ── Constructor ──────────────────────────────────────────────────

    constructor(address _clawlia, address _modelRegistry, address _owner) Ownable(_owner) {
        clawlia = IERC20(_clawlia);
        modelRegistry = IModelRegistry(_modelRegistry);
    }

    // ── Owner Administration ─────────────────────────────────────────

    /// @notice Designate an address as a privileged juror (e.g. a Haiku model instance).
    ///         Privileged jurors are beyond suspicion — they require no stake and are
    ///         always accepted as long as they are ModelRegistry-verified.
    function addPrivilegedJuror(address juror) external onlyOwner {
        privilegedJurors[juror] = true;
        emit PrivilegedJurorAdded(juror);
    }

    /// @notice Remove privileged status from a juror.
    function removePrivilegedJuror(address juror) external onlyOwner {
        privilegedJurors[juror] = false;
        emit PrivilegedJurorRemoved(juror);
    }

    /// @notice Update the voting window duration.
    function setVotingWindow(uint256 newWindow) external onlyOwner {
        votingWindow = newWindow;
        emit VotingWindowUpdated(newWindow);
    }

    /// @notice Update the per-juror fee paid on successful resolution.
    function setJurorFee(uint256 newFee) external onlyOwner {
        jurorFee = newFee;
        emit JurorFeeUpdated(newFee);
    }

    // ── Resolution Request ───────────────────────────────────────────

    /// @notice Convene a jury for a market that is past its resolution timestamp.
    /// @dev Anyone may call this. The caller proposes the five jurors, but each
    ///      must pass eligibility checks. The JuryResolution contract must be set as
    ///      the `resolver` on the PredictionMarket for the final call to succeed.
    /// @param market   Address of the PredictionMarket to resolve
    /// @param jurors   Proposed panel of exactly 5 jurors
    function requestResolution(address market, address[5] calldata jurors) external {
        IPredictionMarket pm = IPredictionMarket(market);

        // Market must be past its resolution timestamp
        if (block.timestamp < pm.resolutionTimestamp()) revert MarketNotEligible();

        // Market must not already be resolved on-chain
        if (pm.resolved()) revert MarketAlreadyResolved();

        // A panel can only be convened once per market
        if (panelExists[market]) revert PanelAlreadyExists();

        // Validate every proposed juror
        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            address juror = jurors[i];

            // No duplicate jurors in the panel
            for (uint256 j = 0; j < i; j++) {
                if (jurors[j] == juror) revert DuplicateJuror(juror);
            }

            // Must be registered in ModelRegistry
            if (!modelRegistry.isVerified(juror)) revert JurorNotVerified(juror);

            // Must not hold any position tokens in this market
            if (pm.balanceOf(juror, YES) > 0 || pm.balanceOf(juror, NO) > 0) {
                revert JurorHoldsPosition(juror);
            }
        }

        // Initialise the panel
        JuryPanel storage panel = panels[market];
        panel.marketAddress = market;
        panel.votingDeadline = block.timestamp + votingWindow;

        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            panel.jurors[i] = jurors[i];
        }

        panelExists[market] = true;

        emit PanelConvened(market, jurors, panel.votingDeadline);
    }

    // ── Voting ───────────────────────────────────────────────────────

    /// @notice Cast a vote for the outcome of a market.
    /// @param market   Address of the PredictionMarket being resolved
    /// @param _outcome 0 = YES, 1 = NO
    function vote(address market, uint256 _outcome) external {
        if (_outcome > 1) revert InvalidOutcome();

        JuryPanel storage panel = panels[market];

        // Voting window must still be open
        if (block.timestamp > panel.votingDeadline) revert VotingWindowClosed();

        // Resolve the caller's index in the panel
        uint256 jurorIndex = _findJurorIndex(panel, msg.sender);

        // Guard: must not have voted already
        if (panel.hasVoted[jurorIndex]) revert AlreadyVoted();

        // Record the vote
        panel.hasVoted[jurorIndex] = true;
        panel.votes[jurorIndex] = _outcome;

        if (_outcome == YES) {
            panel.yesVotes++;
        } else {
            panel.noVotes++;
        }

        emit VoteCast(market, msg.sender, _outcome);

        // Check for majority — auto-resolve if reached (and not already resolved)
        if (!panel.resolved && (panel.yesVotes >= MAJORITY || panel.noVotes >= MAJORITY)) {
            uint256 winningOutcome = panel.yesVotes >= MAJORITY ? YES : NO;
            _resolve(panel, market, winningOutcome);
        }
    }

    // ── View Functions ───────────────────────────────────────────────

    /// @notice Return all jury panel information for a market.
    function getPanel(address market)
        external
        view
        returns (
            address[5] memory jurors,
            bool[5] memory hasVoted,
            uint256[5] memory votes,
            uint256 yesVotes,
            uint256 noVotes,
            uint256 votingDeadline,
            bool resolved,
            uint256 outcome
        )
    {
        JuryPanel storage panel = panels[market];
        return (
            panel.jurors,
            panel.hasVoted,
            panel.votes,
            panel.yesVotes,
            panel.noVotes,
            panel.votingDeadline,
            panel.resolved,
            panel.outcome
        );
    }

    /// @notice Returns true if the given address is a juror for the given market.
    function isJuror(address market, address account) external view returns (bool) {
        JuryPanel storage panel = panels[market];
        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            if (panel.jurors[i] == account) return true;
        }
        return false;
    }

    // ── Internal ─────────────────────────────────────────────────────

    /// @dev Find the array index of msg.sender in the panel. Reverts if not found.
    function _findJurorIndex(JuryPanel storage panel, address account) internal view returns (uint256) {
        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            if (panel.jurors[i] == account) return i;
        }
        revert NotAJuror();
    }

    /// @dev Execute market resolution and distribute juror fees.
    function _resolve(JuryPanel storage panel, address market, uint256 winningOutcome) internal {
        panel.resolved = true;
        panel.outcome = winningOutcome;

        // Call resolve on the PredictionMarket — this contract must be the resolver
        IPredictionMarket(market).resolve(winningOutcome);

        emit MarketResolved(market, winningOutcome);

        // Distribute fees to jurors who voted (skip no-shows)
        // Fees are paid from CLAW held by this contract (must be funded externally).
        uint256 totalFees = 0;
        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            if (panel.hasVoted[i]) {
                address juror = panel.jurors[i];
                // Best-effort: if the contract lacks funds, skip silently to avoid
                // blocking resolution. A separate top-up mechanism is expected.
                if (clawlia.balanceOf(address(this)) >= jurorFee) {
                    clawlia.transfer(juror, jurorFee);
                    totalFees += jurorFee;
                }
            }
        }

        if (totalFees > 0) {
            emit FeesDistributed(market, totalFees);
        }
    }
}
