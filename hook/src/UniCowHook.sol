// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary, add} from "v4-core/types/BalanceDelta.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import "forge-std/console2.sol";

interface IServiceManager {
    function createNewTask(
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        address sender,
        bytes32 poolId
    ) external;
}

contract UniCowHook is BaseHook {
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;
    using BalanceDeltaLibrary for BalanceDelta;
    address public serviceManager;

    mapping(bytes32 => PoolKey) public poolKeys;

    struct TransferBalance {
        uint256 amount;
        address currency;
        address sender;
    }

    struct SwapBalance {
        int256 amountSpecified;
        bool zeroForOne;
        uint160 sqrtPriceLimitX96;
    }

    modifier onlyAVS() {
        require(
            msg.sender == address(serviceManager),
            "Only AVS Service Manager can call this function"
        );
        _;
    }

    // Initialize BaseHook and ERC20
    constructor(
        IPoolManager _manager,
        address _serviceManager
    ) BaseHook(_manager) {
        serviceManager = _serviceManager;
    }

    event PendingOrder(
        address indexed sender,
        IPoolManager.SwapParams swapParams
    );

    // Set up hook permissions to return `true`
    // for the two hook functions we are using
    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterAddLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    function afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24,
        bytes calldata
    ) external override returns (bytes4) {
        poolKeys[PoolId.unwrap(key.toId())] = key;
        return this.afterInitialize.selector;
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata swapParams,
        bytes calldata hookData
    )
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length == 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // get the sender from the hookData
        (int8 cowEnabled, address sender) = abi.decode(
            hookData,
            (int8, address)
        );

        // If first byte of hookData is not 0x01, COW not enabled
        if (cowEnabled != 1 || swapParams.amountSpecified > 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        if (sender == address(0)) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }
        console2.log("checks passed");
        poolManager.mint(
            address(this),
            (swapParams.zeroForOne ? key.currency0 : key.currency1).toId(),
            uint256(-swapParams.amountSpecified)
        );
        console2.log("minting");
        IServiceManager(serviceManager).createNewTask(
            swapParams.zeroForOne,
            swapParams.amountSpecified,
            swapParams.sqrtPriceLimitX96,
            sender,
            PoolId.unwrap(key.toId())
        );
        console2.log("task created");
        return (
            this.beforeSwap.selector,
            toBeforeSwapDelta(-int128(swapParams.amountSpecified), 0),
            0
        );
    }

    function _unlockCallback(
        bytes calldata data
    ) internal override returns (bytes memory) {
        (
            PoolKey memory key,
            TransferBalance[] memory transferBalances,
            SwapBalance[] memory swapBalances
        ) = abi.decode(data, (PoolKey, TransferBalance[], SwapBalance[]));
        for (uint256 i = 0; i < transferBalances.length; i++) {
            //  convert from claim tokens to actual tokens and send to user
            uint256 amount = transferBalances[i].amount;

            poolManager.burn(
                address(this),
                Currency.wrap(transferBalances[i].currency).toId(),
                amount
            );

            poolManager.take(
                Currency.wrap(transferBalances[i].currency),
                transferBalances[i].sender,
                amount
            );
        }

        BalanceDelta swapDelta = BalanceDeltaLibrary.ZERO_DELTA;
        //  handle swaps
        for (uint256 i = 0; i < swapBalances.length; i++) {
            BalanceDelta _swapDelta = poolManager.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: swapBalances[i].zeroForOne,
                    amountSpecified: swapBalances[i].amountSpecified,
                    sqrtPriceLimitX96: swapBalances[i].sqrtPriceLimitX96
                }),
                new bytes(0)
            );
            swapDelta = add(swapDelta, _swapDelta);
        }

        if (swapDelta.amount0() > 0) {
            key.currency0.take(
                poolManager,
                address(this),
                uint256(int256(swapDelta.amount0())),
                false
            );
        }

        if (swapDelta.amount0() < 0) {
            key.currency0.settle(
                poolManager,
                address(this),
                uint256(-int256(swapDelta.amount0())),
                true
            );
        }

        if (swapDelta.amount1() > 0) {
            key.currency1.take(
                poolManager,
                address(this),
                uint256(int256(swapDelta.amount1())),
                false
            );
        }
        if (swapDelta.amount1() < 0) {
            key.currency1.settle(
                poolManager,
                address(this),
                uint256(-int256(swapDelta.amount1())),
                true
            );
        }
        return new bytes(0);
    }
    //  function to settle balances

    function settleBalances(
        bytes32 poolId,
        TransferBalance[] memory transferBalances,
        SwapBalance[] memory swapBalances
    ) external onlyAVS {
        poolManager.unlock(
            abi.encode(poolKeys[poolId], transferBalances, swapBalances)
        );
    }

    receive() external payable {}
}
