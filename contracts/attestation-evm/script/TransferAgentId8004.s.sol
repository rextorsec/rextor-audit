// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script (key rotation step 4): move the agent identity NFT to
///         the new owner EOA. Owner broadcasts. NOTE: IdentityRegistry 2.0.0
///         CLEARS the `agentWallet` metadata on transfer — re-run
///         SetAgentWallet8004 AFTER this (runbook: docs/deployments/key-rotation.md).
///
///         Env:
///           DEPLOY_PRIVATE_KEY         CURRENT owner (broadcasts)
///           ERC8004_IDENTITY_REGISTRY  canonical IdentityRegistry
///           ERC8004_AGENT_ID           the agentId
///           ERC8004_NEW_OWNER          recipient (new owner EOA)
///
///         🔴 MAINNET broadcast — gate applies.
interface IIdentityNFT {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function transferFrom(address from, address to, uint256 agentId) external;
}

contract TransferAgentId8004 is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        IIdentityNFT registry = IIdentityNFT(vm.envAddress("ERC8004_IDENTITY_REGISTRY"));
        uint256 agentId = vm.envUint("ERC8004_AGENT_ID");
        address to = vm.envAddress("ERC8004_NEW_OWNER");

        address from = registry.ownerOf(agentId);
        console2.log("transferring agentId", agentId);
        console2.log("from:", from);
        console2.log("to  :", to);
        require(from == vm.addr(pk), "broadcaster is not the owner");

        vm.startBroadcast(pk);
        registry.transferFrom(from, to, agentId);
        vm.stopBroadcast();

        console2.log("new owner:", registry.ownerOf(agentId));
        console2.log("agentWallet after transfer (expected cleared):", registry.getAgentWallet(agentId));
        require(registry.ownerOf(agentId) == to, "transfer did not stick");
    }
}
