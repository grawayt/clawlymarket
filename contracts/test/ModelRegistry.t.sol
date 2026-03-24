// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {ModelRegistry, IGroth16Verifier} from "../src/ModelRegistry.sol";

/// @dev Mock verifier that always returns true (for unit tests)
contract MockVerifier is IGroth16Verifier {
    bool public shouldPass = true;

    function setResult(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[2] calldata)
        external
        view
        override
        returns (bool)
    {
        return shouldPass;
    }
}

contract ModelRegistryTest is Test {
    ClawliaToken public token;
    ModelRegistry public registry;
    MockVerifier public verifier;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // Anthropic's real DKIM pubkey hash (Poseidon)
    uint256 constant ANTHROPIC_PUBKEY_HASH = 21143687054953386827989663701408810093555362204214086893911788067496102859806;
    uint256 constant OTHER_PUBKEY_HASH = 99999;
    uint256 constant NULLIFIER_A = 111;
    uint256 constant NULLIFIER_B = 222;

    // Dummy proof values
    uint[2] pA = [uint(1), uint(2)];
    uint[2][2] pB = [[uint(3), uint(4)], [uint(5), uint(6)]];
    uint[2] pC = [uint(7), uint(8)];

    function setUp() public {
        vm.startPrank(owner);
        token = new ClawliaToken(owner);
        verifier = new MockVerifier();
        registry = new ModelRegistry(
            address(token),
            address(verifier),
            owner
        );
        token.setModelRegistry(address(registry));
        // Approve Anthropic's DKIM pubkey hash for tests
        registry.addApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
        vm.stopPrank();
    }

    // ── Registration ─────────────────────────────────────────────────

    function test_register_success() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.registered(alice));
        assertTrue(registry.usedNullifiers(NULLIFIER_A));
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_register_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ModelRegistry.ModelRegistered(alice, NULLIFIER_A);

        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);
    }

    function test_register_invalidProof_reverts() public {
        verifier.setResult(false);

        vm.prank(alice);
        vm.expectRevert(ModelRegistry.InvalidProof.selector);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);
    }

    function test_register_nullifierReuse_reverts() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);

        // Bob tries to use the same nullifier
        vm.prank(bob);
        vm.expectRevert(ModelRegistry.NullifierAlreadyUsed.selector);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);
    }

    function test_register_alreadyRegistered_reverts() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);

        // Alice tries to register again with a different nullifier
        vm.prank(alice);
        vm.expectRevert(ModelRegistry.AlreadyRegistered.selector);
        registry.register(pA, pB, pC, NULLIFIER_B, ANTHROPIC_PUBKEY_HASH);
    }

    function test_register_unapprovedPubkeyHash_reverts() public {
        vm.prank(alice);
        vm.expectRevert(ModelRegistry.UnapprovedPubkeyHash.selector);
        registry.register(pA, pB, pC, NULLIFIER_A, OTHER_PUBKEY_HASH);
    }

    function test_register_twoModels() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);

        vm.prank(bob);
        registry.register(pA, pB, pC, NULLIFIER_B, ANTHROPIC_PUBKEY_HASH);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(token.balanceOf(bob), 1000e18);
    }

    // ── Pubkey Hash Management ────────────────────────────────────────

    function test_addApprovedPubkeyHash() public {
        vm.prank(owner);
        registry.addApprovedPubkeyHash(OTHER_PUBKEY_HASH);
        assertTrue(registry.approvedPubkeyHashes(OTHER_PUBKEY_HASH));
    }

    function test_addApprovedPubkeyHash_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ModelRegistry.PubkeyHashAdded(OTHER_PUBKEY_HASH);

        vm.prank(owner);
        registry.addApprovedPubkeyHash(OTHER_PUBKEY_HASH);
    }

    function test_addApprovedPubkeyHash_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.addApprovedPubkeyHash(OTHER_PUBKEY_HASH);
    }

    function test_removeApprovedPubkeyHash() public {
        vm.prank(owner);
        registry.removeApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
        assertFalse(registry.approvedPubkeyHashes(ANTHROPIC_PUBKEY_HASH));
    }

    function test_removeApprovedPubkeyHash_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ModelRegistry.PubkeyHashRemoved(ANTHROPIC_PUBKEY_HASH);

        vm.prank(owner);
        registry.removeApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
    }

    function test_removeApprovedPubkeyHash_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.removeApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
    }

    function test_removedHash_cannotRegister() public {
        vm.prank(owner);
        registry.removeApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);

        vm.prank(alice);
        vm.expectRevert(ModelRegistry.UnapprovedPubkeyHash.selector);
        registry.register(pA, pB, pC, NULLIFIER_A, ANTHROPIC_PUBKEY_HASH);
    }

    function test_addHash_thenRegister_succeeds() public {
        vm.prank(owner);
        registry.addApprovedPubkeyHash(OTHER_PUBKEY_HASH);

        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A, OTHER_PUBKEY_HASH);

        assertTrue(registry.isVerified(alice));
    }

    // ── View ─────────────────────────────────────────────────────────

    function test_isVerified_false_byDefault() public view {
        assertFalse(registry.isVerified(alice));
    }

    function test_anthropicHashApprovedAfterSetup() public view {
        assertTrue(registry.approvedPubkeyHashes(ANTHROPIC_PUBKEY_HASH));
    }
}
