// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script (C1): mint the rextor-audit[bot] agent identity on the
///         canonical ERC-8004 IdentityRegistry. The Tempo testnets carry no
///         ERC-8004 registry (probe evidence: docs/deployments/erc8004.md), so
///         identity is registered chain-neutral on a mainnet canonical
///         deployment; verdict attestations stay chain-native.
///
///         Env:
///           DEPLOY_PRIVATE_KEY         broadcaster (funded on the target chain)
///           ERC8004_IDENTITY_REGISTRY  canonical IdentityRegistry address
///           ERC8004_AGENT_URI          ipfs:// URI of the registration file
///         Chain via FOUNDRY_PROFILE=eth|base (see foundry.toml).
///
///         🔴 RECTOR GATE: MAINNET broadcast. Never run without RECTOR's
///         explicit go (week-4 plan, global constraints).
interface IERC8004IdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

contract Register8004 is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        IERC8004IdentityRegistry registry =
            IERC8004IdentityRegistry(vm.envAddress("ERC8004_IDENTITY_REGISTRY"));
        string memory agentURI = vm.envString("ERC8004_AGENT_URI");

        vm.startBroadcast(pk);
        uint256 agentId = registry.register(agentURI);
        vm.stopBroadcast();

        console2.log("ERC-8004 agent minted; agentId:", agentId);
        require(agentId > 0, "agentId must be nonzero");
    }
}
