// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@eigenlayer/contracts/libraries/BytesLib.sol";
import "@eigenlayer/contracts/core/DelegationManager.sol";
import {ECDSAServiceManagerBase} from "@eigenlayer-middleware/src/unaudited/ECDSAServiceManagerBase.sol";
import "@eigenlayer-middleware/src/unaudited/ECDSAStakeRegistry.sol";
import "@openzeppelin-upgrades/contracts/utils/cryptography/ECDSAUpgradeable.sol";
import "@eigenlayer/contracts/permissions/Pausable.sol";
import {IRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/IRegistryCoordinator.sol";

interface IUniCowHook {
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

    function settleBalances(
        bytes32 key,
        TransferBalance[] memory transferBalances,
        SwapBalance[] memory swapBalances
    ) external;
}

contract UniCowServiceManager is ECDSAServiceManagerBase, Pausable {
    using BytesLib for bytes;
    using ECDSAUpgradeable for bytes32;

    uint32 public latestTaskNum;
    address public hook;
    mapping(uint32 => bytes32) public allTaskHashes;
    mapping(uint32 => bytes) public allTaskResponses;

    event NewTaskCreated(uint32 indexed taskIndex, Task task);
    event BatchResponse(uint32[] indexed referenceTaskIndices, address sender);

    modifier onlyOperator() {
        require(
            ECDSAStakeRegistry(stakeRegistry).operatorRegistered(msg.sender) ==
                true,
            "Only operator can call this function"
        );
        _;
    }

    struct Task {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        address sender;
        bytes32 poolId;
        uint32 taskCreatedBlock;
        uint32 taskId;
    }

    modifier onlyHook() {
        require(msg.sender == hook, "Only hook can call this function");
        _;
    }

    constructor(
        address _avsDirectory,
        address _stakeRegistry,
        address _delegationManager
    )
        ECDSAServiceManagerBase(
            _avsDirectory,
            _stakeRegistry,
            address(0),
            _delegationManager
        )
    {}

    function createNewTask(
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        address sender,
        bytes32 poolId
    ) external onlyHook {
        Task memory task = Task({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            sender: sender,
            poolId: poolId,
            taskCreatedBlock: uint32(block.number),
            taskId: latestTaskNum
        });
        allTaskHashes[latestTaskNum] = keccak256(abi.encode(task));
        emit NewTaskCreated(latestTaskNum, task);
        latestTaskNum++;
    }

    function respondToBatch(
        Task[] calldata tasks,
        uint32[] memory referenceTaskIndices,
        IUniCowHook.TransferBalance[] memory transferBalances,
        IUniCowHook.SwapBalance[] memory swapBalances,
        bytes calldata signature
    ) external onlyOperator {
        require(
            operatorHasMinimumWeight(msg.sender),
            "Operator does not meet minimum weight"
        );

        for (uint256 i = 0; i < referenceTaskIndices.length; i++) {
            require(
                keccak256(abi.encode(tasks[i])) ==
                    allTaskHashes[referenceTaskIndices[i]],
                "Task not found"
            );

            //  check the poolId is the same
            require(
                tasks[i].poolId == tasks[0].poolId,
                "PoolId does not match"
            );

            require(
                allTaskResponses[referenceTaskIndices[i]].length == 0,
                "Task already responded"
            );
        }

        bytes32 messageHash = keccak256(
            abi.encode(tasks[0].poolId, transferBalances, swapBalances)
        );

        address signer = ECDSAUpgradeable.recover(messageHash, signature);

        require(signer == msg.sender, "Invalid signature");

        for (uint256 i = 0; i < referenceTaskIndices.length; i++) {
            allTaskResponses[referenceTaskIndices[i]] = signature;
        }

        // call the hook contract to settle balances
        IUniCowHook(hook).settleBalances(
            tasks[0].poolId,
            transferBalances,
            swapBalances
        );

        emit BatchResponse(referenceTaskIndices, msg.sender);
    }

    function getMessageHash(
        bytes32 poolId,
        IUniCowHook.TransferBalance[] memory transferBalances,
        IUniCowHook.SwapBalance[] memory swapBalances
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(poolId, transferBalances, swapBalances));
    }

    function operatorHasMinimumWeight(
        address operator
    ) public view returns (bool) {
        return
            ECDSAStakeRegistry(stakeRegistry).getOperatorWeight(operator) >=
            ECDSAStakeRegistry(stakeRegistry).minimumWeight();
    }

    function setHook(address _hook) external {
        hook = _hook;
    }
}
