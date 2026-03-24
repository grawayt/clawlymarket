// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {Groth16Verifier} from "../src/ZKVerifier.sol";

/// @notice Placeholder verifier for testnet only.
///         Set USE_REAL_VERIFIER=true in the environment to deploy the real Groth16Verifier instead.
contract PlaceholderVerifier {
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[2] calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }
}

contract Deploy is Script {
    // Anthropic's DKIM RSA public key hash (Poseidon). Pre-approved on deployment.
    uint256 constant ANTHROPIC_PUBKEY_HASH = 21143687054953386827989663701408810093555362204214086893911788067496102859806;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bool useRealVerifier = vm.envOr("USE_REAL_VERIFIER", false);

        console.log("Deployer:", deployer);
        console.log("Use real verifier:", useRealVerifier);

        vm.startBroadcast(deployerKey);

        // 1. Deploy ZK Verifier — real Groth16Verifier or testnet placeholder depending on USE_REAL_VERIFIER
        address verifierAddr;
        if (useRealVerifier) {
            Groth16Verifier realVerifier = new Groth16Verifier();
            verifierAddr = address(realVerifier);
            console.log("ZKVerifier (Groth16):", verifierAddr);
        } else {
            PlaceholderVerifier placeholderVerifier = new PlaceholderVerifier();
            verifierAddr = address(placeholderVerifier);
            console.log("ZKVerifier (Placeholder/testnet):", verifierAddr);
        }

        // 2. Deploy Clawlia Token
        ClawliaToken token = new ClawliaToken(deployer);
        console.log("ClawliaToken:", address(token));

        // 3. Deploy Model Registry
        ModelRegistry registry = new ModelRegistry(
            address(token),
            verifierAddr,
            deployer
        );
        console.log("ModelRegistry:", address(registry));

        // 3a. Approve Anthropic's DKIM pubkey hash so models can prove via ZK Email
        registry.addApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
        console.log("Approved Anthropic DKIM pubkey hash:", ANTHROPIC_PUBKEY_HASH);

        // 4. Wire token to registry
        token.setModelRegistry(address(registry));

        // 5. Deploy Market Factory
        MarketFactory factory = new MarketFactory(
            address(token),
            address(registry),
            deployer
        );
        console.log("MarketFactory:", address(factory));

        // 6. Whitelist factory and make it a whitelister (for new markets)
        token.whitelistAddress(address(factory));
        token.setWhitelister(address(factory), true);

        vm.stopBroadcast();

        console.log("--- Deployment complete ---");
    }
}
