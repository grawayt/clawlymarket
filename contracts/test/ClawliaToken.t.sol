// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";

contract ClawliaTokenTest is Test {
    ClawliaToken public token;

    address owner = makeAddr("owner");
    address registry = makeAddr("registry");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address eve = makeAddr("eve");

    function setUp() public {
        vm.prank(owner);
        token = new ClawliaToken(owner);

        vm.prank(owner);
        token.setModelRegistry(registry);
    }

    // ── Registration & Minting ───────────────────────────────────────

    function test_registerAndMint() public {
        vm.prank(registry);
        token.registerAndMint(alice);

        assertEq(token.balanceOf(alice), 1000e18);
        assertTrue(token.verified(alice));
    }

    function test_registerAndMint_revertsIfNotRegistry() public {
        vm.prank(alice);
        vm.expectRevert(ClawliaToken.OnlyRegistry.selector);
        token.registerAndMint(alice);
    }

    function test_registerAndMint_canRegisterTwice_isMintedAgain() public {
        vm.prank(registry);
        token.registerAndMint(alice);
        vm.prank(registry);
        token.registerAndMint(alice);

        // Double mint — ModelRegistry is responsible for preventing this via nullifiers
        assertEq(token.balanceOf(alice), 2000e18);
    }

    // ── Registry Setup ───────────────────────────────────────────────

    function test_setModelRegistry() public {
        // Deploy fresh token to test registry setting
        vm.prank(owner);
        ClawliaToken fresh = new ClawliaToken(owner);

        vm.prank(owner);
        fresh.setModelRegistry(registry);

        assertEq(fresh.modelRegistry(), registry);
    }

    function test_setModelRegistry_revertsIfAlreadySet() public {
        vm.prank(owner);
        vm.expectRevert(ClawliaToken.RegistryAlreadySet.selector);
        token.setModelRegistry(makeAddr("other"));
    }

    function test_setModelRegistry_revertsIfNotOwner() public {
        vm.prank(owner);
        ClawliaToken fresh = new ClawliaToken(owner);

        vm.prank(alice);
        vm.expectRevert();
        fresh.setModelRegistry(registry);
    }

    // ── Transfer Restrictions ────────────────────────────────────────

    function test_transfer_verified_to_verified() public {
        _registerBoth();

        vm.prank(alice);
        token.transfer(bob, 100e18);

        assertEq(token.balanceOf(alice), 900e18);
        assertEq(token.balanceOf(bob), 1100e18);
    }

    function test_transfer_reverts_unverified_sender() public {
        vm.prank(registry);
        token.registerAndMint(bob);

        // alice is unverified, try sending to verified bob
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClawliaToken.TransferNotAllowed.selector, alice, bob)
        );
        token.transfer(bob, 1e18);
    }

    function test_transfer_reverts_unverified_recipient() public {
        vm.prank(registry);
        token.registerAndMint(alice);

        // bob is unverified
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClawliaToken.TransferNotAllowed.selector, alice, bob)
        );
        token.transfer(bob, 1e18);
    }

    function test_transfer_reverts_both_unverified() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ClawliaToken.TransferNotAllowed.selector, alice, bob)
        );
        token.transfer(bob, 1e18);
    }

    // ── Approve + TransferFrom ───────────────────────────────────────

    function test_transferFrom_verified_to_verified() public {
        _registerBoth();

        vm.prank(alice);
        token.approve(eve, 200e18);

        vm.prank(eve);
        token.transferFrom(alice, bob, 200e18);

        assertEq(token.balanceOf(alice), 800e18);
        assertEq(token.balanceOf(bob), 1200e18);
    }

    function test_transferFrom_reverts_unverified_recipient() public {
        vm.prank(registry);
        token.registerAndMint(alice);

        vm.prank(alice);
        token.approve(eve, 200e18);

        // eve (unverified) tries to move alice's tokens to unverified bob
        vm.prank(eve);
        vm.expectRevert(
            abi.encodeWithSelector(ClawliaToken.TransferNotAllowed.selector, alice, bob)
        );
        token.transferFrom(alice, bob, 200e18);
    }

    // ── ERC-20 Basics ────────────────────────────────────────────────

    function test_name_and_symbol() public view {
        assertEq(token.name(), "Clawlia");
        assertEq(token.symbol(), "CLAW");
    }

    function test_decimals() public view {
        assertEq(token.decimals(), 18);
    }

    function test_initialAllocation_constant() public view {
        assertEq(token.INITIAL_ALLOCATION(), 1000e18);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    function _registerBoth() internal {
        vm.startPrank(registry);
        token.registerAndMint(alice);
        token.registerAndMint(bob);
        vm.stopPrank();
    }
}
