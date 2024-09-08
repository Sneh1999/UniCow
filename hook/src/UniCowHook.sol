// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

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
    address serviceManager;

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
                afterInitialize: false,
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
        // get the sender from the hookData
        (int8 cowEnabled, address sender) = abi.decode(
            hookData,
            (int8, address)
        );
        // If first byte of hookData is not 0x01, COW not enabled
        if (cowEnabled != 1 || swapParams.amountSpecified > 0) {
            return (UniCowHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        if (sender == address(0)) {
            return (UniCowHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        poolManager.mint(
            address(this),
            (swapParams.zeroForOne ? key.currency0 : key.currency1).toId(),
            uint256(-swapParams.amountSpecified)
        );

        IServiceManager(serviceManager).createNewTask(
            swapParams.zeroForOne,
            swapParams.amountSpecified,
            swapParams.sqrtPriceLimitX96,
            sender,
            PoolId.unwrap(key.toId())
        );

        return (
            UniCowHook.beforeSwap.selector,
            toBeforeSwapDelta(-int128(swapParams.amountSpecified), 0),
            0
        );
    }

    receive() external payable {}
}
