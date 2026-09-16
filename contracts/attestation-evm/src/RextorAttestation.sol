// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RextorAttestation — SPEC-4 v1. Anchors review verdicts on-chain:
/// commit hash + findings hash + riskScore + agent identity. Immutable by
/// design; changes redeploy. No upgrade path, no admin rescue of verdicts.
contract RextorAttestation {
    struct Agent { string name; bool active; uint64 reviewCount; }
    struct Attestation {
        address agent;
        bytes32 commitHash;
        bytes32 findingsHash;
        uint16 riskScore;    // <= 100 (InvalidScore otherwise)
        uint16 findingCount;
        uint8 status;        // 0 = complete, 1 = incomplete (InvalidStatus otherwise)
    }

    address public immutable owner;
    mapping(address => Agent) public agents;
    mapping(bytes32 => Attestation) private _attestations;

    event AgentRegistered(address indexed agent, string name);
    event AgentActiveChanged(address indexed agent, bool active);
    event Attested(
        bytes32 indexed reviewId, address indexed agent,
        bytes32 commitHash, bytes32 findingsHash,
        uint16 riskScore, uint16 findingCount, uint8 status
    );

    error NotOwner();
    error NotActiveAgent();
    error IdempotencyConflict();
    error InvalidScore();
    error InvalidStatus();

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    function registerAgent(address agent, string calldata name) external onlyOwner {
        agents[agent] = Agent(name, true, 0);
        emit AgentRegistered(agent, name);
    }

    function setAgentActive(address agent, bool active) external onlyOwner {
        agents[agent].active = active;
        emit AgentActiveChanged(agent, active);
    }

    function attest(
        bytes32 reviewId,
        bytes32 commitHash,
        bytes32 findingsHash,
        uint16 riskScore,
        uint16 findingCount,
        uint8 status
    ) external {
        Agent storage a = agents[msg.sender];
        if (!a.active) revert NotActiveAgent();
        if (riskScore > 100) revert InvalidScore();
        if (status > 1) revert InvalidStatus();

        Attestation storage existing = _attestations[reviewId];
        if (existing.agent != address(0)) {
            // Webhook-redelivery idempotency: identical payload → no-op.
            if (
                existing.commitHash == commitHash && existing.findingsHash == findingsHash
                    && existing.riskScore == riskScore && existing.findingCount == findingCount
                    && existing.status == status
            ) {
                return;
            }
            revert IdempotencyConflict();
        }

        _attestations[reviewId] =
            Attestation(msg.sender, commitHash, findingsHash, riskScore, findingCount, status);
        a.reviewCount += 1;
        emit Attested(reviewId, msg.sender, commitHash, findingsHash, riskScore, findingCount, status);
    }

    function attestations(bytes32 reviewId)
        external
        view
        returns (address agent, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status)
    {
        Attestation storage a = _attestations[reviewId];
        return (a.agent, a.commitHash, a.findingsHash, a.riskScore, a.findingCount, a.status);
    }

    function verify(
        bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash,
        uint16 riskScore, uint16 findingCount, uint8 status
    ) external view returns (bool) {
        Attestation storage a = _attestations[reviewId];
        return a.agent != address(0) && a.commitHash == commitHash && a.findingsHash == findingsHash
            && a.riskScore == riskScore && a.findingCount == findingCount && a.status == status;
    }
}
