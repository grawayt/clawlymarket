// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CaptchaGateV2} from "../src/CaptchaGateV2.sol";

contract CaptchaGateV2Test is Test {
    CaptchaGateV2 public gate;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");
    address carol = makeAddr("carol");

    // ── Helpers ──────────────────────────────────────────────────────

    /// @dev Build the answer hash the same way the off-chain generator would.
    ///      keccak256(abi.encodePacked(answer0, answer1, ..., answerN))
    function _hashAnswers(string[] memory answers) internal pure returns (bytes32) {
        bytes memory packed;
        for (uint256 i = 0; i < answers.length; i++) {
            packed = abi.encodePacked(packed, answers[i]);
        }
        return keccak256(packed);
    }

    /// @dev Build a bytes32[] array from a string[] for loadChallengeSets.
    function _makeHashes(string[][] memory answerSets) internal pure returns (bytes32[] memory hashes) {
        hashes = new bytes32[](answerSets.length);
        for (uint256 i = 0; i < answerSets.length; i++) {
            hashes[i] = _hashAnswers(answerSets[i]);
        }
    }

    /// @dev Six-answer set used throughout tests (one set per challenge spec).
    function _makeDefaultAnswers() internal pure returns (string[] memory answers) {
        answers = new string[](6);
        answers[0] = "1234"; // math 1
        answers[1] = "5678"; // math 2
        answers[2] = "42";   // code trace
        answers[3] = "NO";   // logic
        answers[4] = "162";  // pattern
        answers[5] = '{"sum":1239,"product":1081,"mod":100}'; // format
    }

    /// @dev Load a single default challenge set and return its hash.
    function _loadOneSet() internal returns (bytes32 h) {
        string[] memory answers = _makeDefaultAnswers();
        h = _hashAnswers(answers);

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = h;

        vm.prank(owner);
        gate.loadChallengeSets(hashes);
    }

    /// @dev Load N identical sets (different hashes in practice — here simplified).
    function _loadNSets(uint256 n) internal {
        bytes32[] memory hashes = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            // Make each set unique by mixing in the index
            string[] memory answers = new string[](2);
            answers[0] = vm.toString(i * 7 + 1);
            answers[1] = vm.toString(i * 13 + 2);
            hashes[i] = _hashAnswers(answers);
        }
        vm.prank(owner);
        gate.loadChallengeSets(hashes);
    }

    // ── Setup ────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(owner);
        gate = new CaptchaGateV2(owner);
        vm.roll(100);
    }

    // ── loadChallengeSets ────────────────────────────────────────────

    function test_loadChallengeSets_storesHashesAndIncreasesCount() public {
        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = keccak256("set0");
        hashes[1] = keccak256("set1");
        hashes[2] = keccak256("set2");

        vm.prank(owner);
        gate.loadChallengeSets(hashes);

        assertEq(gate.challengeCount(), 3);

        (bytes32 h0, bool used0) = gate.challengeSets(0);
        (bytes32 h1,)            = gate.challengeSets(1);
        (bytes32 h2,)            = gate.challengeSets(2);

        assertEq(h0, hashes[0]);
        assertEq(h1, hashes[1]);
        assertEq(h2, hashes[2]);
        assertFalse(used0);
    }

    function test_loadChallengeSets_appendsOnSecondCall() public {
        bytes32[] memory first = new bytes32[](2);
        first[0] = keccak256("a");
        first[1] = keccak256("b");
        vm.prank(owner);
        gate.loadChallengeSets(first);

        bytes32[] memory second = new bytes32[](1);
        second[0] = keccak256("c");
        vm.prank(owner);
        gate.loadChallengeSets(second);

        assertEq(gate.challengeCount(), 3);
        (bytes32 h2,) = gate.challengeSets(2);
        assertEq(h2, second[0]);
    }

    function test_loadChallengeSets_emitsEvent() public {
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = keccak256("x");
        hashes[1] = keccak256("y");

        vm.expectEmit(false, false, false, true);
        emit CaptchaGateV2.ChallengeSetsLoaded(2, 2);

        vm.prank(owner);
        gate.loadChallengeSets(hashes);
    }

    function test_loadChallengeSets_revertsForNonOwner() public {
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = keccak256("z");

        vm.prank(alice);
        vm.expectRevert();
        gate.loadChallengeSets(hashes);
    }

    function test_loadChallengeSets_revertsForEmptyArray() public {
        bytes32[] memory hashes = new bytes32[](0);

        vm.prank(owner);
        vm.expectRevert(CaptchaGateV2.EmptyAnswerHashes.selector);
        gate.loadChallengeSets(hashes);
    }

    // ── requestChallenge ─────────────────────────────────────────────

    function test_requestChallenge_revertsWhenNoSetsLoaded() public {
        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.NoChallengeSetsLoaded.selector);
        gate.requestChallenge();
    }

    function test_requestChallenge_assignsSetAndStoresPendingChallenge() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        (uint256 setId, uint256 blockNum, bool active) = gate.pendingChallenges(alice);
        assertEq(setId, 0);
        assertEq(blockNum, block.number);
        assertTrue(active);
    }

    function test_requestChallenge_emitsEvent() public {
        _loadOneSet();

        vm.expectEmit(true, false, false, true);
        emit CaptchaGateV2.ChallengeAssigned(alice, 0, block.number);

        vm.prank(alice);
        gate.requestChallenge();
    }

    function test_requestChallenge_overwritesPriorAssignment() public {
        _loadNSets(5);

        vm.prank(alice);
        gate.requestChallenge();

        vm.roll(block.number + 1);
        vm.prank(alice);
        gate.requestChallenge();

        (, uint256 blockNum,) = gate.pendingChallenges(alice);
        assertEq(blockNum, block.number);
    }

    // ── Round-robin ──────────────────────────────────────────────────

    function test_roundRobin_assignsSetsInOrder() public {
        _loadNSets(3);

        vm.prank(alice);
        gate.requestChallenge();
        (uint256 setIdAlice,,) = gate.pendingChallenges(alice);
        assertEq(setIdAlice, 0);

        vm.prank(bob);
        gate.requestChallenge();
        (uint256 setIdBob,,) = gate.pendingChallenges(bob);
        assertEq(setIdBob, 1);

        vm.prank(carol);
        gate.requestChallenge();
        (uint256 setIdCarol,,) = gate.pendingChallenges(carol);
        assertEq(setIdCarol, 2);
    }

    function test_roundRobin_wrapsAroundAfterLastSet() public {
        _loadNSets(2); // sets 0 and 1

        vm.prank(alice);
        gate.requestChallenge();
        (uint256 id0,,) = gate.pendingChallenges(alice);

        vm.prank(bob);
        gate.requestChallenge();
        (uint256 id1,,) = gate.pendingChallenges(bob);

        // Third request wraps back to index 0
        vm.prank(carol);
        gate.requestChallenge();
        (uint256 id2,,) = gate.pendingChallenges(carol);

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 0); // wrapped
    }

    // ── solveChallenge — happy path ───────────────────────────────────

    function test_solveChallenge_grantsSessionOnCorrectAnswers() public {
        string[] memory answers = _makeDefaultAnswers();
        bytes32 h = _hashAnswers(answers);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = h;
        vm.prank(owner);
        gate.loadChallengeSets(hashes);

        vm.prank(alice);
        gate.requestChallenge();

        uint256 expectedExpiry = block.timestamp + gate.sessionDuration();

        vm.expectEmit(true, false, false, true);
        emit CaptchaGateV2.SessionGranted(alice, expectedExpiry);

        vm.prank(alice);
        gate.solveChallenge(answers);

        assertEq(gate.sessionExpiry(alice), expectedExpiry);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_solveChallenge_marksSetUsed() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        (, bool used) = gate.challengeSets(0);
        assertTrue(used);
    }

    function test_solveChallenge_deactivatesPendingChallenge() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        (,, bool active) = gate.pendingChallenges(alice);
        assertFalse(active);
    }

    function test_solveChallenge_atDeadlineBlock() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        uint256 deadline = block.number + gate.challengeWindow();
        vm.roll(deadline);

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers); // must not revert

        assertTrue(gate.hasValidSession(alice));
    }

    // ── solveChallenge — reverts ──────────────────────────────────────

    function test_solveChallenge_revertsWithNoPendingChallenge() public {
        _loadOneSet();

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.NoPendingChallenge.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsWithWrongAnswers() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory wrongAnswers = new string[](6);
        wrongAnswers[0] = "9999"; // corrupted
        wrongAnswers[1] = "5678";
        wrongAnswers[2] = "42";
        wrongAnswers[3] = "NO";
        wrongAnswers[4] = "162";
        wrongAnswers[5] = '{"sum":1239,"product":1081,"mod":100}';

        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.WrongAnswers.selector);
        gate.solveChallenge(wrongAnswers);
    }

    function test_solveChallenge_revertsWithEmptyAnswers() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory empty = new string[](0);
        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.WrongAnswers.selector);
        gate.solveChallenge(empty);
    }

    function test_solveChallenge_revertsAfterWindowExpiry() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        // Advance past the window
        vm.roll(block.number + gate.challengeWindow() + 1);

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.ChallengeExpired.selector);
        gate.solveChallenge(answers);
    }

    // ── Set reuse prevention ──────────────────────────────────────────
    // The `used` flag marks that a set has been solved at least once.
    // The contract still allows re-assignment (round-robin doesn't skip used sets),
    // but the test verifies the flag is faithfully set on first solve.

    function test_setUsedFlag_setAfterFirstSolve() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        (, bool used) = gate.challengeSets(0);
        assertTrue(used);
    }

    function test_cannotSolveAgainWithInactivePending() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers = _makeDefaultAnswers();
        vm.startPrank(alice);
        gate.solveChallenge(answers);

        // active is now false — second solve must revert
        vm.expectRevert(CaptchaGateV2.NoPendingChallenge.selector);
        gate.solveChallenge(answers);
        vm.stopPrank();
    }

    // ── Session expiry ───────────────────────────────────────────────

    function test_hasValidSession_falseBeforeAnyChallenge() public view {
        assertFalse(gate.hasValidSession(alice));
    }

    function test_hasValidSession_falseAfterSessionExpires() public {
        _loadOneSet();
        vm.prank(alice);
        gate.requestChallenge();
        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        assertTrue(gate.hasValidSession(alice));

        vm.warp(block.timestamp + gate.sessionDuration() + 1);
        assertFalse(gate.hasValidSession(alice));
    }

    function test_hasValidSession_trueUntilExpiry() public {
        _loadOneSet();
        vm.prank(alice);
        gate.requestChallenge();
        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        vm.warp(block.timestamp + gate.sessionDuration() - 1);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_session_canBeRenewed() public {
        _loadNSets(5);

        // First solve
        vm.prank(alice);
        gate.requestChallenge();

        // Build answers for set 0 (index 0, answers: "1" and "2")
        string[] memory answers0 = new string[](2);
        answers0[0] = vm.toString(uint256(0) * 7 + 1); // "1"
        answers0[1] = vm.toString(uint256(0) * 13 + 2); // "2"

        vm.prank(alice);
        gate.solveChallenge(answers0);
        uint256 firstExpiry = gate.sessionExpiry(alice);

        vm.warp(block.timestamp + 100);
        vm.roll(block.number + 10);

        // Re-request (gets set index 5 % 5 = 0 again due to wrap, but nextChallengeIndex is 1 now)
        // Actually after 1 request alice consumed index 0, next is 1. Alice re-requests -> index 1.
        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers1 = new string[](2);
        answers1[0] = vm.toString(uint256(1) * 7 + 1); // "8"
        answers1[1] = vm.toString(uint256(1) * 13 + 2); // "15"

        vm.prank(alice);
        gate.solveChallenge(answers1);

        uint256 secondExpiry = gate.sessionExpiry(alice);
        assertTrue(secondExpiry > firstExpiry);
    }

    // ── getChallengeSetId ─────────────────────────────────────────────

    function test_getChallengeSetId_returnsAssignedId() public {
        _loadNSets(3);

        vm.prank(alice);
        gate.requestChallenge();

        assertEq(gate.getChallengeSetId(alice), 0);
    }

    function test_getChallengeSetId_revertsWhenNoActivePending() public {
        _loadOneSet();

        vm.expectRevert(CaptchaGateV2.NoPendingChallenge.selector);
        gate.getChallengeSetId(alice);
    }

    function test_getChallengeSetId_revertsAfterSolve() public {
        _loadOneSet();

        vm.prank(alice);
        gate.requestChallenge();

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        vm.expectRevert(CaptchaGateV2.NoPendingChallenge.selector);
        gate.getChallengeSetId(alice);
    }

    // ── getChallengeDeadline ──────────────────────────────────────────

    function test_getChallengeDeadline_returnsCorrectDeadline() public {
        _loadOneSet();

        uint256 bn = block.number;
        vm.prank(alice);
        gate.requestChallenge();

        assertEq(gate.getChallengeDeadline(alice), bn + gate.challengeWindow());
    }

    function test_getChallengeDeadline_revertsWhenNoActivePending() public {
        _loadOneSet();

        vm.expectRevert(CaptchaGateV2.NoPendingChallenge.selector);
        gate.getChallengeDeadline(alice);
    }

    // ── Multiple independent users ───────────────────────────────────

    function test_multipleUsers_independentSessions() public {
        // Load enough sets for all three users
        _loadNSets(3);

        // Pre-compute answers for each set
        string[] memory a0 = new string[](2);
        a0[0] = vm.toString(uint256(0) * 7 + 1);
        a0[1] = vm.toString(uint256(0) * 13 + 2);

        string[] memory a1 = new string[](2);
        a1[0] = vm.toString(uint256(1) * 7 + 1);
        a1[1] = vm.toString(uint256(1) * 13 + 2);

        string[] memory a2 = new string[](2);
        a2[0] = vm.toString(uint256(2) * 7 + 1);
        a2[1] = vm.toString(uint256(2) * 13 + 2);

        vm.prank(alice);
        gate.requestChallenge();
        vm.prank(bob);
        gate.requestChallenge();
        vm.prank(carol);
        gate.requestChallenge();

        vm.prank(alice);
        gate.solveChallenge(a0);
        vm.prank(bob);
        gate.solveChallenge(a1);
        vm.prank(carol);
        gate.solveChallenge(a2);

        assertTrue(gate.hasValidSession(alice));
        assertTrue(gate.hasValidSession(bob));
        assertTrue(gate.hasValidSession(carol));
    }

    function test_multipleUsers_sessionsDontInterfere() public {
        _loadNSets(2);

        string[] memory a0 = new string[](2);
        a0[0] = vm.toString(uint256(0) * 7 + 1);
        a0[1] = vm.toString(uint256(0) * 13 + 2);

        vm.prank(alice);
        gate.requestChallenge();
        vm.prank(alice);
        gate.solveChallenge(a0);

        // Bob and carol have no sessions
        assertFalse(gate.hasValidSession(bob));
        assertFalse(gate.hasValidSession(carol));

        // Expire alice's session
        vm.warp(block.timestamp + gate.sessionDuration() + 1);
        assertFalse(gate.hasValidSession(alice));
        assertFalse(gate.hasValidSession(bob));
    }

    // ── Owner configuration ──────────────────────────────────────────

    function test_setSessionDuration_ownerOnly() public {
        vm.prank(owner);
        gate.setSessionDuration(2 hours);
        assertEq(gate.sessionDuration(), 2 hours);
    }

    function test_setSessionDuration_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        gate.setSessionDuration(2 hours);
    }

    function test_setChallengeWindow_ownerOnly() public {
        vm.prank(owner);
        gate.setChallengeWindow(5);
        assertEq(gate.challengeWindow(), 5);
    }

    function test_setChallengeWindow_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        gate.setChallengeWindow(5);
    }

    function test_setChallengeWindow_revertsZero() public {
        vm.prank(owner);
        vm.expectRevert(CaptchaGateV2.InvalidWindow.selector);
        gate.setChallengeWindow(0);
    }

    function test_setSessionDuration_affectsNewSessions() public {
        _loadOneSet();

        vm.prank(owner);
        gate.setSessionDuration(30 minutes);

        uint256 ts = block.timestamp;
        vm.prank(alice);
        gate.requestChallenge();
        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);

        assertEq(gate.sessionExpiry(alice), ts + 30 minutes);
    }

    function test_setChallengeWindow_expandedWindowAllowsLaterSolve() public {
        _loadOneSet();

        vm.prank(owner);
        gate.setChallengeWindow(50);

        vm.prank(alice);
        gate.requestChallenge();

        vm.roll(block.number + 50); // exactly at new deadline

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        gate.solveChallenge(answers);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_setChallengeWindow_tighterWindowRejectsLaterSolve() public {
        _loadOneSet();

        vm.prank(owner);
        gate.setChallengeWindow(1);

        vm.prank(alice);
        gate.requestChallenge();

        vm.roll(block.number + 2); // beyond window=1

        string[] memory answers = _makeDefaultAnswers();
        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.ChallengeExpired.selector);
        gate.solveChallenge(answers);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────

    /// @notice Fuzz: correct answers always grant a session for any user.
    function testFuzz_correctAnswersAlwaysGrantSession(address user) public {
        vm.assume(user != address(0));
        vm.roll(200);

        string[] memory answers = _makeDefaultAnswers();
        bytes32 h = _hashAnswers(answers);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = h;
        vm.prank(owner);
        gate.loadChallengeSets(hashes);
        // Reset round-robin for clean assignment
        // (nextChallengeIndex may have advanced if other tests ran — fine, set 0 is loaded)

        vm.prank(user);
        gate.requestChallenge();

        vm.prank(user);
        gate.solveChallenge(answers);

        assertTrue(gate.hasValidSession(user));
    }

    /// @notice Fuzz: corrupting any single answer always reverts.
    function testFuzz_corruptedAnswerReverts(uint8 corruptIndex, bytes1 corruption) public {
        vm.assume(corruption != 0);

        string[] memory answers = _makeDefaultAnswers();
        bytes32 h = _hashAnswers(answers);
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = h;
        vm.prank(owner);
        gate.loadChallengeSets(hashes);

        vm.prank(alice);
        gate.requestChallenge();

        // Corrupt one answer by appending a byte
        uint256 idx = corruptIndex % answers.length;
        string[] memory corrupted = _makeDefaultAnswers();
        corrupted[idx] = string(abi.encodePacked(corrupted[idx], corruption));

        // If by chance the corrupted hash still matches (astronomically unlikely), skip
        vm.assume(_hashAnswers(corrupted) != h);

        vm.prank(alice);
        vm.expectRevert(CaptchaGateV2.WrongAnswers.selector);
        gate.solveChallenge(corrupted);
    }
}
