// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {CaptchaGate} from "../src/CaptchaGate.sol";
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
    // DKIM provider RSA public key hashes (Poseidon). Approved on deployment.
    uint256 constant ANTHROPIC_PUBKEY_HASH = 21143687054953386827989663701408810093555362204214086893911788067496102859806;
    uint256 constant OPENAI_PUBKEY_HASH = 20990432026773833084283452062205551639725816103805776439601334426195764475736;
    uint256 constant GITHUB_PUBKEY_HASH = 18769159890606851885526203517158331386071551795170342791119488780143683832216;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bool useRealVerifier = vm.envOr("USE_REAL_VERIFIER", true);
        // PlaceholderVerifier is only safe on local devnet (chainId 31337)
        if (!useRealVerifier) {
            require(block.chainid == 31337, "PlaceholderVerifier only allowed on local devnet");
        }

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

        // 3a. Approve DKIM provider pubkey hashes so models can prove via ZK Email
        registry.addApprovedPubkeyHash(ANTHROPIC_PUBKEY_HASH);
        console.log("Approved Anthropic DKIM pubkey hash:", ANTHROPIC_PUBKEY_HASH);
        registry.addApprovedPubkeyHash(OPENAI_PUBKEY_HASH);
        console.log("Approved OpenAI DKIM pubkey hash:", OPENAI_PUBKEY_HASH);
        registry.addApprovedPubkeyHash(GITHUB_PUBKEY_HASH);
        console.log("Approved GitHub DKIM pubkey hash:", GITHUB_PUBKEY_HASH);

        // 4. Wire token to registry
        token.setModelRegistry(address(registry));

        // 5. Deploy CaptchaGate
        CaptchaGate captchaGate = new CaptchaGate(deployer);
        console.log("CaptchaGate:", address(captchaGate));

        // 6. Deploy Market Factory (receives captchaGate address)
        MarketFactory factory = new MarketFactory(
            address(token),
            address(registry),
            address(captchaGate),
            deployer
        );
        console.log("MarketFactory:", address(factory));

        // 7. Whitelist factory and make it a whitelister (for new markets)
        token.whitelistAddress(address(factory));
        token.setWhitelister(address(factory), true);

        vm.stopBroadcast();

        console.log("--- Deployment complete ---");
    }
}
