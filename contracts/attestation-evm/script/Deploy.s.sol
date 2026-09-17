// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RextorAttestation.sol";

contract Deploy is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        vm.startBroadcast(pk);
        new RextorAttestation();
        vm.stopBroadcast();
    }
}
