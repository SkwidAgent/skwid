// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SkwidFeeTreasury
/// @notice Custodies fee proceeds under separate owner and treasurer roles.
/// @dev Pons fee collection is deliberately external to this contract. Direct ERC-20
///      transfers are accounted with syncToken after the token is allowlisted.
contract SkwidFeeTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AccountingDeficit(address asset, uint256 accounted, uint256 actual);
    error AmountZero();
    error InsufficientBalance(address asset, uint256 requested, uint256 available);
    error InvalidRole(address account);
    error NativeTransferFailed();
    error NotTreasurer(address caller);
    error OwnershipRenunciationDisabled();
    error TokenNotAllowed(address token);

    event NativeReceived(address indexed sender, uint256 amount, uint256 totalReceived);
    event NativeWithdrawn(
        address indexed treasurer, address indexed recipient, uint256 amount, uint256 totalWithdrawn
    );
    event TokenAllowanceUpdated(address indexed token, bool allowed);
    event TokenReceived(
        address indexed token, address indexed sender, uint256 amount, uint256 totalReceived
    );
    event TokenWithdrawn(
        address indexed token,
        address indexed treasurer,
        address indexed recipient,
        uint256 amount,
        uint256 totalWithdrawn
    );
    event TreasurerUpdated(address indexed previousTreasurer, address indexed newTreasurer);

    address public treasurer;
    uint256 public totalNativeReceived;
    uint256 public totalNativeWithdrawn;
    mapping(address token => bool allowed) public isTokenAllowed;
    mapping(address token => uint256 amount) public totalTokenReceived;
    mapping(address token => uint256 amount) public totalTokenWithdrawn;

    modifier onlyTreasurer() {
        if (msg.sender != treasurer) revert NotTreasurer(msg.sender);
        _;
    }

    constructor(address initialOwner, address initialTreasurer) Ownable(initialOwner) {
        if (initialTreasurer == address(0) || initialTreasurer == initialOwner) {
            revert InvalidRole(initialTreasurer);
        }
        treasurer = initialTreasurer;
        emit TreasurerUpdated(address(0), initialTreasurer);
    }

    receive() external payable {
        _recordNativeReceipt(msg.sender, msg.value);
    }

    function depositNative() external payable {
        _recordNativeReceipt(msg.sender, msg.value);
    }

    /// @notice Accounts native ETH forced or otherwise transferred without invoking receive().
    function syncNative() external returns (uint256 newlyReceived) {
        newlyReceived = _syncNative();
    }

    function setTreasurer(address newTreasurer) external onlyOwner {
        if (newTreasurer == address(0) || newTreasurer == owner()) {
            revert InvalidRole(newTreasurer);
        }
        address previous = treasurer;
        treasurer = newTreasurer;
        emit TreasurerUpdated(previous, newTreasurer);
    }

    function acceptOwnership() public override {
        if (msg.sender == treasurer) revert InvalidRole(msg.sender);
        super.acceptOwnership();
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidRole(token);
        isTokenAllowed[token] = allowed;
        emit TokenAllowanceUpdated(token, allowed);
    }

    /// @notice Pulls an allowlisted token and records the actual balance increase.
    function depositToken(address token, uint256 amount)
        external
        nonReentrant
        returns (uint256 received)
    {
        if (!isTokenAllowed[token]) revert TokenNotAllowed(token);
        if (amount == 0) revert AmountZero();
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        received = asset.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert AmountZero();
        totalTokenReceived[token] += received;
        emit TokenReceived(token, msg.sender, received, totalTokenReceived[token]);
    }

    /// @notice Accounts direct transfers from a fee locker using the observed balance delta.
    function syncToken(address token) external returns (uint256 newlyReceived) {
        if (!isTokenAllowed[token]) revert TokenNotAllowed(token);
        newlyReceived = _syncToken(token);
    }

    function withdrawNative(address payable recipient, uint256 amount)
        external
        onlyTreasurer
        nonReentrant
    {
        if (recipient == address(0)) revert InvalidRole(recipient);
        if (amount == 0) revert AmountZero();
        _syncNative();
        uint256 available = address(this).balance;
        if (amount > available) revert InsufficientBalance(address(0), amount, available);
        totalNativeWithdrawn += amount;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
        emit NativeWithdrawn(msg.sender, recipient, amount, totalNativeWithdrawn);
    }

    function withdrawToken(address token, address recipient, uint256 amount)
        external
        onlyTreasurer
        nonReentrant
        returns (uint256 spent)
    {
        if (!isTokenAllowed[token]) revert TokenNotAllowed(token);
        if (recipient == address(0)) revert InvalidRole(recipient);
        if (amount == 0) revert AmountZero();
        _syncToken(token);
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        if (amount > beforeBalance) revert InsufficientBalance(token, amount, beforeBalance);
        asset.safeTransfer(recipient, amount);
        uint256 afterBalance = asset.balanceOf(address(this));
        if (afterBalance > beforeBalance) {
            revert AccountingDeficit(token, beforeBalance, afterBalance);
        }
        spent = beforeBalance - afterBalance;
        totalTokenWithdrawn[token] += spent;
        emit TokenWithdrawn(token, msg.sender, recipient, spent, totalTokenWithdrawn[token]);
    }

    function renounceOwnership() public pure override {
        revert OwnershipRenunciationDisabled();
    }

    function _recordNativeReceipt(address sender, uint256 amount) private {
        if (amount == 0) revert AmountZero();
        totalNativeReceived += amount;
        emit NativeReceived(sender, amount, totalNativeReceived);
    }

    function _syncNative() private returns (uint256 newlyReceived) {
        uint256 accounted = totalNativeReceived - totalNativeWithdrawn;
        uint256 actual = address(this).balance;
        if (actual < accounted) revert AccountingDeficit(address(0), accounted, actual);
        newlyReceived = actual - accounted;
        if (newlyReceived != 0) {
            totalNativeReceived += newlyReceived;
            emit NativeReceived(address(0), newlyReceived, totalNativeReceived);
        }
    }

    function _syncToken(address token) private returns (uint256 newlyReceived) {
        uint256 accounted = totalTokenReceived[token] - totalTokenWithdrawn[token];
        uint256 actual = IERC20(token).balanceOf(address(this));
        if (actual < accounted) revert AccountingDeficit(token, accounted, actual);
        newlyReceived = actual - accounted;
        if (newlyReceived != 0) {
            totalTokenReceived[token] += newlyReceived;
            emit TokenReceived(token, address(0), newlyReceived, totalTokenReceived[token]);
        }
    }
}
