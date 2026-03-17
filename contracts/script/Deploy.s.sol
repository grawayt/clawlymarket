// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClawliaToken} from "../src/ClawliaToken.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";
import {MarketFactory} from "../src/MarketFactory.sol";

/// @notice Placeholder verifier for testnet deployment.
///         Replace with the auto-generated ZKVerifier.sol from snarkjs for production.
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
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        uint256 initialMerkleRoot = vm.envOr("MERKLE_ROOT", uint256(0));

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Deploy placeholder ZK Verifier (replace with real one later)
        PlaceholderVerifier verifier = new PlaceholderVerifier();
        console.log("ZKVerifier:", address(verifier));

        // 2. Deploy Clawlia Token
        ClawliaToken token = new ClawliaToken(deployer);
        console.log("ClawliaToken:", address(token));

        // 3. Deploy Model Registry
        ModelRegistry registry = new ModelRegistry(
            address(token),
            address(verifier),
            initialMerkleRoot,
            deployer
        );
        console.log("ModelRegistry:", address(registry));

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
