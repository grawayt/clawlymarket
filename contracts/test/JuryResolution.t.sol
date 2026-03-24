// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {JuryResolution} from "../src/JuryResolution.sol";
import {ModelRegistry, IGroth16Verifier} from "../src/ModelRegistry.sol";
import {MockCaptchaGate} from "./mocks/MockCaptchaGate.sol";

// ── Mock ZK verifier (always returns true) ────────────────────────────────────

contract MockVerifierJ is IGroth16Verifier {
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[2] calldata)
        external
        pure
        override
        returns (bool)
    {
        return true;
    }
}

// ── Test Suite ────────────────────────────────────────────────────────────────

contract JuryResolutionTest is Test {
    // Protocol contracts
    ClawliaToken public token;
    ModelRegistry public modelRegistry;
    MockVerifierJ public verifier;
    JuryResolution public jury;
    MockCaptchaGate public captchaGate;

    // Addresses
    address owner = makeAddr("owner");
    address fakeRegistry = makeAddr("fakeRegistry"); // used to mint without full ZK flow

    // Jurors — five verified models
    address juror1 = makeAddr("juror1");
    address juror2 = makeAddr("juror2");
    address juror3 = makeAddr("juror3");
    address juror4 = makeAddr("juror4");
    address juror5 = makeAddr("juror5");

    // Other participants
    address alice = makeAddr("alice");   // market creator / bettor
    address bob   = makeAddr("bob");     // bettor

    // Time constants
    uint256 constant RESOLUTION_TIME = 2_000_000;

    // Pubkey hash used in mock registration
    uint256 constant PUBKEY_HASH = 99999;

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.startPrank(owner);

        // Deploy infrastructure
        token        = new ClawliaToken(owner);
        verifier     = new MockVerifierJ();
        modelRegistry = new ModelRegistry(address(token), address(verifier), owner);
        token.setModelRegistry(address(modelRegistry));
        modelRegistry.addApprovedPubkeyHash(PUBKEY_HASH);

        // Deploy JuryResolution; whitelist it so it can send CLAW (fees)
        jury = new JuryResolution(address(token), address(modelRegistry), owner);
        token.whitelistAddress(address(jury));

        // Deploy mock captcha gate (always returns true — no challenge solving in tests)
        captchaGate = new MockCaptchaGate();

        vm.stopPrank();

        // Register jurors and participants via mock ZK proof
        _register(juror1, 1001);
        _register(juror2, 1002);
        _register(juror3, 1003);
        _register(juror4, 1004);
        _register(juror5, 1005);
        _register(alice,  2001);
        _register(bob,    2002);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// @dev Register an address via the ModelRegistry mock ZK flow.
    function _register(address model, uint256 nullifier) internal {
        uint[2] memory pA = [uint(1), uint(2)];
        uint[2][2] memory pB = [[uint(3), uint(4)], [uint(5), uint(6)]];
        uint[2] memory pC = [uint(7), uint(8)];
        vm.prank(model);
        modelRegistry.register(pA, pB, pC, nullifier, PUBKEY_HASH);
    }

    /// @dev Deploy a PredictionMarket whose resolver IS the JuryResolution contract.
    function _deployJuryMarket() internal returns (PredictionMarket) {
        PredictionMarket market = new PredictionMarket(
            address(token),
            address(captchaGate),
            "Will Claude 4 Opus pass the ARC-AGI benchmark by 2026?",
            RESOLUTION_TIME,
            address(jury) // JuryResolution is the resolver
        );
        vm.prank(owner);
        token.whitelistAddress(address(market));
        return market;
    }

    /// @dev Deploy a market with a plain resolver (NOT the jury).
    function _deployPlainMarket(address resolver) internal returns (PredictionMarket) {
        PredictionMarket market = new PredictionMarket(
            address(token),
            address(captchaGate),
            "Plain market",
            RESOLUTION_TIME,
            resolver
        );
        vm.prank(owner);
        token.whitelistAddress(address(market));
        return market;
    }

    /// @dev Have `user` add liquidity to `market`.
    function _addLiquidity(PredictionMarket market, address user, uint256 amount) internal {
        vm.startPrank(user);
        token.approve(address(market), amount);
        market.addLiquidity(amount);
        vm.stopPrank();
    }

    /// @dev Have `user` buy outcome tokens.
    function _buy(PredictionMarket market, address user, uint256 outcome, uint256 amount) internal {
        vm.startPrank(user);
        token.approve(address(market), amount);
        market.buy(outcome, amount, 0);
        vm.stopPrank();
    }

    /// @dev Build a canonical 5-juror array using the test jurors.
    function _panel() internal view returns (address[5] memory) {
        return [juror1, juror2, juror3, juror4, juror5];
    }

    /// @dev Fund the jury contract with CLAW so it can pay fees.
    ///      Transfers from alice (has 1000 CLAW from registration).
    function _fundJury(uint256 amount) internal {
        vm.prank(alice);
        token.transfer(address(jury), amount);
    }

    // ── Panel Creation ────────────────────────────────────────────────────────

    function test_requestResolution_success() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market), _panel());

        assertTrue(jury.panelExists(address(market)));

        (, , , , , uint256 deadline, bool resolved,) = jury.getPanel(address(market));
        assertFalse(resolved);
        assertEq(deadline, RESOLUTION_TIME + jury.votingWindow());
    }

    function test_requestResolution_panelJurorsStored() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market), _panel());

        (address[5] memory jurors,,,,,,, ) = jury.getPanel(address(market));
        assertEq(jurors[0], juror1);
        assertEq(jurors[1], juror2);
        assertEq(jurors[2], juror3);
        assertEq(jurors[3], juror4);
        assertEq(jurors[4], juror5);
    }

    function test_isJuror_trueForPanelMembers() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        assertTrue(jury.isJuror(address(market), juror1));
        assertTrue(jury.isJuror(address(market), juror3));
        assertFalse(jury.isJuror(address(market), alice));
    }

    // ── Panel Eligibility Checks ──────────────────────────────────────────────

    function test_requestResolution_tooEarly_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME - 1);

        vm.expectRevert(JuryResolution.MarketNotEligible.selector);
        jury.requestResolution(address(market), _panel());
    }

    function test_requestResolution_alreadyResolved_reverts() public {
        // Use a plain resolver so we can resolve directly
        PredictionMarket market = _deployPlainMarket(alice);
        vm.warp(RESOLUTION_TIME);
        vm.prank(alice);
        market.resolve(0);

        vm.expectRevert(JuryResolution.MarketAlreadyResolved.selector);
        jury.requestResolution(address(market), _panel());
    }

    function test_requestResolution_panelAlreadyExists_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market), _panel());

        vm.expectRevert(JuryResolution.PanelAlreadyExists.selector);
        jury.requestResolution(address(market), _panel());
    }

    function test_requestResolution_unverifiedJuror_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        address unverified = makeAddr("unverified");
        address[5] memory badPanel = [juror1, juror2, juror3, juror4, unverified];

        vm.expectRevert(abi.encodeWithSelector(JuryResolution.JurorNotVerified.selector, unverified));
        jury.requestResolution(address(market), badPanel);
    }

    function test_requestResolution_jurorHoldsYesPosition_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);

        // juror1 buys YES tokens — now ineligible
        _buy(market, juror1, 0 /* YES */, 50e18);

        vm.warp(RESOLUTION_TIME);

        address[5] memory badPanel = [juror1, juror2, juror3, juror4, juror5];
        vm.expectRevert(abi.encodeWithSelector(JuryResolution.JurorHoldsPosition.selector, juror1));
        jury.requestResolution(address(market), badPanel);
    }

    function test_requestResolution_jurorHoldsNoPosition_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);

        // juror2 buys NO tokens — now ineligible
        _buy(market, juror2, 1 /* NO */, 50e18);

        vm.warp(RESOLUTION_TIME);

        address[5] memory badPanel = [juror1, juror2, juror3, juror4, juror5];
        vm.expectRevert(abi.encodeWithSelector(JuryResolution.JurorHoldsPosition.selector, juror2));
        jury.requestResolution(address(market), badPanel);
    }

    function test_requestResolution_duplicateJuror_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        // juror1 appears twice
        address[5] memory badPanel = [juror1, juror2, juror3, juror1, juror5];
        vm.expectRevert(abi.encodeWithSelector(JuryResolution.DuplicateJuror.selector, juror1));
        jury.requestResolution(address(market), badPanel);
    }

    // ── Voting Mechanics ──────────────────────────────────────────────────────

    function test_vote_singleJuror_recorded() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        jury.vote(address(market), 0 /* YES */);

        (, bool[5] memory hasVoted, uint256[5] memory votes, uint256 yesVotes,,,,) =
            jury.getPanel(address(market));
        assertTrue(hasVoted[0]);
        assertEq(votes[0], 0);
        assertEq(yesVotes, 1);
    }

    function test_vote_notAJuror_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(alice);
        vm.expectRevert(JuryResolution.NotAJuror.selector);
        jury.vote(address(market), 0);
    }

    function test_vote_doubleVote_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        jury.vote(address(market), 0);

        vm.prank(juror1);
        vm.expectRevert(JuryResolution.AlreadyVoted.selector);
        jury.vote(address(market), 1);
    }

    function test_vote_afterDeadline_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // Warp past the voting window
        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        vm.prank(juror1);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);
    }

    function test_vote_invalidOutcome_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        vm.expectRevert(JuryResolution.InvalidOutcome.selector);
        jury.vote(address(market), 2);
    }

    // ── Auto-Resolution on Majority ───────────────────────────────────────────

    function test_vote_autoResolves_onYesMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        jury.vote(address(market), 0 /* YES */);
        vm.prank(juror2);
        jury.vote(address(market), 0);
        vm.prank(juror3);
        jury.vote(address(market), 0); // 3rd YES vote — triggers resolution

        assertTrue(market.resolved());
        assertEq(market.outcome(), 0);
    }

    function test_vote_autoResolves_onNoMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        jury.vote(address(market), 1 /* NO */);
        vm.prank(juror2);
        jury.vote(address(market), 1);
        vm.prank(juror3);
        jury.vote(address(market), 1); // 3rd NO vote — triggers resolution

        assertTrue(market.resolved());
        assertEq(market.outcome(), 1);
    }

    function test_vote_noResolutionBeforeMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1);
        jury.vote(address(market), 0);
        vm.prank(juror2);
        jury.vote(address(market), 0); // only 2 YES votes

        assertFalse(market.resolved());
    }

    function test_vote_splitVotesNoResolution() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // 2 YES, 2 NO — no majority
        vm.prank(juror1);
        jury.vote(address(market), 0);
        vm.prank(juror2);
        jury.vote(address(market), 1);
        vm.prank(juror3);
        jury.vote(address(market), 0);
        vm.prank(juror4);
        jury.vote(address(market), 1);

        assertFalse(market.resolved());
    }

    function test_vote_panelResolved_flagSet() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 0);
        vm.prank(juror3); jury.vote(address(market), 0);

        (,,,,, , bool panelResolved, uint256 panelOutcome) = jury.getPanel(address(market));
        assertTrue(panelResolved);
        assertEq(panelOutcome, 0);
    }

    // ── Juror Fees ────────────────────────────────────────────────────────────

    function test_fees_distributedToVotingJurors() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // Fund jury contract with enough CLAW for 3 fees (the voters)
        _fundJury(jury.jurorFee() * 5);

        uint256 j1Before = token.balanceOf(juror1);
        uint256 j2Before = token.balanceOf(juror2);
        uint256 j3Before = token.balanceOf(juror3);
        uint256 j4Before = token.balanceOf(juror4); // will not vote

        vm.prank(juror1); jury.vote(address(market), 1);
        vm.prank(juror2); jury.vote(address(market), 1);
        vm.prank(juror3); jury.vote(address(market), 1); // triggers resolution

        // Voters receive fees
        assertEq(token.balanceOf(juror1), j1Before + jury.jurorFee());
        assertEq(token.balanceOf(juror2), j2Before + jury.jurorFee());
        assertEq(token.balanceOf(juror3), j3Before + jury.jurorFee());
        // Non-voter does not
        assertEq(token.balanceOf(juror4), j4Before);
    }

    function test_fees_notDistributed_ifContractUnderfunded() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // Do NOT fund the jury contract — resolution should still succeed
        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 0);
        vm.prank(juror3); jury.vote(address(market), 0);

        assertTrue(market.resolved()); // resolution still happened
    }

    // ── Privileged Juror Handling ─────────────────────────────────────────────

    function test_addPrivilegedJuror_onlyOwner() public {
        address haiku = makeAddr("haiku");

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        assertTrue(jury.privilegedJurors(haiku));
    }

    function test_addPrivilegedJuror_nonOwner_reverts() public {
        address haiku = makeAddr("haiku");

        vm.prank(alice);
        vm.expectRevert();
        jury.addPrivilegedJuror(haiku);
    }

    function test_removePrivilegedJuror() public {
        address haiku = makeAddr("haiku");

        vm.startPrank(owner);
        jury.addPrivilegedJuror(haiku);
        jury.removePrivilegedJuror(haiku);
        vm.stopPrank();

        assertFalse(jury.privilegedJurors(haiku));
    }

    function test_privilegedJuror_participatesNormally() public {
        // Register a haiku model and designate it privileged
        address haiku = makeAddr("haiku");
        _register(haiku, 3001);

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        // Build panel with haiku replacing juror5
        address[5] memory panelWithHaiku = [juror1, juror2, juror3, juror4, haiku];
        jury.requestResolution(address(market), panelWithHaiku);

        // Haiku votes — should work fine
        vm.prank(haiku);
        jury.vote(address(market), 0);

        (, bool[5] memory hasVoted,,, ,,, ) = jury.getPanel(address(market));
        assertTrue(hasVoted[4]);
    }

    function test_privilegedJuror_withPosition_stillBlocked() public {
        // Even privileged jurors cannot serve if they hold a position
        address haiku = makeAddr("haiku");
        _register(haiku, 3002);

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);
        _buy(market, haiku, 0, 10e18); // haiku buys YES

        vm.warp(RESOLUTION_TIME);

        address[5] memory badPanel = [juror1, juror2, juror3, juror4, haiku];
        vm.expectRevert(abi.encodeWithSelector(JuryResolution.JurorHoldsPosition.selector, haiku));
        jury.requestResolution(address(market), badPanel);
    }

    // ── Owner Configuration ───────────────────────────────────────────────────

    function test_setVotingWindow() public {
        vm.prank(owner);
        jury.setVotingWindow(48 hours);
        assertEq(jury.votingWindow(), 48 hours);
    }

    function test_setVotingWindow_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        jury.setVotingWindow(1 hours);
    }

    function test_setJurorFee() public {
        vm.prank(owner);
        jury.setJurorFee(25e18);
        assertEq(jury.jurorFee(), 25e18);
    }

    function test_setJurorFee_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        jury.setJurorFee(1e18);
    }

    // ── Events ────────────────────────────────────────────────────────────────

    function test_event_PanelConvened() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        address[5] memory panelArr = _panel();
        uint256 expectedDeadline = RESOLUTION_TIME + jury.votingWindow();

        vm.expectEmit(true, false, false, true);
        emit JuryResolution.PanelConvened(address(market), panelArr, expectedDeadline);

        jury.requestResolution(address(market), panelArr);
    }

    function test_event_VoteCast() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.expectEmit(true, true, false, true);
        emit JuryResolution.VoteCast(address(market), juror1, 0);

        vm.prank(juror1);
        jury.vote(address(market), 0);
    }

    function test_event_MarketResolved() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 0);

        vm.expectEmit(true, false, false, true);
        emit JuryResolution.MarketResolved(address(market), 0);

        vm.prank(juror3);
        jury.vote(address(market), 0);
    }

    // ── Edge Cases ────────────────────────────────────────────────────────────

    function test_edgeCase_allFiveVote_majority3() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // All 5 vote YES — resolution happens on vote #3, votes #4 and #5 would hit
        // VotingWindowClosed because the panel is already resolved... actually the
        // market is resolved but the panel voting window may still be open.
        // After resolution the market.resolve() is called; subsequent votes attempt
        // to call jury.vote() but the market is already resolved. The panel's
        // resolved flag is set; however, our vote() function does NOT check
        // panel.resolved — it simply records votes. This is intentional: we want
        // late voters to still be recorded (for fee distribution that may come later).
        // But the auto-resolve path will call market.resolve() again on vote 4 and 5
        // which reverts with MarketResolved. Let's verify that votes 4+ are still
        // accepted without triggering a second resolution call.
        //
        // Actually: once panel.resolved is true, _resolve() would be called again on
        // the 4th YES vote. market.resolve() would revert with MarketResolved.
        //
        // Solution: check panel.resolved in vote() before calling _resolve().
        // This is already the correct behavior expected — let's verify it.

        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 0);
        vm.prank(juror3); jury.vote(address(market), 0); // resolves here

        // juror4 and juror5 vote after resolution — must not revert on double-resolve
        vm.prank(juror4); jury.vote(address(market), 0);
        vm.prank(juror5); jury.vote(address(market), 0);

        assertTrue(market.resolved());
        assertEq(market.outcome(), 0);
    }

    function test_edgeCase_voteAtExactDeadline() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        uint256 deadline = RESOLUTION_TIME + jury.votingWindow();
        vm.warp(deadline); // exactly at deadline — should be accepted (> not >=)

        vm.prank(juror1);
        jury.vote(address(market), 1); // should succeed

        (, bool[5] memory hasVoted,,,,,,) = jury.getPanel(address(market));
        assertTrue(hasVoted[0]);
    }

    function test_edgeCase_voteOneSecondAfterDeadline_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        vm.prank(juror1);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);
    }

    function test_edgeCase_unresolvableMarket_deadlineExpires() public {
        // If nobody reaches majority before the deadline, market stays unresolved.
        // The emergencyWithdraw path on PredictionMarket handles this case.
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market), _panel());

        // Only 2 jurors vote (split) — no majority
        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 1);

        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        // Market still not resolved — all future votes fail with VotingWindowClosed
        vm.prank(juror3);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);

        assertFalse(market.resolved());
    }

    function test_edgeCase_differentMarketsIndependent() public {
        // Two separate markets each get their own independent panels
        PredictionMarket market1 = _deployJuryMarket();
        PredictionMarket market2 = _deployJuryMarket();

        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market1), _panel());

        // Register fresh jurors for market2 to avoid overlap (though overlap is allowed
        // across different markets, only duplicates *within* a panel are forbidden)
        address j6 = makeAddr("juror6");
        address j7 = makeAddr("juror7");
        address j8 = makeAddr("juror8");
        address j9 = makeAddr("juror9");
        address j10 = makeAddr("juror10");
        _register(j6,  4001);
        _register(j7,  4002);
        _register(j8,  4003);
        _register(j9,  4004);
        _register(j10, 4005);

        address[5] memory panel2 = [j6, j7, j8, j9, j10];
        jury.requestResolution(address(market2), panel2);

        // Resolve market1 with YES
        vm.prank(juror1); jury.vote(address(market1), 0);
        vm.prank(juror2); jury.vote(address(market1), 0);
        vm.prank(juror3); jury.vote(address(market1), 0);

        // Resolve market2 with NO
        vm.prank(j6);  jury.vote(address(market2), 1);
        vm.prank(j7);  jury.vote(address(market2), 1);
        vm.prank(j8);  jury.vote(address(market2), 1);

        assertTrue(market1.resolved());
        assertEq(market1.outcome(), 0);
        assertTrue(market2.resolved());
        assertEq(market2.outcome(), 1);
    }

    function test_edgeCase_juryResolutionMustBeResolver() public {
        // A plain market (not using JuryResolution as resolver) cannot be resolved by jury.vote()
        address plainResolver = makeAddr("plainResolver");
        PredictionMarket market = _deployPlainMarket(plainResolver);

        vm.warp(RESOLUTION_TIME);

        // Panel creation is allowed — anyone can convene a panel for any eligible market
        jury.requestResolution(address(market), _panel());

        // But when 3 votes come in and jury calls market.resolve(), it will revert because
        // jury is not the resolver for this market.
        vm.prank(juror1); jury.vote(address(market), 0);
        vm.prank(juror2); jury.vote(address(market), 0);

        // Third vote triggers _resolve() -> market.resolve() -> NotResolver revert
        vm.prank(juror3);
        vm.expectRevert(PredictionMarket.NotResolver.selector);
        jury.vote(address(market), 0);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_setVotingWindow(uint256 newWindow) public {
        newWindow = bound(newWindow, 1 hours, 30 days);
        vm.prank(owner);
        jury.setVotingWindow(newWindow);
        assertEq(jury.votingWindow(), newWindow);
    }

    function testFuzz_setJurorFee(uint256 newFee) public {
        newFee = bound(newFee, 0, 1000e18);
        vm.prank(owner);
        jury.setJurorFee(newFee);
        assertEq(jury.jurorFee(), newFee);
    }
}
