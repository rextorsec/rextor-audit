// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script (C2 step 1): bind the agent wallet to agentId on the
///         canonical ERC-8004 IdentityRegistry. ORDERING IS BINDING
///         (docs/deployments/erc8004.md C2 note): MUST run BEFORE the first
///         giveFeedback — the spec's aggregation guidance wants client feedback
///         from the agentWallet metadata address, and giveFeedback's submitter
///         must not be the owner.
///
///         The LIVE registry is version 2.0.0 (getVersion probe 2026-09-20):
///         the EIP-712 signature must recover to the NEW WALLET (not the
///         owner!) over AgentWalletSet(agentId, newWallet, owner, deadline),
///         domain EIP712Domain(name "ERC8004IdentityRegistry", version "1",
///         chainId, verifyingContract). MAX_DEADLINE_DELAY on-chain is 5
///         minutes, so the script signs now+240s — BROADCAST WITHIN ~3 MINUTES.
///
///         Env:
///           DEPLOY_PRIVATE_KEY         agentId OWNER (broadcasts; must be ownerOf)
///           REXTOR_AGENT_PRIVATE_KEY   the agent-wallet EOA — SIGNS the EIP-712
///           ERC8004_IDENTITY_REGISTRY  canonical IdentityRegistry
///           ERC8004_AGENT_ID           the agentId (50891)
///         Chain via FOUNDRY_PROFILE=eth|base (see foundry.toml).
///
///         🔴 RECTOR GATE: MAINNET broadcast. Never run without RECTOR's
///         explicit go (week-4 plan, global constraints).
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
}

contract SetAgentWallet8004 is Script {
    bytes32 constant AGENT_WALLET_SET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
    bytes32 constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function run() public {
        uint256 ownerPk = vm.envUint("DEPLOY_PRIVATE_KEY");
        uint256 walletPk = vm.envUint("REXTOR_AGENT_PRIVATE_KEY");
        IIdentityRegistry registry = IIdentityRegistry(vm.envAddress("ERC8004_IDENTITY_REGISTRY"));
        uint256 agentId = vm.envUint("ERC8004_AGENT_ID");

        address owner = vm.addr(ownerPk);
        address newWallet = vm.addr(walletPk);
        // C2 roles: the owner broadcasts; the AGENT wallet signs. A single key
        // wearing both roles would blur the client identity the binding exists
        // to establish.
        require(owner != newWallet, "owner and agent wallet must differ");
        require(registry.ownerOf(agentId) == owner, "broadcaster is not agentId owner");

        // On-chain MAX_DEADLINE_DELAY is 5 minutes — sign for now+240s so the
        // broadcast tx mines well inside the window.
        uint256 deadline = block.timestamp + 240;
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        bytes32 structHash = keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletPk, digest);

        console2.log("agentId        :", agentId);
        console2.log("owner          :", owner);
        console2.log("agent wallet   :", newWallet);
        console2.log("deadline       :", deadline);

        vm.startBroadcast(ownerPk);
        registry.setAgentWallet(agentId, newWallet, deadline, abi.encodePacked(r, s, v));
        vm.stopBroadcast();

        address bound = registry.getAgentWallet(agentId);
        console2.log("getAgentWallet :", bound);
        require(bound == newWallet, "agentWallet binding did not stick");
    }
}
