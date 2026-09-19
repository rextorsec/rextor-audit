// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RextorAttestation.sol";

contract RextorAttestationTest is Test {
    RextorAttestation internal c;
    bytes32 internal constant REVIEW_ID = keccak256("rextor/review/v1|rextorsec/rextor-audit|1|abc123");
    bytes32 internal constant COMMIT = bytes32(bytes20(hex"0000000000000000000000000000000000000001"));
    bytes32 internal constant FINDINGS = keccak256("findings");
    // SPEC-4 v2: degraded-mode default used by every pre-v2-shaped test path.
    string internal constant NO_URI = "";
    uint32 internal constant TARGET_CHAIN = 42431;

    function setUp() public {
        c = new RextorAttestation();
        c.registerAgent(address(this), "rextor-audit-bot");
    }

    function test_attest_happy() public {
        string memory uri = "ipfs://bafytest/report.json";
        vm.expectEmit(true, true, false, true);
        emit RextorAttestation.Attested(
            REVIEW_ID, address(this), COMMIT, FINDINGS, uri, 85, 3, 0, TARGET_CHAIN
        );
        c.attest(REVIEW_ID, COMMIT, FINDINGS, uri, 85, 3, 0, TARGET_CHAIN);
        (
            address agent, bytes32 ch, bytes32 fh, string memory storedUri,
            uint16 score, uint16 count, uint8 status, uint32 chainId
        ) = c.attestations(REVIEW_ID);
        assertEq(agent, address(this));
        assertEq(ch, COMMIT);
        assertEq(fh, FINDINGS);
        assertEq(storedUri, uri);
        assertEqUint(score, 85);
        assertEqUint(count, 3);
        assertEqUint(status, 0);
        assertEqUint(chainId, TARGET_CHAIN);
        assertTrue(c.verify(REVIEW_ID, COMMIT, FINDINGS, uri, 85, 3, 0, TARGET_CHAIN));
        (, , uint64 reviews) = c.agents(address(this));
        assertEqUint(reviews, 1);
    }

    function test_attest_emptyUriIsValid_degradedMode() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN);
        (, , , string memory storedUri, , , , ) = c.attestations(REVIEW_ID);
        assertEq(bytes(storedUri).length, 0);
        assertTrue(c.verify(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN));
    }

    function test_attest_uriAt256BytesAccepted() public {
        string memory uri = string(new bytes(256));
        c.attest(REVIEW_ID, COMMIT, FINDINGS, uri, 1, 0, 0, TARGET_CHAIN);
        (, , , string memory storedUri, , , , ) = c.attestations(REVIEW_ID);
        assertEq(bytes(storedUri).length, 256);
    }

    function test_attest_uriOver256BytesReverts() public {
        string memory uri = string(new bytes(257));
        vm.expectRevert(RextorAttestation.InvalidFindingsURI.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, uri, 1, 0, 0, TARGET_CHAIN);
    }

    function test_attest_idempotent_samePayload() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN); // no revert
        (, , uint64 reviews) = c.agents(address(this));
        assertEqUint(reviews, 1); // count only once
    }

    function test_attest_conflict_reverts() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN);
        vm.expectRevert(RextorAttestation.IdempotencyConflict.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 86, 3, 0, TARGET_CHAIN);
    }

    function test_attest_conflict_reverts_onChangedUri() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, "ipfs://one", 85, 3, 0, TARGET_CHAIN);
        vm.expectRevert(RextorAttestation.IdempotencyConflict.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, "ipfs://two", 85, 3, 0, TARGET_CHAIN);
    }

    function test_attest_conflict_reverts_onChangedTargetChainId() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, 42431);
        vm.expectRevert(RextorAttestation.IdempotencyConflict.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, 998);
    }

    function test_attest_unregisteredAgentReverts() public {
        vm.prank(address(0xdead));
        vm.expectRevert(RextorAttestation.NotActiveAgent.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 1, 1, 0, TARGET_CHAIN);
    }

    function test_attest_deactivatedAgentReverts() public {
        c.setAgentActive(address(this), false);
        vm.expectRevert(RextorAttestation.NotActiveAgent.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 1, 1, 0, TARGET_CHAIN);
    }

    function test_attest_invalidScoreReverts() public {
        vm.expectRevert(RextorAttestation.InvalidScore.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 101, 0, 0, TARGET_CHAIN);
    }

    function test_attest_invalidStatusReverts() public {
        vm.expectRevert(RextorAttestation.InvalidStatus.selector);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 10, 0, 2, TARGET_CHAIN);
    }

    function test_attest_incompleteStatusRoundTrip() public {
        c.attest(REVIEW_ID, bytes32(0), bytes32(0), NO_URI, 0, 0, 1, TARGET_CHAIN);
        assertTrue(c.verify(REVIEW_ID, bytes32(0), bytes32(0), NO_URI, 0, 0, 1, TARGET_CHAIN));
    }

    function test_verify_falseOnMismatch() public view {
        assertFalse(c.verify(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN));
    }

    function test_verify_falseOnUriMismatch() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, "ipfs://real", 85, 3, 0, TARGET_CHAIN);
        assertFalse(c.verify(REVIEW_ID, COMMIT, FINDINGS, "ipfs://other", 85, 3, 0, TARGET_CHAIN));
    }

    function test_verify_falseOnTargetChainIdMismatch() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN);
        assertFalse(c.verify(REVIEW_ID, COMMIT, FINDINGS, NO_URI, 85, 3, 0, TARGET_CHAIN + 1));
    }

    function test_register_gatedToOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert(RextorAttestation.NotOwner.selector);
        c.registerAgent(address(0xbeef), "evil");
    }
}
