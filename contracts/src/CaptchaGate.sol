// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CaptchaGate — Speed-gated reverse CAPTCHA for AI agents
/// @notice Generates math challenges that are trivial for AI code but tedious for
///         manual humans. Must be solved within a tight block window (~2 blocks).
///         Successfully solving grants a session token valid for configurable duration.
///
/// @dev Challenge derivation uses blockhash of the challenge block, which means
///      (a) challenges are deterministic and verifiable on-chain, and
///      (b) blockhash is only accessible for the last 256 blocks — challenges expire
///          automatically once the challenge block scrolls out of the accessible window.
///
///      NOTE: blockhash(block.number) always returns 0. Challenges therefore use
///      block.number - 1 as the seed block. The contract stores the seed block
///      (challengeBlock - 1) so verification uses the same block.
contract CaptchaGate is Ownable {
    // ── Configuration ────────────────────────────────────────────────

    uint256 public sessionDuration = 1 hours;
    uint256 public challengeWindow = 10; // blocks within which challenge must be solved (~2.5 s on Arbitrum)

    // ── State ────────────────────────────────────────────────────────

    /// @notice Timestamp when a user's session expires. 0 = no active session.
    mapping(address => uint256) public sessionExpiry;

    struct Challenge {
        uint256 seedBlock; // the block whose hash seeds the challenge (block.number - 1 at request time)
        uint256 issuedBlock; // block.number when requestChallenge() was called
        bool used;
    }

    mapping(address => Challenge) public pendingChallenges;

    // ── Errors ───────────────────────────────────────────────────────

    error NoPendingChallenge();
    error ChallengeAlreadyUsed();
    error ChallengeExpired();
    error WrongAnswers();
    error InvalidWindow();

    // ── Events ───────────────────────────────────────────────────────

    event ChallengeIssued(address indexed user, uint256 issuedBlock, uint256 seedBlock);
    event SessionGranted(address indexed user, uint256 expiry);

    // ── Constructor ──────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {}

    // ── Core Functions ───────────────────────────────────────────────

    /// @notice Record a new challenge for the caller.
    ///         The challenge is seeded by blockhash(block.number - 1), which is
    ///         guaranteed to be non-zero for any recent block.
    ///         A new call overwrites any unused prior challenge.
    function requestChallenge() external {
        uint256 seedBlock = block.number - 1;
        pendingChallenges[msg.sender] = Challenge({
            seedBlock: seedBlock,
            issuedBlock: block.number,
            used: false
        });
        emit ChallengeIssued(msg.sender, block.number, seedBlock);
    }

    /// @notice Submit answers to the pending challenge.
    /// @param answers Array of 5 answers (one per sub-problem).
    /// @dev Must be called within `challengeWindow` blocks of requestChallenge().
    ///      The challenge's seed block must still be within the last 256 blocks so
    ///      blockhash() returns a non-zero value; if not, the challenge is expired.
    function solveChallenge(uint256[5] calldata answers) external {
        Challenge storage ch = pendingChallenges[msg.sender];

        if (ch.issuedBlock == 0) revert NoPendingChallenge();
        if (ch.used) revert ChallengeAlreadyUsed();

        // Must be solved within challengeWindow blocks of issuance
        if (block.number > ch.issuedBlock + challengeWindow) revert ChallengeExpired();

        // blockhash returns 0 if block is >256 blocks old or is the current block.
        // Since seedBlock = issuedBlock - 1 and we check above that we're within the
        // window, the only failure case here is the very edge where the seed block
        // has scrolled out of the 256-block window (essentially never in practice).
        bytes32 seedHash = blockhash(ch.seedBlock);
        if (seedHash == bytes32(0)) revert ChallengeExpired();

        // Verify all 5 answers
        for (uint256 i = 0; i < 5; i++) {
            (, uint256 expected) = _computeAnswer(ch.seedBlock, msg.sender, i);
            if (answers[i] != expected) revert WrongAnswers();
        }

        // Mark used and grant session
        ch.used = true;
        uint256 expiry = block.timestamp + sessionDuration;
        sessionExpiry[msg.sender] = expiry;

        emit SessionGranted(msg.sender, expiry);
    }

    /// @notice Check whether a user has a currently valid session.
    function hasValidSession(address user) external view returns (bool) {
        return block.timestamp < sessionExpiry[user];
    }

    /// @notice Return the 5 problems for a user's pending challenge, plus the deadline block.
    ///         Problems are encoded as a single uint256: (a << 48) | (b << 32) | (c << 16) | p
    ///         — but since a,b,c < 10000 and p < ~10000, each fits in 14 bits so packing into
    ///         16-bit slots is safe. Frontend decodes: a = (problem >> 48) & 0xFFFF, etc.
    /// @return problems Array of 5 encoded (a, b, c, p) values
    /// @return deadline The last block number by which solveChallenge() can succeed
    function getChallenge(address user)
        external
        view
        returns (uint256[5] memory problems, uint256 deadline)
    {
        Challenge storage ch = pendingChallenges[user];
        if (ch.issuedBlock == 0) revert NoPendingChallenge();

        deadline = ch.issuedBlock + challengeWindow;

        for (uint256 i = 0; i < 5; i++) {
            (uint256 problem,) = _computeAnswer(ch.seedBlock, user, i);
            problems[i] = problem;
        }
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

    /// @notice Grant a permanent session to an address (owner only). Used for infrastructure contracts.
    function grantSession(address addr) external onlyOwner {
        sessionExpiry[addr] = type(uint256).max;
    }

    // ── Internal ─────────────────────────────────────────────────────

    /// @dev Derive a math problem and its answer from a past block hash + user address + index.
    ///
    ///      Problem:  (a * b + c) mod p
    ///      Encoding: (a << 48) | (b << 32) | (c << 16) | p   (each field fits in 16 bits)
    ///
    ///      Variables:
    ///        seed = keccak256(blockhash(blockNum), user, index)
    ///        a    = uint256(seed)          % 10000
    ///        b    = uint256(keccak256(seed, "b")) % 10000
    ///        c    = uint256(keccak256(seed, "c")) % 10000
    ///        p    = uint256(keccak256(seed, "p")) % 9973 + 7   (range [7, 9979])
    ///        answer = (a * b + c) % p
    ///
    /// @param blockNum  The seed block number (must be accessible via blockhash).
    /// @param user      The challenger's address.
    /// @param index     Sub-problem index [0, 4].
    /// @return problem  Packed encoding of (a, b, c, p).
    /// @return answer   The expected answer.
    function _computeAnswer(uint256 blockNum, address user, uint256 index)
        internal
        view
        returns (uint256 problem, uint256 answer)
    {
        bytes32 seedHash = blockhash(blockNum);
        bytes32 seed = keccak256(abi.encodePacked(seedHash, user, index));

        uint256 a = uint256(seed) % 10000;
        uint256 b = uint256(keccak256(abi.encodePacked(seed, "b"))) % 10000;
        uint256 c = uint256(keccak256(abi.encodePacked(seed, "c"))) % 10000;
        uint256 p = uint256(keccak256(abi.encodePacked(seed, "p"))) % 9973 + 7;

        answer = (a * b + c) % p;

        // Pack: a in bits [63:48], b in [47:32], c in [31:16], p in [15:0]
        problem = (a << 48) | (b << 32) | (c << 16) | p;
    }
}
