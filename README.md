# UniCow - Bringing Coincidence of wants to Uniswap V4 using EigenLayer

## Overview

UniCow is a protocol that uses Uniswap V4 hooks and eigenlayer to bring the coincidence of wants to Uniswap V4.

### Key Features

- Unlike Cow Swap, UniCow is decentralized and uses an AVS
- It optimizes for swaps which are ideal for everyone involved i.e swaps which happen at a pool's spot price.
- If an ideal swap is not possible, it gives preference to swaps in zeroForOne direction.
- If a swap is not ideal in zeroForOne direction, it gives preference to swaps in oneForZero direction.
- If none of the above is possible, it does the swaps using the pool.

### How it works

#### User flow

1. When a user wants to enable Cow swap for a given swap, they need to encode the hook data as follows:

```solidity
uint8 cowEnabled = 1;
address sender = msg.sender;
abi.encode(cowEnabled, sender);
```

2. By doing so, our `UniCowHook` contract's beforeSwap function will call `createNewTask` function of `UniCowServiceManager` contract.
3. `UniCowServiceManager` contract will create a task for the user.
4. AVS will listen to the task creation event and will create a new task in the ongoing batch.
5. A new batch is created after every 10 blocks, once 10 blocks have passed, operator's of the AVS find any COW oppportunities and respond to the batch by calling `respondToBatch` function of `UniCowServiceManager` contract. 6.`respondToBatch` function will further call `settleBalances` function of `UniCowHook` contract to transfer/swap any user's balances.

#### Operator flow

Operator needs to run operator/index.ts to register to the AVS and listen for new tasks and respond to batches.

#### COW Algorithm

The algorithm works on the principle of Pareto efficiency. It finds the set of tasks which are Pareto efficient and then transfers/swaps the balances of the tasks.

A pareto set is set of non-dominated combination of tasks. A combination is non-dominated if it is not dominated by any other combination in the set.

A combination where all tasks go through the pool is dominated if:

- There is a combination of tasks which could have led to an `IDEAL_SWAP` (swap at the pool's spot price)
- There is a combination of tasks which could have led to `IDEAL_SWAP_ZERO_FOR_ONE` swap (swap in zeroForOne direction)
- There is a combination of tasks which could have led to `IDEAL_SWAP_ONE_FOR_ZERO` swap (swap in oneForZero direction)

The algorithm works as follows:

1. First it creates all possible combinations of tasks with every other task in the batch.
2. It then returns all `feasible` combinations by checking various contraints.
3. If a combination is feasible, it figures out if it is an `IDEAL_SWAP` or `IDEAL_SWAP_ZERO_FOR_ONE` or `IDEAL_SWAP_ONE_FOR_ZERO` swap or if it requires tasks to be swapped using the pool.
4. Then given all `feasible` combinations, it finds the Pareto set of tasks or in other words, the best combination. It gives preference in the following order:
   1. Combination of tasks which could have led to an `IDEAL_SWAP`
   2. Combination of tasks which could have led to `IDEAL_SWAP_ZERO_FOR_ONE` swap
   3. Combination of tasks which could have led to `IDEAL_SWAP_ONE_FOR_ZERO` swap
5. It then calculates the balances and then settles them onchain using the service manager contract

## How to use

### Prerequisites

- Node.js v18.x
- Foundry

### Installation

1. Clone the repository.
2. `cd operator and run `pn install` to install dependencies.

### Steps

1. Run `make start-anvil` from the root directory of the project to start anvil on one terminal.
2. On another terminal, `cd operator` and run `pn dev` to start the operator. Wait for the operator to register to AVS and EigenLayer.
3. On yet another terminal, run `cd operator` and create some swaps using `pn run taskCreator.ts <number of tasks>` to create tasks. Wait for the tasks to be created.
