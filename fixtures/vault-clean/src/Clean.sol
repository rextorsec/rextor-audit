// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Zero-findings fixture — guard for contract case (b): clean pass exits 0 with empty stdout.
contract Clean {
    uint256 private value;

    function set(uint256 next) external {
        value = next;
    }

    function get() external view returns (uint256) {
        return value;
    }
}
