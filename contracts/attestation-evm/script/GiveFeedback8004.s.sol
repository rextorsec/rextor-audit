// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/// @notice Ops script (C2 step 2): operator-seeded feedback for the agent on
///         the canonical ERC-8004 ReputationRegistry (Conatus parity). The
///         submitter is the AGENT WALLET (0xE690…a122): giveFeedback rejects
///         the NFT owner / approved operators, and after SetAgentWallet8004 the
///         spec's aggregation guidance wants client feedback from the
///         agentWallet metadata address — this script ASSERTS both.
///
///         Feedback payload carries NO offchain payload (feedbackURI "",
///         feedbackHash 0) — the honest-disclosure copy on the identity card
///         stays "operator-seeded; live ingestion roadmap" (plan Task 9).
///
///         Env:
///           REXTOR_AGENT_PRIVATE_KEY   feedback client (the agent wallet EOA)
///           ERC8004_REPUTATION_REGISTRY canonical ReputationRegistry
///           ERC8004_IDENTITY_REGISTRY  canonical IdentityRegistry (owner/wallet assertions)
///           ERC8004_AGENT_ID           the agentId (50891)
///           ERC8004_FEEDBACK_VALUE     int128 rating (e.g. 95)
///           ERC8004_FEEDBACK_DECIMALS  uint8 (e.g. 0 → "95/100")
///           ERC8004_FEEDBACK_TAG1      string ≤ 32 bytes (e.g. "audit")
///           ERC8004_FEEDBACK_TAG2      string ≤ 32 bytes (e.g. "dev")
///           ERC8004_FEEDBACK_ENDPOINT  contact/info URL (e.g. https://rextoraudit.com)
///         Chain via FOUNDRY_PROFILE=eth|base (see foundry.toml).
///
///         🔴 RECTOR GATE: MAINNET broadcast. Never run without RECTOR's
///         explicit go (week-4 plan, global constraints).
interface IIdentityRegistryView {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}

contract GiveFeedback8004 is Script {
    function run() public {
        uint256 clientPk = vm.envUint("REXTOR_AGENT_PRIVATE_KEY");
        IReputationRegistry reputation =
            IReputationRegistry(vm.envAddress("ERC8004_REPUTATION_REGISTRY"));
        IIdentityRegistryView identity = IIdentityRegistryView(vm.envAddress("ERC8004_IDENTITY_REGISTRY"));
        uint256 agentId = vm.envUint("ERC8004_AGENT_ID");

        int128 value = int128(uint128(vm.envUint("ERC8004_FEEDBACK_VALUE")));
        uint8 decimals = uint8(vm.envUint("ERC8004_FEEDBACK_DECIMALS"));
        string memory tag1 = vm.envString("ERC8004_FEEDBACK_TAG1");
        string memory tag2 = vm.envString("ERC8004_FEEDBACK_TAG2");
        string memory endpoint = vm.envString("ERC8004_FEEDBACK_ENDPOINT");

        // Registry limits (live 2.0.0): |value| ≤ 1e38, decimals ≤ 18.
        require(value > 0 && value <= int128(uint128(1e38)), "value out of range");
        require(decimals <= 18, "too many decimals");
        require(bytes(tag1).length <= 32 && bytes(tag2).length <= 32, "tag over 32 bytes");

        address client = vm.addr(clientPk);
        // The two C2 ordering invariants, asserted not assumed:
        require(client != identity.ownerOf(agentId), "client must not be the owner (self-feedback rule)");
        require(client == identity.getAgentWallet(agentId), "client must be the bound agentWallet (run SetAgentWallet8004 first)");

        console2.log("agentId   :", agentId);
        console2.log("client    :", client);
        console2.log("value     :", uint256(int256(value)));
        console2.log("decimals  :", uint256(decimals));
        console2.log("tags      :", string.concat(tag1, "/", tag2));

        vm.startBroadcast(clientPk);
        reputation.giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, "", bytes32(0));
        vm.stopBroadcast();

        uint64 idx = reputation.getLastIndex(agentId, client);
        console2.log("feedback index:", uint256(idx));
        require(idx >= 1, "feedback did not land");
    }
}
