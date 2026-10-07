// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SkwidFeeTreasury} from "../src/SkwidFeeTreasury.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReentrantTreasurer {
    SkwidFeeTreasury public immutable treasury;
    bool public reentryBlocked;
    bool private attempted;

    constructor(address owner) {
        treasury = new SkwidFeeTreasury(owner, address(this));
    }

    function withdraw(uint256 amount) external {
        treasury.withdrawNative(payable(address(this)), amount);
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            (bool ok,) = address(treasury)
                .call(
                    abi.encodeCall(SkwidFeeTreasury.withdrawNative, (payable(address(this)), 1 wei))
                );
            reentryBlocked = !ok;
        }
    }
}

contract SkwidFeeTreasuryTest is Test {
    address internal owner = makeAddr("owner");
    address internal treasurer = makeAddr("treasurer");
    address internal recipient = makeAddr("recipient");
    address internal depositor = makeAddr("depositor");
    SkwidFeeTreasury internal treasury;
    MockToken internal token;

    function setUp() public {
        treasury = new SkwidFeeTreasury(owner, treasurer);
        token = new MockToken();
    }

    function testConstructorRejectsInvalidRoles() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SkwidFeeTreasury(address(0), treasurer);

        vm.expectRevert(abi.encodeWithSelector(SkwidFeeTreasury.InvalidRole.selector, address(0)));
        new SkwidFeeTreasury(owner, address(0));

        vm.expectRevert(abi.encodeWithSelector(SkwidFeeTreasury.InvalidRole.selector, owner));
        new SkwidFeeTreasury(owner, owner);
    }

    function testOwnershipTransferRequiresAcceptance() public {
        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        treasury.transferOwnership(nextOwner);
        assertEq(treasury.owner(), owner);
        assertEq(treasury.pendingOwner(), nextOwner);

        vm.prank(nextOwner);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), nextOwner);
        assertEq(treasury.pendingOwner(), address(0));
    }

    function testTreasurerCannotAcceptOwnership() public {
        vm.prank(owner);
        treasury.transferOwnership(treasurer);
        vm.expectRevert(abi.encodeWithSelector(SkwidFeeTreasury.InvalidRole.selector, treasurer));
        vm.prank(treasurer);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), owner);
    }

    function testOnlyOwnerChangesTreasurerAndAllowance() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        vm.prank(depositor);
        treasury.setTokenAllowed(address(token), true);

        vm.prank(owner);
        treasury.setTokenAllowed(address(token), true);
        assertTrue(treasury.isTokenAllowed(address(token)));

        address nextTreasurer = makeAddr("nextTreasurer");
        vm.prank(owner);
        treasury.setTreasurer(nextTreasurer);
        assertEq(treasury.treasurer(), nextTreasurer);
    }

    function testNativeReceiptWithdrawalAndNoDoubleWithdrawal() public {
        vm.deal(depositor, 2 ether);
        vm.prank(depositor);
        (bool sent,) = address(treasury).call{value: 2 ether}("");
        assertTrue(sent);
        assertEq(treasury.totalNativeReceived(), 2 ether);

        vm.prank(treasurer);
        treasury.withdrawNative(payable(recipient), 2 ether);
        assertEq(recipient.balance, 2 ether);
        assertEq(treasury.totalNativeWithdrawn(), 2 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                SkwidFeeTreasury.InsufficientBalance.selector, address(0), 1 wei, 0
            )
        );
        vm.prank(treasurer);
        treasury.withdrawNative(payable(recipient), 1 wei);
    }

    function testWithdrawSynchronizesUnobservedNativeBalance() public {
        vm.deal(address(treasury), 3 ether);
        vm.prank(treasurer);
        treasury.withdrawNative(payable(recipient), 1 ether);
        assertEq(treasury.totalNativeReceived(), 3 ether);
        assertEq(treasury.totalNativeWithdrawn(), 1 ether);
        assertEq(address(treasury).balance, 2 ether);
    }

    function testDirectTokenReceiptIsSynchronizedBeforeWithdrawal() public {
        vm.prank(owner);
        treasury.setTokenAllowed(address(token), true);
        token.mint(address(treasury), 100 ether);

        vm.prank(treasurer);
        uint256 spent = treasury.withdrawToken(address(token), recipient, 40 ether);
        assertEq(spent, 40 ether);
        assertEq(token.balanceOf(recipient), 40 ether);
        assertEq(treasury.totalTokenReceived(address(token)), 100 ether);
        assertEq(treasury.totalTokenWithdrawn(address(token)), 40 ether);
    }

    function testDepositTokenRecordsActualReceipt() public {
        vm.prank(owner);
        treasury.setTokenAllowed(address(token), true);
        token.mint(depositor, 10 ether);
        vm.startPrank(depositor);
        token.approve(address(treasury), 10 ether);
        uint256 received = treasury.depositToken(address(token), 10 ether);
        vm.stopPrank();

        assertEq(received, 10 ether);
        assertEq(treasury.totalTokenReceived(address(token)), 10 ether);
    }

    function testUnallowlistedTokenCannotBeDepositedOrWithdrawn() public {
        vm.expectRevert(
            abi.encodeWithSelector(SkwidFeeTreasury.TokenNotAllowed.selector, address(token))
        );
        treasury.depositToken(address(token), 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(SkwidFeeTreasury.TokenNotAllowed.selector, address(token))
        );
        vm.prank(treasurer);
        treasury.withdrawToken(address(token), recipient, 1 ether);
    }

    function testUnauthorizedAccountCannotWithdraw() public {
        vm.expectRevert(abi.encodeWithSelector(SkwidFeeTreasury.NotTreasurer.selector, depositor));
        vm.prank(depositor);
        treasury.withdrawNative(payable(recipient), 1 wei);
    }

    function testNativeWithdrawalBlocksReentrancy() public {
        ReentrantTreasurer attacker = new ReentrantTreasurer(owner);
        vm.deal(address(attacker.treasury()), 2 ether);
        attacker.withdraw(1 ether);

        assertTrue(attacker.reentryBlocked());
        assertEq(address(attacker.treasury()).balance, 1 ether);
        assertEq(attacker.treasury().totalNativeWithdrawn(), 1 ether);
    }

    function testOwnershipCannotBeRenounced() public {
        vm.expectRevert(SkwidFeeTreasury.OwnershipRenunciationDisabled.selector);
        vm.prank(owner);
        treasury.renounceOwnership();
    }
}
