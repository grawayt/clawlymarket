// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {ModelRegistry, IGroth16Verifier} from "../src/ModelRegistry.sol";

contract MockVerifierF is IGroth16Verifier {
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[2] calldata)
        external
        pure
        override
        returns (bool)
    {
        return true;
    }
}

contract MarketFactoryTest is Test {
    ClawliaToken public token;
    ModelRegistry public modelRegistry;
    MarketFactory public factory;
    MockVerifierF public verifier;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address resolver = makeAddr("resolver");

    uint256 constant FUTURE = 2000000;

    function setUp() public {
        vm.startPrank(owner);
        token = new ClawliaToken(owner);
        verifier = new MockVerifierF();
        modelRegistry = new ModelRegistry(address(token), address(verifier), owner);
        token.setModelRegistry(address(modelRegistry));
        // Approve a test pubkey hash so alice can register
        uint256 testPubkeyHash = 12345;
        modelRegistry.addApprovedPubkeyHash(testPubkeyHash);
        factory = new MarketFactory(address(token), address(modelRegistry), owner);
        // Whitelist the factory so it can hold CLAW during market creation
        token.whitelistAddress(address(factory));
        // Make factory a whitelister so it can whitelist new market contracts
        token.setWhitelister(address(factory), true);
        vm.stopPrank();

        // Register alice via mock ZK proof
        uint[2] memory pA = [uint(1), uint(2)];
        uint[2][2] memory pB = [[uint(3), uint(4)], [uint(5), uint(6)]];
        uint[2] memory pC = [uint(7), uint(8)];

        vm.prank(alice);
        modelRegistry.register(pA, pB, pC, 111, testPubkeyHash);
    }

    function test_createMarket() public {
        vm.startPrank(alice);
        token.approve(address(factory), 100e18);
        address marketAddr = factory.createMarket("Will X happen?", FUTURE, resolver, 100e18);
        vm.stopPrank();

        assertTrue(marketAddr != address(0));
        assertEq(factory.getMarketCount(), 1);
        assertEq(factory.markets(0), marketAddr);

        PredictionMarket market = PredictionMarket(marketAddr);
        assertEq(market.question(), "Will X happen?");
        assertEq(market.resolutionTimestamp(), FUTURE);
        assertEq(market.resolver(), resolver);
    }

    function test_createMarket_notVerified_reverts() public {
        vm.prank(bob);
        vm.expectRevert(MarketFactory.NotVerified.selector);
        factory.createMarket("Test?", FUTURE, resolver, 100e18);
    }

    function test_createMarket_resolutionInPast_reverts() public {
        vm.startPrank(alice);
        token.approve(address(factory), 100e18);
        vm.expectRevert(MarketFactory.ResolutionInPast.selector);
        factory.createMarket("Test?", 0, resolver, 100e18);
        vm.stopPrank();
    }

    function test_createMarket_insufficientLiquidity_reverts() public {
        vm.startPrank(alice);
        token.approve(address(factory), 100e18);
        vm.expectRevert(MarketFactory.InsufficientLiquidity.selector);
        factory.createMarket("Test?", FUTURE, resolver, 5e18);
        vm.stopPrank();
    }

    function test_createMultipleMarkets() public {
        vm.startPrank(alice);
        token.approve(address(factory), 200e18);
        factory.createMarket("Q1?", FUTURE, resolver, 100e18);
        factory.createMarket("Q2?", FUTURE, resolver, 100e18);
        vm.stopPrank();

        assertEq(factory.getMarketCount(), 2);
        address[] memory allMarkets = factory.getMarkets();
        assertEq(allMarkets.length, 2);
    }

    function test_creatorReceivesLPTokens() public {
        vm.startPrank(alice);
        token.approve(address(factory), 100e18);
        address marketAddr = factory.createMarket("Test?", FUTURE, resolver, 100e18);
        vm.stopPrank();

        PredictionMarket market = PredictionMarket(marketAddr);
        // Alice should have received the LP tokens (YES + NO)
        assertTrue(market.balanceOf(alice, 0) > 0, "Alice should have YES tokens");
        assertTrue(market.balanceOf(alice, 1) > 0, "Alice should have NO tokens");
        // Factory should have zero
        assertEq(market.balanceOf(address(factory), 0), 0);
        assertEq(market.balanceOf(address(factory), 1), 0);
    }
}
