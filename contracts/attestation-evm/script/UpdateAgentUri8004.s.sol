// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script (C1 step 4): point the agent's tokenURI at the updated
///         registration file — the v2 pin that carries the post-mint
///         `registrations[]` binding (agentId + agentRegistry). Also the tool
///         for later URI updates (e.g. rextoraudit.com service endpoint at F4).
///
///         Env:
///           DEPLOY_PRIVATE_KEY         broadcaster (NFT owner)
///           ERC8004_IDENTITY_REGISTRY  canonical IdentityRegistry address
///           ERC8004_AGENT_ID           minted tokenId (logged by Register8004)
///           ERC8004_AGENT_URI          ipfs:// URI of the NEW registration file
///         Chain via FOUNDRY_PROFILE=eth|base. 🔴 RECTOR GATE (mainnet).
interface IERC8004IdentityRegistry {
    function setAgentURI(uint256 agentId, string calldata newURI) external;
}

contract UpdateAgentUri8004 is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        IERC8004IdentityRegistry registry =
            IERC8004IdentityRegistry(vm.envAddress("ERC8004_IDENTITY_REGISTRY"));
        uint256 agentId = vm.envUint("ERC8004_AGENT_ID");
        string memory agentURI = vm.envString("ERC8004_AGENT_URI");

        vm.startBroadcast(pk);
        registry.setAgentURI(agentId, agentURI);
        vm.stopBroadcast();

        console2.log("agentURI updated for agentId:", agentId);
    }
}
