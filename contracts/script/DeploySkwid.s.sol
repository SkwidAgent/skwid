// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeploymentBase} from "./DeploymentBase.s.sol";
import {SkwidFeeTreasury} from "../src/SkwidFeeTreasury.sol";
import {SkwidReleaseRegistry} from "../src/SkwidReleaseRegistry.sol";

contract DeploySkwid is DeploymentBase {
    function run() external returns (SkwidFeeTreasury treasury, SkwidReleaseRegistry registry) {
        requireRobinhood();

        address owner = vm.envAddress("SKWID_CONTRACT_OWNER");
        address treasurer = vm.envAddress("SKWID_TREASURER");
        address releaseOperator = vm.envAddress("SKWID_RELEASE_OPERATOR");

        vm.startBroadcast();
        treasury = new SkwidFeeTreasury(owner, treasurer);
        registry = new SkwidReleaseRegistry(owner, releaseOperator);
        vm.stopBroadcast();
    }
}
