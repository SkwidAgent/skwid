// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SkwidReleaseRegistry
/// @notice Append-only hashes for operator-published software release evidence.
/// @dev A record authenticates operator publication. It is not an audit or proof of correctness.
contract SkwidReleaseRegistry is Ownable2Step {
    error InvalidHash();
    error InvalidRole(address account);
    error NotOperator(address caller);
    error OwnershipRenunciationDisabled();
    error ReleaseAlreadyPublished(bytes32 releaseHash);
    error UnknownSupersededRelease(bytes32 releaseHash);

    struct Release {
        bytes32 entryHash;
        bytes32 previousEntryHash;
        bytes32 releaseHash;
        bytes32 contentHash;
        bytes32 sourceCommitHash;
        bytes32 artifactHash;
        bytes32 supersedesReleaseHash;
        uint64 publishedAt;
    }

    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event ReleasePublished(
        uint256 indexed sequence,
        bytes32 indexed releaseHash,
        bytes32 indexed entryHash,
        bytes32 previousEntryHash,
        bytes32 contentHash,
        bytes32 sourceCommitHash,
        bytes32 artifactHash,
        bytes32 supersedesReleaseHash
    );

    address public operator;
    uint256 public releaseCount;
    bytes32 public latestEntryHash;
    mapping(uint256 sequence => Release release) public releases;
    mapping(bytes32 releaseHash => uint256 sequence) public releaseSequence;

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    constructor(address initialOwner, address initialOperator) Ownable(initialOwner) {
        if (initialOperator == address(0) || initialOperator == initialOwner) {
            revert InvalidRole(initialOperator);
        }
        operator = initialOperator;
        emit OperatorUpdated(address(0), initialOperator);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0) || newOperator == owner()) revert InvalidRole(newOperator);
        address previous = operator;
        operator = newOperator;
        emit OperatorUpdated(previous, newOperator);
    }

    function acceptOwnership() public override {
        if (msg.sender == operator) revert InvalidRole(msg.sender);
        super.acceptOwnership();
    }

    function publishRelease(
        bytes32 contentHash,
        bytes32 sourceCommitHash,
        bytes32 artifactHash,
        bytes32 supersedesReleaseHash
    ) external onlyOperator returns (uint256 sequence, bytes32 releaseHash, bytes32 entryHash) {
        if (
            contentHash == bytes32(0) || sourceCommitHash == bytes32(0)
                || artifactHash == bytes32(0)
        ) {
            revert InvalidHash();
        }
        if (supersedesReleaseHash != bytes32(0) && releaseSequence[supersedesReleaseHash] == 0) {
            revert UnknownSupersededRelease(supersedesReleaseHash);
        }

        releaseHash = keccak256(abi.encode(contentHash, sourceCommitHash, artifactHash));
        if (releaseSequence[releaseHash] != 0) revert ReleaseAlreadyPublished(releaseHash);

        sequence = ++releaseCount;
        bytes32 previousEntryHash = latestEntryHash;
        entryHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                sequence,
                previousEntryHash,
                releaseHash,
                supersedesReleaseHash
            )
        );
        releases[sequence] = Release({
            entryHash: entryHash,
            previousEntryHash: previousEntryHash,
            releaseHash: releaseHash,
            contentHash: contentHash,
            sourceCommitHash: sourceCommitHash,
            artifactHash: artifactHash,
            supersedesReleaseHash: supersedesReleaseHash,
            publishedAt: uint64(block.timestamp)
        });
        releaseSequence[releaseHash] = sequence;
        latestEntryHash = entryHash;

        emit ReleasePublished(
            sequence,
            releaseHash,
            entryHash,
            previousEntryHash,
            contentHash,
            sourceCommitHash,
            artifactHash,
            supersedesReleaseHash
        );
    }

    function renounceOwnership() public pure override {
        revert OwnershipRenunciationDisabled();
    }
}
