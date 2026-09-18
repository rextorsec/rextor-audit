// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RextorAttestation — SPEC-4 v2 (2026-09-18 errata). Anchors review
/// verdicts on-chain: commit hash + findings hash + findingsURI + riskScore +
/// agent identity + target chain. Immutable by design; changes redeploy. No
/// upgrade path, no admin rescue of verdicts.
contract RextorAttestation {
    struct Agent { string name; bool active; uint64 reviewCount; }

    // SPEC-4 v2 cap: non-empty findingsURI is at most 256 bytes ("" is valid —
    // degraded mode when IPFS pinning is unavailable).
    uint256 internal constant MAX_FINDINGS_URI_BYTES = 256;

    struct Attestation {
        address agent;
        bytes32 commitHash;
        bytes32 findingsHash;
        string findingsURI;  // IPFS-pinned full report; "" = degraded (SPEC-4 v2)
        uint16 riskScore;    // <= 100 (InvalidScore otherwise)
        uint16 findingCount;
        uint8 status;        // 0 = complete, 1 = incomplete (InvalidStatus otherwise)
        uint32 targetChainId; // the chain the audited code targets (SPEC-4 v2)
    }

    address public immutable owner;
    mapping(address => Agent) public agents;
    mapping(bytes32 => Attestation) private _attestations;

    event AgentRegistered(address indexed agent, string name);
    event AgentActiveChanged(address indexed agent, bool active);
    event Attested(
        bytes32 indexed reviewId, address indexed agent,
        bytes32 commitHash, bytes32 findingsHash, string findingsURI,
        uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId
    );

    error NotOwner();
    error NotActiveAgent();
    error IdempotencyConflict();
    error InvalidScore();
    error InvalidStatus();
    error InvalidFindingsURI();

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
        string calldata findingsURI,
        uint16 riskScore,
        uint16 findingCount,
        uint8 status,
        uint32 targetChainId
    ) external {
        Agent storage a = agents[msg.sender];
        if (!a.active) revert NotActiveAgent();
        if (riskScore > 100) revert InvalidScore();
        if (status > 1) revert InvalidStatus();
        // "" passes (degraded mode); any non-empty URI is capped at 256 bytes.
        if (bytes(findingsURI).length > MAX_FINDINGS_URI_BYTES) revert InvalidFindingsURI();

        Attestation storage existing = _attestations[reviewId];
        if (existing.agent != address(0)) {
            // Webhook-redelivery idempotency: identical payload → no-op.
            if (
                existing.commitHash == commitHash && existing.findingsHash == findingsHash
                    && keccak256(bytes(existing.findingsURI)) == keccak256(bytes(findingsURI))
                    && existing.riskScore == riskScore && existing.findingCount == findingCount
                    && existing.status == status && existing.targetChainId == targetChainId
            ) {
                return;
            }
            revert IdempotencyConflict();
        }

        _attestations[reviewId] = Attestation(
            msg.sender, commitHash, findingsHash, findingsURI, riskScore, findingCount, status, targetChainId
        );
        a.reviewCount += 1;
        emit Attested(
            reviewId, msg.sender, commitHash, findingsHash, findingsURI, riskScore, findingCount, status, targetChainId
        );
    }

    function attestations(bytes32 reviewId)
        external
        view
        returns (
            address agent, bytes32 commitHash, bytes32 findingsHash, string memory findingsURI,
            uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId
        )
    {
        Attestation storage a = _attestations[reviewId];
        return (a.agent, a.commitHash, a.findingsHash, a.findingsURI, a.riskScore, a.findingCount, a.status, a.targetChainId);
    }

    function verify(
        bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, string calldata findingsURI,
        uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId
    ) external view returns (bool) {
        Attestation storage a = _attestations[reviewId];
        return a.agent != address(0) && a.commitHash == commitHash && a.findingsHash == findingsHash
            && keccak256(bytes(a.findingsURI)) == keccak256(bytes(findingsURI))
            && a.riskScore == riskScore && a.findingCount == findingCount && a.status == status
            && a.targetChainId == targetChainId;
    }
}
