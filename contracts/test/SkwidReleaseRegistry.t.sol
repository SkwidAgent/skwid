// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SkwidReleaseRegistry} from "../src/SkwidReleaseRegistry.sol";

contract SkwidReleaseRegistryTest is Test {
    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    SkwidReleaseRegistry internal registry;

    function setUp() public {
        registry = new SkwidReleaseRegistry(owner, operator);
    }

    function testConstructorRejectsInvalidRoles() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SkwidReleaseRegistry(address(0), operator);

        vm.expectRevert(
            abi.encodeWithSelector(SkwidReleaseRegistry.InvalidRole.selector, address(0))
        );
        new SkwidReleaseRegistry(owner, address(0));

        vm.expectRevert(abi.encodeWithSelector(SkwidReleaseRegistry.InvalidRole.selector, owner));
        new SkwidReleaseRegistry(owner, owner);
    }

    function testOnlyOperatorPublishes() public {
        vm.expectRevert(abi.encodeWithSelector(SkwidReleaseRegistry.NotOperator.selector, stranger));
        vm.prank(stranger);
        registry.publishRelease(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), 0);
    }

    function testPublishesAppendOnlyHashChain() public {
        vm.prank(operator);
        (uint256 firstSequence, bytes32 firstRelease, bytes32 firstEntry) = registry.publishRelease(
            bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), 0
        );
        vm.prank(operator);
        (uint256 secondSequence, bytes32 secondRelease, bytes32 secondEntry) = registry.publishRelease(
            bytes32(uint256(4)), bytes32(uint256(5)), bytes32(uint256(6)), firstRelease
        );

        assertEq(firstSequence, 1);
        assertEq(secondSequence, 2);
        assertTrue(firstRelease != secondRelease);
        assertTrue(firstEntry != secondEntry);
        (bytes32 storedEntry, bytes32 previousEntry,,,,, bytes32 supersedes,) = registry.releases(2);
        assertEq(storedEntry, secondEntry);
        assertEq(previousEntry, firstEntry);
        assertEq(supersedes, firstRelease);
        assertEq(registry.latestEntryHash(), secondEntry);
    }

    function testRejectsReleaseReplay() public {
        bytes32 content = bytes32(uint256(1));
        bytes32 commitHash = bytes32(uint256(2));
        bytes32 artifact = bytes32(uint256(3));
        vm.prank(operator);
        (, bytes32 releaseHash,) = registry.publishRelease(content, commitHash, artifact, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                SkwidReleaseRegistry.ReleaseAlreadyPublished.selector, releaseHash
            )
        );
        vm.prank(operator);
        registry.publishRelease(content, commitHash, artifact, 0);
    }

    function testRejectsUnknownSupersededRelease() public {
        bytes32 missing = keccak256("missing");
        vm.expectRevert(
            abi.encodeWithSelector(SkwidReleaseRegistry.UnknownSupersededRelease.selector, missing)
        );
        vm.prank(operator);
        registry.publishRelease(
            bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), missing
        );
    }

    function testOwnerChangesOperatorAndOwnershipUsesTwoSteps() public {
        address nextOperator = makeAddr("nextOperator");
        vm.prank(owner);
        registry.setOperator(nextOperator);
        assertEq(registry.operator(), nextOperator);

        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        registry.transferOwnership(nextOwner);
        assertEq(registry.owner(), owner);
        vm.prank(nextOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), nextOwner);
    }

    function testOperatorCannotAcceptOwnership() public {
        vm.prank(owner);
        registry.transferOwnership(operator);
        vm.expectRevert(abi.encodeWithSelector(SkwidReleaseRegistry.InvalidRole.selector, operator));
        vm.prank(operator);
        registry.acceptOwnership();
        assertEq(registry.owner(), owner);
    }

    function testRejectsZeroHashes() public {
        vm.expectRevert(SkwidReleaseRegistry.InvalidHash.selector);
        vm.prank(operator);
        registry.publishRelease(0, bytes32(uint256(2)), bytes32(uint256(3)), 0);
    }

    function testOwnershipCannotBeRenounced() public {
        vm.expectRevert(SkwidReleaseRegistry.OwnershipRenunciationDisabled.selector);
        vm.prank(owner);
        registry.renounceOwnership();
    }
}
