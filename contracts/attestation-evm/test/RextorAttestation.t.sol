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
        (, , uint64 reviews) = c.agents(address(this));
        assertEqUint(reviews, 1);
    }

    function test_attest_idempotent_samePayload() public {
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0);
        c.attest(REVIEW_ID, COMMIT, FINDINGS, 85, 3, 0); // no revert
        (, , uint64 reviews) = c.agents(address(this));
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
