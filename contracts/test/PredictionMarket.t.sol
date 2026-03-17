// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

contract PredictionMarketTest is Test {
    ClawliaToken public token;
    PredictionMarket public market;

    address owner = makeAddr("owner");
    address registry = makeAddr("registry");
    address resolver = makeAddr("resolver");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant YES = 0;
    uint256 constant NO = 1;
    uint256 constant RESOLUTION_TIME = 1000000;

    function setUp() public {
        vm.startPrank(owner);
        token = new ClawliaToken(owner);
        token.setModelRegistry(registry);
        vm.stopPrank();

        market = new PredictionMarket(
            address(token),
            "Will GPT-5 pass the Turing test by 2027?",
            RESOLUTION_TIME,
            resolver
        );

        // Register and mint to alice and bob
        vm.startPrank(registry);
        token.registerAndMint(alice);
        token.registerAndMint(bob);
        vm.stopPrank();

        // Whitelist the market contract so it can receive/send CLAW
        vm.prank(owner);
        token.whitelistAddress(address(market));
    }

    // ── Liquidity ────────────────────────────────────────────────────

    function test_addLiquidity_first() public {
        _addLiquidity(alice, 500e18);

        assertEq(market.reserveYes(), 500e18);
        assertEq(market.reserveNo(), 500e18);
        assertEq(market.totalCollateral(), 500e18);
        assertEq(market.balanceOf(alice, YES), 500e18);
        assertEq(market.balanceOf(alice, NO), 500e18);
    }

    function test_addLiquidity_zeroAmount_reverts() public {
        vm.startPrank(alice);
        token.approve(address(market), 100e18);
        vm.expectRevert(PredictionMarket.ZeroAmount.selector);
        market.addLiquidity(0);
        vm.stopPrank();
    }

    function test_addLiquidity_afterResolution_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        vm.expectRevert(PredictionMarket.MarketResolved.selector);
        market.addLiquidity(100e18);
        vm.stopPrank();
    }

    function test_removeLiquidity() public {
        _addLiquidity(alice, 500e18);

        uint256 balBefore = token.balanceOf(alice);

        vm.prank(alice);
        uint256 collateral = market.removeLiquidity(250e18, 250e18);

        assertEq(collateral, 250e18);
        assertEq(token.balanceOf(alice), balBefore + 250e18);
        assertEq(market.reserveYes(), 250e18);
        assertEq(market.reserveNo(), 250e18);
    }

    // ── Buying ───────────────────────────────────────────────────────

    function test_buy_yes() public {
        _addLiquidity(alice, 500e18);

        uint256 bobBalBefore = token.balanceOf(bob);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        uint256 tokensOut = market.buy(YES, 100e18, 0);
        vm.stopPrank();

        assertTrue(tokensOut > 0, "Should receive YES tokens");
        assertEq(market.balanceOf(bob, YES), tokensOut);
        assertEq(token.balanceOf(bob), bobBalBefore - 100e18);
    }

    function test_buy_no() public {
        _addLiquidity(alice, 500e18);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        uint256 tokensOut = market.buy(NO, 100e18, 0);
        vm.stopPrank();

        assertTrue(tokensOut > 0, "Should receive NO tokens");
        assertEq(market.balanceOf(bob, NO), tokensOut);
    }

    function test_buy_slippage_protection() public {
        _addLiquidity(alice, 500e18);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        vm.expectRevert(PredictionMarket.SlippageExceeded.selector);
        market.buy(YES, 100e18, type(uint256).max);
        vm.stopPrank();
    }

    function test_buy_invalid_outcome_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        vm.expectRevert(PredictionMarket.InvalidOutcome.selector);
        market.buy(2, 100e18, 0);
        vm.stopPrank();
    }

    function test_buy_after_resolution_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        vm.expectRevert(PredictionMarket.MarketResolved.selector);
        market.buy(0, 100e18, 0);
        vm.stopPrank();
    }

    // ── Implied Probability ──────────────────────────────────────────

    function test_impliedProbability_initial() public {
        _addLiquidity(alice, 500e18);

        (uint256 yesBps, uint256 noBps) = market.getImpliedProbability();
        assertEq(yesBps, 5000);
        assertEq(noBps, 5000);
    }

    function test_impliedProbability_shifts_after_buy() public {
        _addLiquidity(alice, 500e18);

        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        market.buy(YES, 100e18, 0);
        vm.stopPrank();

        (uint256 yesBps, uint256 noBps) = market.getImpliedProbability();
        assertTrue(yesBps > 5000, "YES prob should increase after YES buy");
        assertTrue(noBps < 5000, "NO prob should decrease after YES buy");
        assertEq(yesBps + noBps, 10000, "Probabilities should sum to 100%");
    }

    function test_impliedProbability_empty() public view {
        (uint256 yesBps, uint256 noBps) = market.getImpliedProbability();
        assertEq(yesBps, 5000);
        assertEq(noBps, 5000);
    }

    // ── Resolution ───────────────────────────────────────────────────

    function test_resolve_yes() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        assertTrue(market.resolved());
        assertEq(market.outcome(), 0);
    }

    function test_resolve_no() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(1);

        assertTrue(market.resolved());
        assertEq(market.outcome(), 1);
    }

    function test_resolve_tooEarly_reverts() public {
        vm.warp(RESOLUTION_TIME - 1);
        vm.prank(resolver);
        vm.expectRevert(PredictionMarket.TooEarly.selector);
        market.resolve(0);
    }

    function test_resolve_notResolver_reverts() public {
        vm.warp(RESOLUTION_TIME);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.NotResolver.selector);
        market.resolve(0);
    }

    function test_resolve_doubleResolve_reverts() public {
        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        vm.prank(resolver);
        vm.expectRevert(PredictionMarket.MarketResolved.selector);
        market.resolve(1);
    }

    function test_resolve_invalidOutcome_reverts() public {
        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        vm.expectRevert(PredictionMarket.InvalidOutcome.selector);
        market.resolve(2);
    }

    // ── Redemption ───────────────────────────────────────────────────

    function test_redeem_winner() public {
        _addLiquidity(alice, 500e18);

        // Bob buys YES
        vm.startPrank(bob);
        token.approve(address(market), 100e18);
        uint256 yesTokens = market.buy(YES, 100e18, 0);
        vm.stopPrank();

        // Resolve: YES wins
        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        // Bob redeems
        uint256 bobBalBefore = token.balanceOf(bob);
        vm.prank(bob);
        market.redeem(yesTokens);

        assertTrue(token.balanceOf(bob) > bobBalBefore, "Bob should receive CLAW");
        assertEq(market.balanceOf(bob, YES), 0, "YES tokens should be burned");
    }

    function test_redeem_notResolved_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketNotResolved.selector);
        market.redeem(100e18);
    }

    // ── Emergency Withdraw ───────────────────────────────────────────

    function test_emergencyWithdraw() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME + 7 days + 1);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        market.emergencyWithdraw();

        assertTrue(token.balanceOf(alice) > balBefore, "Should receive CLAW back");
        assertEq(market.balanceOf(alice, YES), 0);
        assertEq(market.balanceOf(alice, NO), 0);
    }

    function test_emergencyWithdraw_tooEarly_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME + 7 days - 1);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.TooEarly.selector);
        market.emergencyWithdraw();
    }

    function test_emergencyWithdraw_afterResolution_reverts() public {
        _addLiquidity(alice, 500e18);

        vm.warp(RESOLUTION_TIME);
        vm.prank(resolver);
        market.resolve(0);

        vm.warp(RESOLUTION_TIME + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketResolved.selector);
        market.emergencyWithdraw();
    }

    // ── AMM Invariant (Fuzz) ─────────────────────────────────────────

    function testFuzz_buy_maintains_positive_reserves(uint256 amount) public {
        _addLiquidity(alice, 500e18);

        amount = bound(amount, 1e15, 900e18);

        vm.startPrank(bob);
        token.approve(address(market), amount);
        market.buy(YES, amount, 0);
        vm.stopPrank();

        assertTrue(market.reserveYes() > 0, "reserveYes should be positive");
        assertTrue(market.reserveNo() > 0, "reserveNo should be positive");
    }

    // ── Helpers ──────────────────────────────────────────────────────

    function _addLiquidity(address user, uint256 amount) internal {
        vm.startPrank(user);
        token.approve(address(market), amount);
        market.addLiquidity(amount);
        vm.stopPrank();
    }
}
