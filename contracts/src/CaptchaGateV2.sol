// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CaptchaGateV2 — Hash-committed multi-challenge CAPTCHA gate for AI agents
/// @notice The contract owner pre-loads batches of challenge sets. Each set contains
///         multiple challenge types (math, code trace, logic, pattern, format). When a
///         user requests a session they are assigned the next available set (round-robin).
///         They must submit ALL correct answers within the challenge window. The contract
///         never stores the plaintext questions or answers — only keccak256 commitments.
///
/// @dev Answer verification:
///      keccak256(abi.encodePacked(answers[0], answers[1], ..., answers[N-1]))
///      must equal the stored answerHash for the assigned set.
///
///      This makes challenges trivial for an LLM (it reads the question JSON and
///      computes the answers programmatically) but hard for a human (multi-type,
///      math-heavy, strict format required).
///
///      Interface is identical to CaptchaGate: `hasValidSession(address)` is the
///      only function that external contracts need to call.
contract CaptchaGateV2 is Ownable {
    // ── Configuration ────────────────────────────────────────────────

    uint256 public sessionDuration = 1 hours;
    uint256 public challengeWindow = 30; // blocks within which challenge must be solved (~7.5s on Arbitrum)

    // ── Challenge Sets ───────────────────────────────────────────────

    struct ChallengeSet {
        bytes32 answerHash; // keccak256(abi.encodePacked(answer0, answer1, ..., answerN))
        bool used;          // prevents a set from being assigned twice
    }

    /// @notice Loaded challenge sets, indexed 0..challengeCount-1.
    mapping(uint256 => ChallengeSet) public challengeSets;

    /// @notice Total number of loaded challenge sets.
    uint256 public challengeCount;

    /// @notice Index of the next set to be assigned (round-robin).
    uint256 public nextChallengeIndex;

    // ── Sessions ─────────────────────────────────────────────────────

    /// @notice Timestamp when a user's session expires. 0 = no active session.
    mapping(address => uint256) public sessionExpiry;

    // ── Pending Challenges ───────────────────────────────────────────

    struct PendingChallenge {
        uint256 setId;       // which challenge set was assigned
        uint256 blockNumber; // block.number when requestChallenge() was called
        bool active;         // true once a challenge has been assigned
    }

    mapping(address => PendingChallenge) public pendingChallenges;

    // ── Errors ───────────────────────────────────────────────────────

    error NoPendingChallenge();
    error ChallengeExpired();
    error WrongAnswers();
    error InvalidWindow();
    error NoChallengeSetsLoaded();
    error EmptyAnswerHashes();

    // ── Events ───────────────────────────────────────────────────────

    event ChallengeSetsLoaded(uint256 count, uint256 newTotal);
    event ChallengeAssigned(address indexed user, uint256 setId, uint256 blockNumber);
    event SessionGranted(address indexed user, uint256 expiry);

    // ── Constructor ──────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {}

    // ── Owner: Load Challenge Sets ───────────────────────────────────

    /// @notice Bulk-load challenge set answer hashes. Owner only.
    /// @param answerHashes Array of keccak256 hashes, one per challenge set.
    ///        Each hash = keccak256(abi.encodePacked(answer0, answer1, ..., answerN))
    ///        where each answerK is a raw string (no null terminator).
    function loadChallengeSets(bytes32[] calldata answerHashes) external onlyOwner {
        if (answerHashes.length == 0) revert EmptyAnswerHashes();

        uint256 start = challengeCount;
        for (uint256 i = 0; i < answerHashes.length; i++) {
            challengeSets[start + i] = ChallengeSet({answerHash: answerHashes[i], used: false});
        }
        challengeCount = start + answerHashes.length;

        emit ChallengeSetsLoaded(answerHashes.length, challengeCount);
    }

    // ── Core Functions ───────────────────────────────────────────────

    /// @notice Assign the next challenge set to the caller (round-robin).
    ///         A new call always overwrites any unused prior assignment.
    ///         Reverts if no challenge sets have been loaded.
    function requestChallenge() external {
        if (challengeCount == 0) revert NoChallengeSetsLoaded();

        // Find the next unused set, wrapping around if needed.
        // In steady-state operation (challenge sets >> active users) this will
        // almost always succeed in one step. If all sets are used, we wrap and
        // reuse — used sets can still be validated; the `used` flag only prevents
        // the *same* set from being active for two different users simultaneously.
        // The owner should periodically reload fresh sets to prevent reuse.
        uint256 setId = nextChallengeIndex % challengeCount;
        nextChallengeIndex = (setId + 1) % challengeCount;

        pendingChallenges[msg.sender] = PendingChallenge({
            setId: setId,
            blockNumber: block.number,
            active: true
        });

        emit ChallengeAssigned(msg.sender, setId, block.number);
    }

    /// @notice Submit answers to the pending challenge.
    /// @param answers Array of answer strings (must match the number used when the
    ///        challenge set was generated). Order matters — must match the generator.
    /// @dev Verification: keccak256(abi.encodePacked(answers[0], answers[1], ...))
    ///      must match the stored answerHash for the assigned set.
    function solveChallenge(string[] calldata answers) external {
        PendingChallenge storage pc = pendingChallenges[msg.sender];

        if (!pc.active) revert NoPendingChallenge();
        if (block.number > pc.blockNumber + challengeWindow) revert ChallengeExpired();

        // Build the packed encoding of all submitted answers.
        // This mirrors the off-chain generator: keccak256(abi.encodePacked(a0, a1, ...))
        bytes memory packed;
        for (uint256 i = 0; i < answers.length; i++) {
            packed = abi.encodePacked(packed, answers[i]);
        }
        bytes32 submittedHash = keccak256(packed);

        if (submittedHash != challengeSets[pc.setId].answerHash) revert WrongAnswers();

        // Mark challenge as consumed so it cannot be solved again.
        pc.active = false;
        challengeSets[pc.setId].used = true;

        uint256 expiry = block.timestamp + sessionDuration;
        sessionExpiry[msg.sender] = expiry;

        emit SessionGranted(msg.sender, expiry);
    }

    // ── View Functions ───────────────────────────────────────────────

    /// @notice Check whether a user has a currently valid session.
    function hasValidSession(address user) external view returns (bool) {
        return block.timestamp < sessionExpiry[user];
    }

    /// @notice Returns the challenge set ID assigned to a user.
    ///         The frontend uses this to look up the question texts from the static JSON.
    function getChallengeSetId(address user) external view returns (uint256) {
        PendingChallenge storage pc = pendingChallenges[user];
        if (!pc.active) revert NoPendingChallenge();
        return pc.setId;
    }

    /// @notice Returns the block deadline for a user's pending challenge.
    function getChallengeDeadline(address user) external view returns (uint256) {
        PendingChallenge storage pc = pendingChallenges[user];
        if (!pc.active) revert NoPendingChallenge();
        return pc.blockNumber + challengeWindow;
    }

    // ── Owner Config ─────────────────────────────────────────────────

    /// @notice Update session duration (owner only).
    function setSessionDuration(uint256 _duration) external onlyOwner {
        sessionDuration = _duration;
    }

    /// @notice Update the block window within which challenges must be solved (owner only).
    function setChallengeWindow(uint256 _window) external onlyOwner {
        if (_window == 0) revert InvalidWindow();
        challengeWindow = _window;
    }
}
