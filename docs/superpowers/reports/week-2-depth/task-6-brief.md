### Task 6: SPEC-4 attestation contract (Foundry)

**Files:**
- Create: `contracts/attestation-evm/foundry.toml`, `contracts/attestation-evm/src/RextorAttestation.sol`, `contracts/attestation-evm/test/RextorAttestation.t.sol`, `contracts/attestation-evm/script/Deploy.s.sol`

**Interfaces:**
- Consumes: nothing from packages (standalone Foundry project; NOT in the pnpm workspace — add `contracts/` to the root `.gitignore`'s build outputs the same way fixtures do: ignore `contracts/attestation-evm/out` and `cache`).
- Produces: deployed-bytecode contract `RextorAttestation` with EXACT ABI (Task 8 encodes against it):
  - `function registerAgent(address agent, string calldata name) external` (onlyOwner)
  - `function setAgentActive(address agent, bool active) external` (onlyOwner)
  - `function attest(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status) external`
  - `function attestations(bytes32) external view returns (address agent, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status)`
  - `function verify(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status) external view returns (bool)`
  - errors `NotOwner()`, `NotActiveAgent()`, `IdempotencyConflict()`, `InvalidScore()`, `InvalidStatus()`; events `AgentRegistered(address indexed, string)`, `AgentActiveChanged(address indexed, bool)`, `Attested(bytes32 indexed reviewId, address indexed agent, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status)`.

- [ ] **Step 1: Write the failing tests**

`contracts/attestation-evm/test/RextorAttestation.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RextorAttestation.sol";

contract RextorAttestationTest is Test {
    RextorAttestation internal c;
    bytes32 internal constant REVIEW_ID = keccak256("rextor/review/v1|rextorsec/rextor-audit|1|abc123");
    bytes32 internal constant COMMIT = bytes32(bytes20(hex"0000000000000000000000000000000000000001"));
    bytes32 internal constant FINDINGS = keccak256("findings");

    function setUp() public {
        c = new RextorAttestation();
        c.registerAgent(address(this), "rextor-audit-bot");
    }

    function test_attest_happy() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0);
        (address agent, bytes32 ch, bytes32 fh, uint16 score, uint16 count, uint8 status) =
            c.attestations(REVIEW_ID);
        assertEq(agent, address(this));
        assertEq(ch, COMMIT);
        assertEq(fh, FINDINGS);
            assertEqUint(score, 85);
            assertEqUint(count, 3);
            assertEqUint(status, 0);
        assertTrue(c.verify(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0));
        (, , , , , uint64 reviews) = c.agents(address(this));
            assertEqUint(reviews, 1);
    }

    function test_attest_idempotent_samePayload() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0); // no revert
        (, , , , , uint64 reviews) = c.agents(address(this));
            assertEqUint(reviews, 1); // count only once
    }

    function test_attest_conflict_reverts() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0);
        vm.expectRevert(RextorAttestation.IdempotencyConflict.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 86, 3, 0);
    }

    function test_attest_unregisteredAgentReverts() public {
        vm.prank(address(0xdead));
        vm.expectRevert(RextorAttestation.NotActiveAgent.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 1, 1, 0);
    }

    function test_attest_deactivatedAgentReverts() public {
        c.setAgentActive(address(this), false);
        vm.expectRevert(RextorAttestation.NotActiveAgent.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 1, 1, 0);
    }

    function test_attest_invalidScoreReverts() public {
        vm.expectRevert(RextorAttestation.InvalidScore.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 101, 0, 0);
    }

    function test_attest_invalidStatusReverts() public {
        vm.expectRevert(RextorAttestation.InvalidStatus.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 10, 0, 2);
    }

    function test_attest_incompleteStatusRoundTrip() public {
        c.attest(REVIEW_ID, bytes32(0), bytes32(0), 0, 0, 1);
        assertTrue(c.verify(REVIEW_ID, bytes32(0), bytes32(0), 0, 0, 1));
    }

    function test_verify_falseOnMismatch() public view {
        assertFalse(c.verify(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0));
    }

    function test_register_gatedToOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert(RextorAttestation.NotOwner.selector);
        c.registerAgent(address(0xbeef), "evil");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd contracts/attestation-evm && forge test`
Expected: FAIL — `RextorAttestation` not found (CompilationError).

- [ ] **Step 3: Implement**

`foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
```

(`forge install foundry-rs/forge-std --no-git` if `lib/forge-std` is not already reachable; record provenance in a `PROVENANCE.md` like `fixtures/vault`'s.)

`src/RextorAttestation.sol`:

```solidity
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
```

`script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RextorAttestation.sol";

contract Deploy is Script {
    function run() public {
        uint256 pk = vm.envUint("DEPLOY_PRIVATE_KEY");
        vm.startBroadcast(pk);
        new RextorAttestation();
        vm.stopBroadcast();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd contracts/attestation-evm && forge build && forge test`
Expected: 10 passed. Then `cd ../.. && pnpm test:run && pnpm typecheck` — green (contracts don't touch the pnpm gate).

- [ ] **Step 5: Commit**

```bash
git add contracts/attestation-evum .gitignore  # (fix the typo: contracts/attestation-evm)
git commit -m "feat: SPEC-4 RextorAttestation contract — agent registry, idempotent attest, verify"
```

---

