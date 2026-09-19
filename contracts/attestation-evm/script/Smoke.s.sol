// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

interface IRextorAttestation {
    function attest(
        bytes32 reviewId,
        bytes32 commitHash,
        bytes32 findingsHash,
        string calldata findingsURI,
        uint16 riskScore,
        uint16 findingCount,
        uint8 status,
        uint32 targetChainId
    ) external;
    function verify(
        bytes32 reviewId,
        bytes32 commitHash,
        bytes32 findingsHash,
        string calldata findingsURI,
        uint16 riskScore,
        uint16 findingCount,
        uint8 status,
        uint32 targetChainId
    ) external view returns (bool);
}

/// @title Smoke — v2 contract-level smoke (env-safe ops pattern, mirrors Register.s.sol).
/// Attests a clearly-synthetic review (reviewId namespaced "smoke"), then proves the
/// discriminative check: verify() true with the exact payload, false with a tampered score.
contract Smoke is Script {
    function run() external {
        address c = vm.envAddress("REXTOR_ATTEST_CONTRACT_ADDRESS");
        uint256 pk = vm.envUint("REXTOR_AGENT_PRIVATE_KEY");
        bytes32 reviewId = keccak256("rextor/review/v1|smoke|0|0x0000000000000000000000000000000000000000");
        bytes32 commitHash = keccak256("smoke-commit");
        bytes32 findingsHash = keccak256("smoke-findings");
        string memory uri = vm.envOr("SMOKE_FINDINGS_URI", string(""));
        uint16 score = 41;
        uint16 count = 2;
        uint8 status = 0;
        uint32 targetChain = uint32(vm.envOr("SMOKE_TARGET_CHAIN_ID", uint256(42431)));

        vm.startBroadcast(pk);
        IRextorAttestation(c).attest(reviewId, commitHash, findingsHash, uri, score, count, status, targetChain);
        vm.stopBroadcast();

        bool ok = IRextorAttestation(c).verify(reviewId, commitHash, findingsHash, uri, score, count, status, targetChain);
        bool tampered = IRextorAttestation(c).verify(reviewId, commitHash, findingsHash, uri, 34, count, status, targetChain);
        if (!ok) revert("smoke: verify(payload) returned false");
        if (tampered) revert("smoke: verify(tampered) returned true");
    }
}
