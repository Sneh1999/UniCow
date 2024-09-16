// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {Quoter} from "v4-periphery/src/lens/Quoter.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {UniCowHook} from "../src/UniCowHook.sol";
import {HookMiner} from "../test/utils/HookMiner.sol";

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "forge-std/StdCheats.sol";

contract HookDeployer is Script, StdCheats {
    IPoolManager manager;
    PoolModifyLiquidityTest lpRouter;
    PoolSwapTest swapRouter;
    Quoter quoter;

    Currency token0;
    Currency token1;

    UniCowHook hook;
    uint160 constant SQRT_PRICE_1_4 = 158456325028528675187087900672;

    function run(address serviceManager) external {
        vm.createSelectFork("http://localhost:8545");

        vm.startBroadcast();
        deployFreshManagerAndRouters();
        quoter = new Quoter(manager);
        deployMintAndApprove2Currencies();

        deployHookToAnvil(serviceManager);

        initPoolAndAddLiquidity();
        vm.stopBroadcast();

        // WRITE JSON DATA
        string memory parent_object = "parent object";
        string memory deployed_addresses = "addresses";
        vm.serializeAddress(
            deployed_addresses,
            "poolManager",
            address(manager)
        );
        vm.serializeAddress(deployed_addresses, "quoter", address(quoter));
        vm.serializeAddress(deployed_addresses, "lpRouter", address(lpRouter));
        vm.serializeAddress(
            deployed_addresses,
            "swapRouter",
            address(swapRouter)
        );
        vm.serializeAddress(
            deployed_addresses,
            "token0",
            Currency.unwrap(token0)
        );
        vm.serializeAddress(
            deployed_addresses,
            "token1",
            Currency.unwrap(token1)
        );
        string memory deployed_addresses_output = vm.serializeAddress(
            deployed_addresses,
            "hook",
            address(hook)
        );

        string memory final_json = vm.serializeString(
            parent_object,
            deployed_addresses,
            deployed_addresses_output
        );
        string memory outputDir = string.concat(
            vm.projectRoot(),
            "/script/output/"
        );
        string memory chainDir = string.concat(vm.toString(block.chainid), "/");
        string memory outputFilePath = string.concat(
            outputDir,
            chainDir,
            "unicow_hook_deployment_output",
            ".json"
        );
        vm.writeJson(final_json, outputFilePath);
    }

    function deployFreshManagerAndRouters() internal {
        manager = IPoolManager(address(new PoolManager()));

        lpRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
    }

    function deployMintAndApprove2Currencies() internal {
        MockERC20 tokenA = new MockERC20("MockA", "A", 18);
        MockERC20 tokenB = new MockERC20("MockB", "B", 18);
        if (uint160(address(tokenA)) < uint160(address(tokenB))) {
            token0 = Currency.wrap(address(tokenA));
            token1 = Currency.wrap(address(tokenB));
        } else {
            token0 = Currency.wrap(address(tokenB));
            token1 = Currency.wrap(address(tokenA));
        }

        tokenA.mint(msg.sender, 100_000 ether);
        tokenB.mint(msg.sender, 100_000 ether);

        tokenA.approve(address(lpRouter), type(uint256).max);
        tokenB.approve(address(lpRouter), type(uint256).max);
        tokenA.approve(address(swapRouter), type(uint256).max);
        tokenB.approve(address(swapRouter), type(uint256).max);
    }

    function deployHookToAnvil(address serviceManager) internal {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_FACTORY,
            flags,
            type(UniCowHook).creationCode,
            abi.encode(address(manager), serviceManager)
        );
        hook = new UniCowHook{salt: salt}(manager, serviceManager);
        require(address(hook) == hookAddress, "hook: hook address mismatch");
    }

    function initPoolAndAddLiquidity() internal {
        PoolKey memory poolKey = PoolKey({
            currency0: token0,
            currency1: token1,
            fee: 3000,
            tickSpacing: 120,
            hooks: hook
        });
        manager.initialize(
            poolKey,
            SQRT_PRICE_1_4, // 1 A = 4 B roughly
            new bytes(0)
        );

        lpRouter.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(120),
                tickUpper: TickMath.maxUsableTick(120),
                liquidityDelta: 2000 ether,
                salt: bytes32(0)
            }),
            new bytes(0)
        );

        swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            new bytes(0)
        );
    }
}
