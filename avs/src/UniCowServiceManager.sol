// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@eigenlayer/contracts/libraries/BytesLib.sol";
import "@eigenlayer/contracts/core/DelegationManager.sol";
import {ECDSAServiceManagerBase} from "@eigenlayer-middleware/src/unaudited/ECDSAServiceManagerBase.sol";
import "@eigenlayer-middleware/src/unaudited/ECDSAStakeRegistry.sol";
import "@openzeppelin-upgrades/contracts/utils/cryptography/ECDSAUpgradeable.sol";
import "@eigenlayer/contracts/permissions/Pausable.sol";
import {IRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/IRegistryCoordinator.sol";

contract UniCowServiceManager is ECDSAServiceManagerBase, Pausable {
    using BytesLib for bytes;
    using ECDSAUpgradeable for bytes32;

    uint32 public latestTaskNum;
    address public hook;
    mapping(uint32 => bytes32) public allTaskHashes;

    event NewTaskCreated(uint32 indexed taskIndex, Task task);

    struct Task {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        address sender;
        bytes32 poolId;
        uint32 taskCreatedBlock;
    }

    modifier onlyHook() {
        require(msg.sender == hook, "Only hook can call this function");
        _;
    }

    constructor(
        address _avsDirectory,
        address _stakeRegistry,
        address _delegationManager,
        address _hook
    )
        ECDSAServiceManagerBase(
            _avsDirectory,
            _stakeRegistry,
            address(0),
            _delegationManager
        )
    {
        hook = _hook;
    }

    function createNewTask(
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        address sender,
        bytes32 poolId
    ) external {
        Task memory task = Task({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            sender: sender,
            poolId: poolId,
            taskCreatedBlock: uint32(block.number)
        });
        allTaskHashes[latestTaskNum] = keccak256(abi.encode(task));
        emit NewTaskCreated(latestTaskNum, task);
        latestTaskNum++;
    }
}
