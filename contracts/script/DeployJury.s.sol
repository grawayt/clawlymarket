// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {JuryResolution} from "../src/JuryResolution.sol";

contract DeployJury is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address clawlia       = vm.envAddress("CLAWLIA_TOKEN");
        address modelRegistry = vm.envAddress("MODEL_REGISTRY");

        console.log("Deployer:", deployer);
        console.log("ClawliaToken:", clawlia);
        console.log("ModelRegistry:", modelRegistry);

        vm.startBroadcast(deployerKey);

        JuryResolution jury = new JuryResolution(clawlia, modelRegistry, deployer);
        console.log("JuryResolution:", address(jury));

        vm.stopBroadcast();
    }
}
