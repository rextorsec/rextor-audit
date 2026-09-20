// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script: plain ETH transfer for gas top-ups between rextor
///         operational wallets (e.g. funding the agent wallet before a
///         feedback broadcast). Kept as a script so the private key never
///         touches argv (this foundry ignores PRIVATE_KEY env for `cast send`).
///
///         Env:
///           DEPLOY_PRIVATE_KEY    funded sender
///           TRANSFER_TO           recipient address
///           TRANSFER_AMOUNT_WEI   amount in wei (e.g. "200000000000000" = 0.0002 ETH)
///
///         🔴 MAINNET transfers inherit the broadcast gate.
contract Transfer8004 is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        address to = vm.envAddress("TRANSFER_TO");
        uint256 value = vm.envUint("TRANSFER_AMOUNT_WEI");

        console2.log("sending", value);
        console2.log("to     :", to);

        vm.startBroadcast(pk);
        (bool ok,) = to.call{value: value}("");
        require(ok, "transfer reverted");
        vm.stopBroadcast();

        console2.log("balance after:", to.balance);
    }
}
