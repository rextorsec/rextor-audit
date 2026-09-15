// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Deliberately vulnerable demo fixture — NOT for production. Ground truth for pipeline tests.
contract Vault {
    mapping(address => uint256) public deposits;
    address public owner;

    constructor() { owner = msg.sender; }

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
    }

    // VULN 1: reentrancy — external call before state zeroing
    function withdraw() external {
        uint256 amount = deposits[msg.sender];
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        deposits[msg.sender] = 0;
    }

    // VULN 2: unguarded owner change — ETH lock-in vector
    function setOwner(address next) external {
        owner = next;
    }

    // VULN 2 impact: owner-gated rescue. Whoever controls `owner` can pull
    // the vault's entire ETH balance — this is what makes the unguarded
    // setOwner above a real lock-in/drain vector instead of a dead variable.
    function rescue() external {
        require(msg.sender == owner, "only owner");
        (bool ok, ) = owner.call{value: address(this).balance}("");
        require(ok, "rescue failed");
    }
}
