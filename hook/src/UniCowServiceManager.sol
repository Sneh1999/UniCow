// // SPDX-License-Identifier: UNLICENSED
// pragma solidity ^0.8.9;

// import "@eigenlayer/contracts/libraries/BytesLib.sol";
// import "@eigenlayer/contracts/core/DelegationManager.sol";
// import {ECDSAServiceManagerBase} from "@eigenlayer-middleware/src/unaudited/ECDSAServiceManagerBase.sol";
// import "@eigenlayer-middleware/src/unaudited/ECDSAStakeRegistry.sol";
// import "@openzeppelin-upgrades/contracts/utils/cryptography/ECDSAUpgradeable.sol";
// import "@eigenlayer/contracts/permissions/Pausable.sol";
// import {IRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/IRegistryCoordinator.sol";
// import {PoolKey} from "v4-core/types/PoolKey.sol";
// import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

// contract UniCowServiceManager is ECDSAServiceManagerBase, Pausable {
//     using BytesLib for bytes;
//     using ECDSAUpgradeable for bytes32;

//     uint32 public latestTaskNum;
//     mapping(uint32 => bytes32) public allTaskHashes;

//     event NewTaskCreated(uint32 indexed taskIndex, Task task);

//     struct Task {
//         PoolKey key;
//         IPoolManager.SwapParams swapParams;
//         address sender;
//         uint32 taskCreatedBlock;
//     }

//     constructor(
//         address _avsDirectory,
//         address _stakeRegistry,
//         address _delegationManager
//     )
//         ECDSAServiceManagerBase(
//             _avsDirectory,
//             _stakeRegistry,
//             address(0),
//             _delegationManager
//         )
//     {}

//     function createNewTask(Task memory task) external {
//         task.taskCreatedBlock = uint32(block.number);
//         allTaskHashes[latestTaskNum] = keccak256(abi.encode(task));
//         emit NewTaskCreated(latestTaskNum, task);
//         latestTaskNum++;
//     }
// }
