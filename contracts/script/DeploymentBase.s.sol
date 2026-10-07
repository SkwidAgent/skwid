// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Shared network assertion. Each product supplies its own concrete run() script.
abstract contract DeploymentBase is Script {
    error WrongChain(uint256 actual);

    function requireRobinhood() internal view {
        if (block.chainid != 4663) revert WrongChain(block.chainid);
    }
}
