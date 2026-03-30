// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console} from "forge-std/Test.sol";
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

    // Pool of 10 registered model addresses for jury selection
    address[10] public models;

    // Participants (registered but used as bettors / market creators)
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

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

        // Register 10 models as the jury pool
        for (uint256 i = 0; i < 10; i++) {
            models[i] = makeAddr(string(abi.encodePacked("model", i)));
            _register(models[i], 1000 + i);
        }

        // Register participants
        _register(alice, 2001);
        _register(bob,   2002);
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

    /// @dev Fund the jury contract with CLAW so it can pay fees.
    ///      Transfers from alice (has 1000 CLAW from registration).
    function _fundJury(uint256 amount) internal {
        vm.prank(alice);
        token.transfer(address(jury), amount);
    }

    /// @dev Return the panel jurors for a market.
    function _getPanelJurors(address market) internal view returns (address[5] memory jurors) {
        (jurors,,,,,,, ) = jury.getPanel(market);
    }

    // ── Panel Creation ────────────────────────────────────────────────────────

    function test_requestResolution_success() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        assertTrue(jury.panelExists(address(market)));

        (, , , , , uint256 deadline, bool resolved,) = jury.getPanel(address(market));
        assertFalse(resolved);
        assertEq(deadline, RESOLUTION_TIME + jury.votingWindow());
    }

    function test_requestResolution_panelHasFiveJurors() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(jurors[i] != address(0), "Juror slot should be filled");
        }
    }

    function test_requestResolution_jurorsFromRegisteredPool() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(
                modelRegistry.isVerified(jurors[i]),
                "Each juror must be a registered model"
            );
        }
    }

    function test_requestResolution_noDuplicateJurors() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));
        for (uint256 i = 0; i < 5; i++) {
            for (uint256 j = i + 1; j < 5; j++) {
                assertTrue(jurors[i] != jurors[j], "No duplicate jurors in panel");
            }
        }
    }

    function test_isJuror_trueForPanelMembers() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(jury.isJuror(address(market), jurors[i]));
        }
        assertFalse(jury.isJuror(address(market), alice));
    }

    // ── Panel Eligibility Checks ──────────────────────────────────────────────

    function test_requestResolution_tooEarly_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME - 1);

        vm.expectRevert(JuryResolution.MarketNotEligible.selector);
        jury.requestResolution(address(market));
    }

    function test_requestResolution_alreadyResolved_reverts() public {
        // Use a plain resolver so we can resolve directly
        PredictionMarket market = _deployPlainMarket(alice);
        vm.warp(RESOLUTION_TIME);
        vm.prank(alice);
        market.resolve(0);

        vm.expectRevert(JuryResolution.MarketAlreadyResolved.selector);
        jury.requestResolution(address(market));
    }

    function test_requestResolution_panelAlreadyExists_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        vm.expectRevert(JuryResolution.PanelAlreadyExists.selector);
        jury.requestResolution(address(market));
    }

    function test_requestResolution_jurorsWithPositions_excluded() public {
        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);

        // Exclude the first 5 pool models by giving them a YES position
        for (uint256 i = 0; i < 5; i++) {
            _buy(market, models[i], 0 /* YES */, 5e18);
        }

        vm.warp(RESOLUTION_TIME);

        // Should succeed — models[5] through models[9] are still eligible
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));
        for (uint256 i = 0; i < 5; i++) {
            // No selected juror should hold a YES position
            assertEq(
                PredictionMarket(address(market)).balanceOf(jurors[i], 0),
                0,
                "Juror with YES position must be excluded"
            );
        }
    }

    function test_requestResolution_notEnoughEligible_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);

        // Give all 10 pool models a position — only alice and bob remain registered
        // with no positions, but that is only 2 eligible — not enough for 5.
        for (uint256 i = 0; i < 10; i++) {
            _buy(market, models[i], 0 /* YES */, 5e18);
        }

        vm.warp(RESOLUTION_TIME);

        vm.expectRevert(JuryResolution.NotEnoughEligibleJurors.selector);
        jury.requestResolution(address(market));
    }

    // ── Voting Mechanics ──────────────────────────────────────────────────────

    function test_vote_singleJuror_recorded() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]);
        jury.vote(address(market), 0 /* YES */);

        (, bool[5] memory hasVoted,,,,,,) = jury.getPanel(address(market));
        assertTrue(hasVoted[0]);
    }

    function test_vote_notAJuror_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        vm.prank(alice);
        vm.expectRevert(JuryResolution.NotAJuror.selector);
        jury.vote(address(market), 0);
    }

    function test_vote_doubleVote_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]);
        jury.vote(address(market), 0);

        vm.prank(jurors[0]);
        vm.expectRevert(JuryResolution.AlreadyVoted.selector);
        jury.vote(address(market), 1);
    }

    function test_vote_afterDeadline_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // Warp past the voting window
        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        vm.prank(jurors[0]);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);
    }

    function test_vote_invalidOutcome_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]);
        vm.expectRevert(JuryResolution.InvalidOutcome.selector);
        jury.vote(address(market), 2);
    }

    // ── Auto-Resolution on Majority ───────────────────────────────────────────

    function test_vote_autoResolves_onYesMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 0 /* YES */);
        vm.prank(jurors[1]); jury.vote(address(market), 0);
        vm.prank(jurors[2]); jury.vote(address(market), 0); // 3rd YES — triggers resolution

        assertTrue(market.resolved());
        assertEq(market.outcome(), 0);
    }

    function test_vote_autoResolves_onNoMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 1 /* NO */);
        vm.prank(jurors[1]); jury.vote(address(market), 1);
        vm.prank(jurors[2]); jury.vote(address(market), 1); // 3rd NO — triggers resolution

        assertTrue(market.resolved());
        assertEq(market.outcome(), 1);
    }

    function test_vote_noResolutionBeforeMajority() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0); // only 2 YES votes

        assertFalse(market.resolved());
    }

    function test_vote_splitVotesNoResolution() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // 2 YES, 2 NO — no majority
        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 1);
        vm.prank(jurors[2]); jury.vote(address(market), 0);
        vm.prank(jurors[3]); jury.vote(address(market), 1);

        assertFalse(market.resolved());
    }

    function test_vote_panelResolved_flagSet() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0);
        vm.prank(jurors[2]); jury.vote(address(market), 0);

        (,,,,, , bool panelResolved, uint256 panelOutcome) = jury.getPanel(address(market));
        assertTrue(panelResolved);
        assertEq(panelOutcome, 0);
    }

    // ── Juror Fees ────────────────────────────────────────────────────────────

    function test_fees_distributedToVotingJurors() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // Fund jury contract with enough CLAW for all 5 fees
        _fundJury(jury.jurorFee() * 5);

        uint256 j0Before = token.balanceOf(jurors[0]);
        uint256 j1Before = token.balanceOf(jurors[1]);
        uint256 j2Before = token.balanceOf(jurors[2]);
        uint256 j3Before = token.balanceOf(jurors[3]); // will not vote

        vm.prank(jurors[0]); jury.vote(address(market), 1);
        vm.prank(jurors[1]); jury.vote(address(market), 1);
        vm.prank(jurors[2]); jury.vote(address(market), 1); // triggers resolution

        // Voters receive fees
        assertEq(token.balanceOf(jurors[0]), j0Before + jury.jurorFee());
        assertEq(token.balanceOf(jurors[1]), j1Before + jury.jurorFee());
        assertEq(token.balanceOf(jurors[2]), j2Before + jury.jurorFee());
        // Non-voter does not
        assertEq(token.balanceOf(jurors[3]), j3Before);
    }

    function test_fees_notDistributed_ifContractUnderfunded() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // Do NOT fund the jury contract — resolution should still succeed
        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0);
        vm.prank(jurors[2]); jury.vote(address(market), 0);

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

    function test_privilegedJurors_getPriority() public {
        // Register a haiku model and designate it privileged
        address haiku = makeAddr("haiku");
        _register(haiku, 3001);

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        // Haiku must appear in the panel (privileged jurors get priority)
        assertTrue(jury.isJuror(address(market), haiku), "Privileged juror must be in panel");
    }

    function test_privilegedJuror_withPosition_excluded() public {
        // Even privileged jurors cannot serve if they hold a position
        address haiku = makeAddr("haiku");
        _register(haiku, 3002);

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        PredictionMarket market = _deployJuryMarket();
        _addLiquidity(market, alice, 100e18);
        _buy(market, haiku, 0, 10e18); // haiku buys YES

        vm.warp(RESOLUTION_TIME);

        // Panel selection should succeed but haiku must NOT be in the panel
        jury.requestResolution(address(market));

        assertFalse(jury.isJuror(address(market), haiku), "Privileged juror with position must be excluded");
    }

    function test_privilegedJuror_canVote() public {
        address haiku = makeAddr("haiku");
        _register(haiku, 3003);

        vm.prank(owner);
        jury.addPrivilegedJuror(haiku);

        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        // Haiku is in the panel (privileged priority); it can vote
        vm.prank(haiku);
        jury.vote(address(market), 0);

        address[5] memory jurors = _getPanelJurors(address(market));
        (, bool[5] memory hasVoted,,,,,,) = jury.getPanel(address(market));
        bool haikuVoted = false;
        for (uint256 i = 0; i < 5; i++) {
            if (jurors[i] == haiku && hasVoted[i]) {
                haikuVoted = true;
                break;
            }
        }
        assertTrue(haikuVoted, "Haiku must have voted");
    }

    function test_multiplePrivilegedJurors_allIncluded() public {
        // Register 5 privileged haiku models — they should fill all 5 slots
        address[5] memory haikuModels;
        for (uint256 i = 0; i < 5; i++) {
            haikuModels[i] = makeAddr(string(abi.encodePacked("haiku", i)));
            _register(haikuModels[i], 5000 + i);
            vm.prank(owner);
            jury.addPrivilegedJuror(haikuModels[i]);
        }

        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market));

        // All 5 privileged models must be in the panel
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(jury.isJuror(address(market), haikuModels[i]));
        }
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

        // Record logs — we can't pre-predict the juror array since selection is random
        vm.recordLogs();
        jury.requestResolution(address(market));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("PanelConvened(address,address[5],uint256)");
        bool found = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig && logs[i].topics[1] == bytes32(uint256(uint160(address(market))))) {
                found = true;
                break;
            }
        }
        assertTrue(found, "PanelConvened event must be emitted");
    }

    function test_event_VoteCast() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.expectEmit(true, true, false, true);
        emit JuryResolution.VoteCast(address(market), jurors[0], 0);

        vm.prank(jurors[0]);
        jury.vote(address(market), 0);
    }

    function test_event_MarketResolved() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0);

        vm.expectEmit(true, false, false, true);
        emit JuryResolution.MarketResolved(address(market), 0);

        vm.prank(jurors[2]);
        jury.vote(address(market), 0);
    }

    // ── Edge Cases ────────────────────────────────────────────────────────────

    function test_edgeCase_allFiveVote_majority3() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0);
        vm.prank(jurors[2]); jury.vote(address(market), 0); // resolves here

        // jurors[3] and jurors[4] vote after resolution — must not revert on double-resolve
        vm.prank(jurors[3]); jury.vote(address(market), 0);
        vm.prank(jurors[4]); jury.vote(address(market), 0);

        assertTrue(market.resolved());
        assertEq(market.outcome(), 0);
    }

    function test_edgeCase_voteAtExactDeadline() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        uint256 deadline = RESOLUTION_TIME + jury.votingWindow();
        vm.warp(deadline); // exactly at deadline — should be accepted (> not >=)

        vm.prank(jurors[0]);
        jury.vote(address(market), 1); // should succeed

        (, bool[5] memory hasVoted,,,,,,) = jury.getPanel(address(market));
        assertTrue(hasVoted[0]);
    }

    function test_edgeCase_voteOneSecondAfterDeadline_reverts() public {
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        vm.prank(jurors[0]);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);
    }

    function test_edgeCase_unresolvableMarket_deadlineExpires() public {
        // If nobody reaches majority before the deadline, market stays unresolved.
        PredictionMarket market = _deployJuryMarket();
        vm.warp(RESOLUTION_TIME);
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // Only 2 jurors vote (split) — no majority
        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 1);

        vm.warp(RESOLUTION_TIME + jury.votingWindow() + 1);

        // Market still not resolved — all future votes fail with VotingWindowClosed
        vm.prank(jurors[2]);
        vm.expectRevert(JuryResolution.VotingWindowClosed.selector);
        jury.vote(address(market), 0);

        assertFalse(market.resolved());
    }

    function test_edgeCase_differentMarketsIndependent() public {
        // Two separate markets each get their own independent panels
        PredictionMarket market1 = _deployJuryMarket();
        PredictionMarket market2 = _deployJuryMarket();

        vm.warp(RESOLUTION_TIME);

        jury.requestResolution(address(market1));
        jury.requestResolution(address(market2));

        address[5] memory jurors1 = _getPanelJurors(address(market1));
        address[5] memory jurors2 = _getPanelJurors(address(market2));

        // Resolve market1 with YES
        vm.prank(jurors1[0]); jury.vote(address(market1), 0);
        vm.prank(jurors1[1]); jury.vote(address(market1), 0);
        vm.prank(jurors1[2]); jury.vote(address(market1), 0);

        // Resolve market2 with NO
        vm.prank(jurors2[0]); jury.vote(address(market2), 1);
        vm.prank(jurors2[1]); jury.vote(address(market2), 1);
        vm.prank(jurors2[2]); jury.vote(address(market2), 1);

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
        jury.requestResolution(address(market));

        address[5] memory jurors = _getPanelJurors(address(market));

        // But when 3 votes come in and jury calls market.resolve(), it will revert because
        // jury is not the resolver for this market.
        vm.prank(jurors[0]); jury.vote(address(market), 0);
        vm.prank(jurors[1]); jury.vote(address(market), 0);

        // Third vote triggers _resolve() -> market.resolve() -> NotResolver revert
        vm.prank(jurors[2]);
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
