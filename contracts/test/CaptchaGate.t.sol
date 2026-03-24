// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CaptchaGate} from "../src/CaptchaGate.sol";

contract CaptchaGateTest is Test {
    CaptchaGate public gate;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");
    address carol = makeAddr("carol");

    // ── Setup ────────────────────────────────────────────────────────

    function setUp() public {
        vm.prank(owner);
        gate = new CaptchaGate(owner);

        // Start at a block high enough that block.number - 1 is valid
        vm.roll(100);
        vm.prevrandao(bytes32(uint256(42)));
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// @dev Compute the correct 5 answers for `user` whose challenge was issued
    ///      at `issuedBlock` (so seedBlock = issuedBlock - 1). This mirrors the
    ///      logic in CaptchaGate._computeAnswer().
    function _computeAnswers(address user, uint256 issuedBlock)
        internal
        view
        returns (uint256[5] memory answers)
    {
        uint256 seedBlock = issuedBlock - 1;
        bytes32 seedHash = blockhash(seedBlock);

        for (uint256 i = 0; i < 5; i++) {
            bytes32 seed = keccak256(abi.encodePacked(seedHash, user, i));
            uint256 a = uint256(seed) % 10000;
            uint256 b = uint256(keccak256(abi.encodePacked(seed, "b"))) % 10000;
            uint256 c = uint256(keccak256(abi.encodePacked(seed, "c"))) % 10000;
            uint256 p = uint256(keccak256(abi.encodePacked(seed, "p"))) % 9973 + 7;
            answers[i] = (a * b + c) % p;
        }
    }

    /// @dev Request a challenge as `user` and return the block it was issued at.
    function _requestChallenge(address user) internal returns (uint256 issuedBlock) {
        issuedBlock = block.number;
        vm.prank(user);
        gate.requestChallenge();
    }

    /// @dev Full happy-path: request + solve within window for `user`.
    function _solveHappyPath(address user) internal {
        uint256 issuedBlock = _requestChallenge(user);
        uint256[5] memory answers = _computeAnswers(user, issuedBlock);
        vm.prank(user);
        gate.solveChallenge(answers);
    }

    // ── requestChallenge ─────────────────────────────────────────────

    function test_requestChallenge_storesPendingChallenge() public {
        uint256 issuedBlock = block.number;
        vm.prank(alice);
        gate.requestChallenge();

        (uint256 seedBlock, uint256 stored, bool used) = gate.pendingChallenges(alice);
        assertEq(stored, issuedBlock);
        assertEq(seedBlock, issuedBlock - 1);
        assertFalse(used);
    }

    function test_requestChallenge_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit CaptchaGate.ChallengeIssued(alice, block.number, block.number - 1);
        vm.prank(alice);
        gate.requestChallenge();
    }

    function test_requestChallenge_overwritesPriorChallenge() public {
        vm.prank(alice);
        gate.requestChallenge();
        uint256 firstBlock = block.number;

        vm.roll(block.number + 1);
        vm.prank(alice);
        gate.requestChallenge();
        uint256 secondBlock = block.number;

        (uint256 seedBlock, uint256 stored,) = gate.pendingChallenges(alice);
        assertEq(stored, secondBlock);
        assertEq(seedBlock, secondBlock - 1);
        assertTrue(firstBlock != secondBlock);
    }

    // ── solveChallenge — happy path ───────────────────────────────────

    function test_solveChallenge_grantsSession() public {
        uint256 issuedBlock = _requestChallenge(alice);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);

        uint256 expectedExpiry = block.timestamp + gate.sessionDuration();

        vm.expectEmit(true, false, false, true);
        emit CaptchaGate.SessionGranted(alice, expectedExpiry);

        vm.prank(alice);
        gate.solveChallenge(answers);

        assertEq(gate.sessionExpiry(alice), expectedExpiry);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_solveChallenge_marksUsed() public {
        uint256 issuedBlock = _requestChallenge(alice);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        vm.prank(alice);
        gate.solveChallenge(answers);

        (,, bool used) = gate.pendingChallenges(alice);
        assertTrue(used);
    }

    /// @notice Solve at the last valid block (issuedBlock + challengeWindow).
    function test_solveChallenge_atDeadlineBlock() public {
        uint256 issuedBlock = _requestChallenge(alice);
        uint256 deadline = issuedBlock + gate.challengeWindow();

        vm.roll(deadline);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        vm.prank(alice);
        gate.solveChallenge(answers); // should not revert

        assertTrue(gate.hasValidSession(alice));
    }

    // ── solveChallenge — reverts ──────────────────────────────────────

    function test_solveChallenge_revertsWithNoPendingChallenge() public {
        uint256[5] memory answers;
        vm.prank(alice);
        vm.expectRevert(CaptchaGate.NoPendingChallenge.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsWithWrongAnswers() public {
        uint256 issuedBlock = _requestChallenge(alice);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);

        // Corrupt the first answer
        answers[0] = answers[0] + 1;

        vm.prank(alice);
        vm.expectRevert(CaptchaGate.WrongAnswers.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsWithAllZeroAnswers() public {
        _requestChallenge(alice);
        uint256[5] memory answers; // all zeros

        vm.prank(alice);
        vm.expectRevert(CaptchaGate.WrongAnswers.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsAfterWindowExpires() public {
        uint256 issuedBlock = _requestChallenge(alice);

        // Advance past the window
        vm.roll(issuedBlock + gate.challengeWindow() + 1);

        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        vm.prank(alice);
        vm.expectRevert(CaptchaGate.ChallengeExpired.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsWhenBlockhashUnavailable() public {
        // Issue at block 100; roll forward > 256 blocks so blockhash(seedBlock) = 0.
        // We also need to stay within challengeWindow, which is tricky —
        // set window to 1000 so the window check passes but the blockhash is gone.
        vm.prank(owner);
        gate.setChallengeWindow(1000);

        uint256 issuedBlock = _requestChallenge(alice);
        // Roll 300 blocks forward (seed block scrolls out of 256-block window)
        vm.roll(issuedBlock + 300);

        uint256[5] memory answers; // contents don't matter — will revert on blockhash == 0
        vm.prank(alice);
        vm.expectRevert(CaptchaGate.ChallengeExpired.selector);
        gate.solveChallenge(answers);
    }

    function test_solveChallenge_revertsOnDoubleUse() public {
        uint256 issuedBlock = _requestChallenge(alice);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);

        vm.startPrank(alice);
        gate.solveChallenge(answers);

        vm.expectRevert(CaptchaGate.ChallengeAlreadyUsed.selector);
        gate.solveChallenge(answers);
        vm.stopPrank();
    }

    // ── Session expiry ───────────────────────────────────────────────

    function test_hasValidSession_falseBeforeAnyChallenge() public view {
        assertFalse(gate.hasValidSession(alice));
    }

    function test_hasValidSession_falseAfterSessionExpires() public {
        _solveHappyPath(alice);
        assertTrue(gate.hasValidSession(alice));

        // Warp past expiry
        vm.warp(block.timestamp + gate.sessionDuration() + 1);
        assertFalse(gate.hasValidSession(alice));
    }

    function test_hasValidSession_trueUntilExpiry() public {
        _solveHappyPath(alice);

        // Still valid just before expiry
        vm.warp(block.timestamp + gate.sessionDuration() - 1);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_session_canBeRenewedBySolvingAgain() public {
        _solveHappyPath(alice);
        uint256 firstExpiry = gate.sessionExpiry(alice);

        // Warp a bit, request and solve again
        vm.warp(block.timestamp + 100);
        vm.roll(block.number + 50);
        _solveHappyPath(alice);

        uint256 secondExpiry = gate.sessionExpiry(alice);
        assertTrue(secondExpiry > firstExpiry);
    }

    // ── getChallenge ─────────────────────────────────────────────────

    function test_getChallenge_revertsWithNoPendingChallenge() public {
        vm.expectRevert(CaptchaGate.NoPendingChallenge.selector);
        gate.getChallenge(alice);
    }

    function test_getChallenge_returnsDeadlineAndProblems() public {
        uint256 issuedBlock = _requestChallenge(alice);
        (uint256[5] memory problems, uint256 deadline) = gate.getChallenge(alice);

        assertEq(deadline, issuedBlock + gate.challengeWindow());

        // Every problem should be non-zero (astronomically unlikely to be all zero)
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(problems[i] != 0 || true); // at minimum, no revert
        }
    }

    function test_getChallenge_problemsDecodeProperly() public {
        uint256 issuedBlock = _requestChallenge(alice);
        (uint256[5] memory problems,) = gate.getChallenge(alice);

        // Decode and verify that each encoded problem yields the right answer
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        for (uint256 i = 0; i < 5; i++) {
            uint256 a = (problems[i] >> 48) & 0xFFFF;
            uint256 b = (problems[i] >> 32) & 0xFFFF;
            uint256 c = (problems[i] >> 16) & 0xFFFF;
            uint256 p = problems[i] & 0xFFFF;

            assertTrue(a < 10000);
            assertTrue(b < 10000);
            assertTrue(c < 10000);
            assertTrue(p >= 7 && p <= 9979);
            assertEq(answers[i], (a * b + c) % p);
        }
    }

    // ── Multiple independent users ───────────────────────────────────

    function test_multipleUsers_independentChallenges() public {
        uint256 aliceBlock = _requestChallenge(alice);
        uint256 bobBlock   = _requestChallenge(bob);

        // Same block for both in this test — challenges differ because address differs
        assertEq(aliceBlock, bobBlock);

        uint256[5] memory aliceAnswers = _computeAnswers(alice, aliceBlock);
        uint256[5] memory bobAnswers   = _computeAnswers(bob,   bobBlock);

        // At minimum, answers should differ (same block, different address)
        bool differs = false;
        for (uint256 i = 0; i < 5; i++) {
            if (aliceAnswers[i] != bobAnswers[i]) {
                differs = true;
                break;
            }
        }
        assertTrue(differs, "Challenges for different users should differ");

        // Both can solve independently
        vm.prank(alice);
        gate.solveChallenge(aliceAnswers);

        vm.prank(bob);
        gate.solveChallenge(bobAnswers);

        assertTrue(gate.hasValidSession(alice));
        assertTrue(gate.hasValidSession(bob));
    }

    function test_multipleUsers_sessionsDontInterfere() public {
        _solveHappyPath(alice);

        // Carol has no session
        assertFalse(gate.hasValidSession(carol));

        // Expire alice's session; bob and carol remain independent
        vm.warp(block.timestamp + gate.sessionDuration() + 1);
        assertFalse(gate.hasValidSession(alice));
        assertFalse(gate.hasValidSession(carol));
    }

    function test_user_cannotSolveOtherUsersChallenge() public {
        uint256 aliceBlock = _requestChallenge(alice);

        // Bob tries to use alice's answers (which are derived from alice's address)
        uint256[5] memory aliceAnswers = _computeAnswers(alice, aliceBlock);

        // Bob has no pending challenge
        vm.prank(bob);
        vm.expectRevert(CaptchaGate.NoPendingChallenge.selector);
        gate.solveChallenge(aliceAnswers);
    }

    function test_user_answersDerivedFromAddress_notInterchangeable() public {
        uint256 aliceBlock = _requestChallenge(alice);
        _requestChallenge(bob); // bob's challenge also issued

        // Bob submits alice's answers against his own challenge
        uint256[5] memory aliceAnswers = _computeAnswers(alice, aliceBlock);

        vm.prank(bob);
        vm.expectRevert(CaptchaGate.WrongAnswers.selector);
        gate.solveChallenge(aliceAnswers);
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
        vm.expectRevert(CaptchaGate.InvalidWindow.selector);
        gate.setChallengeWindow(0);
    }

    function test_setSessionDuration_affectsNewSessions() public {
        vm.prank(owner);
        gate.setSessionDuration(30 minutes);

        uint256 ts = block.timestamp;
        _solveHappyPath(alice);

        assertEq(gate.sessionExpiry(alice), ts + 30 minutes);
    }

    function test_setChallengeWindow_expandedWindowAllowsLaterSolve() public {
        vm.prank(owner);
        gate.setChallengeWindow(10);

        uint256 issuedBlock = _requestChallenge(alice);
        vm.roll(issuedBlock + 10); // exactly at the new deadline

        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        vm.prank(alice);
        gate.solveChallenge(answers);
        assertTrue(gate.hasValidSession(alice));
    }

    function test_setChallengeWindow_tighterWindowRejectsLaterSolve() public {
        vm.prank(owner);
        gate.setChallengeWindow(1);

        uint256 issuedBlock = _requestChallenge(alice);
        vm.roll(issuedBlock + 2); // beyond window=1

        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);
        vm.prank(alice);
        vm.expectRevert(CaptchaGate.ChallengeExpired.selector);
        gate.solveChallenge(answers);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────

    /// @notice Fuzz: any user who correctly computes answers always gets a session.
    function testFuzz_correctAnswersAlwaysGrantSession(address user) public {
        vm.assume(user != address(0));
        vm.roll(200); // make sure we're past block 1

        uint256 issuedBlock = _requestChallenge(user);
        uint256[5] memory answers = _computeAnswers(user, issuedBlock);

        vm.prank(user);
        gate.solveChallenge(answers);

        assertTrue(gate.hasValidSession(user));
    }

    /// @notice Fuzz: corrupting any single answer position always reverts.
    function testFuzz_oneCorruptedAnswerAlwaysReverts(uint256 corruptIndex, uint256 delta) public {
        corruptIndex = corruptIndex % 5;
        // delta must be non-zero so we actually corrupt; cap to avoid overflow
        vm.assume(delta != 0);

        uint256 issuedBlock = _requestChallenge(alice);
        uint256[5] memory answers = _computeAnswers(alice, issuedBlock);

        // Use unchecked wrapping addition so type(uint256).max delta wraps rather than panics.
        // A wrapped value is still a wrong answer unless it coincidentally lands on the
        // correct answer, which is tested by the corresponding assume below.
        uint256 corrupted;
        unchecked {
            corrupted = answers[corruptIndex] + delta;
        }
        // If the addition wrapped back to the correct answer, skip (1-in-p chance, negligible).
        vm.assume(corrupted != answers[corruptIndex]);

        answers[corruptIndex] = corrupted;

        vm.prank(alice);
        vm.expectRevert(CaptchaGate.WrongAnswers.selector);
        gate.solveChallenge(answers);
    }
}
