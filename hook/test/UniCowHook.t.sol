// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";

import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";

import "forge-std/console.sol";
import "forge-std/Test.sol";

import {UniCowHook} from "../src/UniCowHook.sol";
import {MockServiceManager} from "../src/MockServiceManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

contract TestUniCowHook is Test, Deployers {
    using CurrencyLibrary for Currency;

    UniCowHook hook;
    MockServiceManager serviceManager;

    function setUp() public {
        deployFreshManagerAndRouters();

        (currency0, currency1) = deployMintAndApprove2Currencies();

        serviceManager = new MockServiceManager();

        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                Hooks.AFTER_INITIALIZE_FLAG
        );
        deployCodeTo(
            "UniCowHook.sol:UniCowHook",
            abi.encode(manager, address(serviceManager)),
            address(flags)
        );
        hook = UniCowHook(payable(address(flags)));

        (key, ) = initPool(
            currency0,
            currency1,
            hook,
            3000,
            SQRT_PRICE_1_1,
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity{value: 10 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 1 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );
    }

    function test_beforeSwapPendingOrder() public {
        // swap 10 tokens for eth
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -0.001 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            abi.encode(uint8(1), address(this))
        );

        // get balance delta for hook
        assertEq(
            manager.balanceOf(address(hook), currency0.toId()),
            0.001 ether
        );
    }

    function test_settleBalances() public {
        MockERC20(Currency.unwrap(key.currency0)).mint(address(0x1), 1 ether);

        vm.startPrank(address(0x1));
        MockERC20(Currency.unwrap(key.currency0)).approve(
            address(swapRouter),
            type(uint256).max
        );
        // zeroForOne true
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -0.001 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            abi.encode(uint8(1), address(this))
        );
        vm.stopPrank();
        MockERC20(Currency.unwrap(key.currency1)).mint(address(0x2), 1 ether);
        vm.startPrank(address(0x2));
        MockERC20(Currency.unwrap(key.currency1)).approve(
            address(swapRouter),
            type(uint256).max
        );
        // zeroForOne false - Exact Input
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -0.001 ether,
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            abi.encode(uint8(1), address(this))
        );
        vm.stopPrank();
        MockERC20(Currency.unwrap(key.currency1)).mint(address(0x3), 1 ether);
        vm.startPrank(address(0x3));
        MockERC20(Currency.unwrap(key.currency1)).approve(
            address(swapRouter),
            type(uint256).max
        );
        // zeroForOne false - Exact Input
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -0.001 ether,
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            abi.encode(uint8(1), address(this))
        );

        UniCowHook.TransferBalance[]
            memory transferBalances = new UniCowHook.TransferBalance[](2);

        UniCowHook.SwapBalance[]
            memory swapBalances = new UniCowHook.SwapBalance[](1);

        transferBalances[0] = UniCowHook.TransferBalance({
            amount: 0.001 ether,
            currency: Currency.unwrap(key.currency1),
            sender: address(0x1)
        });

        transferBalances[1] = UniCowHook.TransferBalance({
            amount: 0.001 ether,
            currency: Currency.unwrap(key.currency0),
            sender: address(0x2)
        });

        swapBalances[0] = UniCowHook.SwapBalance({
            zeroForOne: false,
            amountSpecified: -0.001 ether,
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        });
        vm.stopPrank();
        vm.startPrank(address(serviceManager));
        hook.settleBalances(
            PoolId.unwrap(key.toId()),
            transferBalances,
            swapBalances
        );
        vm.stopPrank();
        assertEq(currency1.balanceOf(address(0x1)), 0.001 ether);
        assertEq(currency0.balanceOf(address(0x2)), 0.001 ether);
        assertGt(currency1.balanceOf(address(0x3)), 0);
    }
}
