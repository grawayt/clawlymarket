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

    uint256 constant MERKLE_ROOT = 12345;
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
            MERKLE_ROOT,
            owner
        );
        token.setModelRegistry(address(registry));
        vm.stopPrank();
    }

    // ── Registration ─────────────────────────────────────────────────

    function test_register_success() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.registered(alice));
        assertTrue(registry.usedNullifiers(NULLIFIER_A));
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_register_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ModelRegistry.ModelRegistered(alice, NULLIFIER_A);

        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A);
    }

    function test_register_invalidProof_reverts() public {
        verifier.setResult(false);

        vm.prank(alice);
        vm.expectRevert(ModelRegistry.InvalidProof.selector);
        registry.register(pA, pB, pC, NULLIFIER_A);
    }

    function test_register_nullifierReuse_reverts() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A);

        // Bob tries to use the same nullifier
        vm.prank(bob);
        vm.expectRevert(ModelRegistry.NullifierAlreadyUsed.selector);
        registry.register(pA, pB, pC, NULLIFIER_A);
    }

    function test_register_alreadyRegistered_reverts() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A);

        // Alice tries to register again with a different nullifier
        vm.prank(alice);
        vm.expectRevert(ModelRegistry.AlreadyRegistered.selector);
        registry.register(pA, pB, pC, NULLIFIER_B);
    }

    function test_register_twoModels() public {
        vm.prank(alice);
        registry.register(pA, pB, pC, NULLIFIER_A);

        vm.prank(bob);
        registry.register(pA, pB, pC, NULLIFIER_B);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(token.balanceOf(bob), 1000e18);
    }

    // ── Merkle Root Updates ──────────────────────────────────────────

    function test_updateMerkleRoot() public {
        vm.prank(owner);
        registry.updateMerkleRoot(99999);
        assertEq(registry.merkleRoot(), 99999);
    }

    function test_updateMerkleRoot_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ModelRegistry.MerkleRootUpdated(MERKLE_ROOT, 99999);

        vm.prank(owner);
        registry.updateMerkleRoot(99999);
    }

    function test_updateMerkleRoot_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.updateMerkleRoot(99999);
    }

    // ── View ─────────────────────────────────────────────────────────

    function test_isVerified_false_byDefault() public view {
        assertFalse(registry.isVerified(alice));
    }
}
