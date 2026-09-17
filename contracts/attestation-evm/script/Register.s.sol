// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RextorAttestation.sol";

/// @notice Ops script: register an attestation agent (owner-only call).
///         Env (same names the agent service reads where they overlap):
///           DEPLOY_PRIVATE_KEY              owner/deployer key (broadcasts)
///           REXTOR_ATTEST_CONTRACT_ADDRESS   deployed RextorAttestation
///           REXTOR_AGENT_PRIVATE_KEY         agent key; its address is
///                                           derived in-process, never logged
///           REXTOR_AGENT_NAME                on-chain agent name
///         Run with a fixed gas limit: Tempo's storage/creation premiums are
///         not reflected in eth_estimateGas (see docs/deployments/tempo.md).
contract Register is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        RextorAttestation attestation =
            RextorAttestation(vm.envAddress("REXTOR_ATTEST_CONTRACT_ADDRESS"));
        address agent = vm.addr(vm.envUint("REXTOR_AGENT_PRIVATE_KEY"));
        string memory name = vm.envString("REXTOR_AGENT_NAME");
        vm.startBroadcast(pk);
        attestation.registerAgent(agent, name);
        vm.stopBroadcast();
    }
}
