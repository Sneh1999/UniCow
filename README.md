# UniCow

<img src="./logo.png" height="50" />

A decentralized actively validated service to enable Coincidence of Wants to Uniswap v4. Secured by EigenLayer.

## Table of Contents

- [Key Features](#key-features)
- [CoW](#cow)
  - [Example 1](#example-1)
  - [Example 2](#example-2)
- [Technical Architecture](#technical-architecture)
  - [v4 Hook](#v4-hook)
  - [Operator](#operator)
  - [Optimization Algorithm ⭐](#optimization-algorithm)
- [Run it yourself](#run-it-yourself)

## Key Features

- Finds CoW matching between any `n` number of swaps to offer the best prices to the users
- General purpose and can support any v4 pool
- Falls back to using the v4 AMM for liquidity if a better price through CoW cannot be found

## CoW

CoW is the economic phenomenon where two or more parties coincidentally want the same thing as the other is offering. When such a scenario occurs in a decentralized exchange context, it allows the parties to swap their assets P2P against each other without needing to go through an AMM - therefore avoiding any fees or slippage.

### Example 1

The simplest case of CoW occurs when two exact and opposite trades are found.

In an ETH/USDC pool for example, if the efficient price for ETH is 3000 USDC:

- Alice wants to sell 1 ETH
- Bob wants to sell 3000 USDC

If they go through the pool, Alice will get ~2995 USDC and Bob will need to pay ~3005 USDC due to fees and slippage.

Instead, Alice and Bob can be matched with each other, trading 1 ETH vs 3000 USDC, enabling both of them to get a better price than the AMM.

### Example 2

Another example of CoW occurs when more than two trades are found that can be CoW matched together.

In an ETH/USDC pool for example, if the efficient price for ETH is 3000 USDC:

- Alice wants to sell 1 ETH
- Bob wants to sell 2000 USDC
- Charlie wants to sell 700 USDC
- Darcy wants to sell 300 USDC

If they go through the pool, Alice will get ~2995 USDC, Bob will get ~0.65 ETH, Charlie will get ~0.21 ETH, and Darcy will get ~0.09 ETH.

Instead, Alice's trade can be matched against Bob, Charlie, and Darcy's trades - enabling all of them to get a better price than the AMM.

## Technical Architecture

There are a few key components to the UniCow system:

- `UniCowServiceManager.sol`: The AVS service manager that acts as the middleman between EigenLayer and the AVS. Operators process batches of tasks and submit a batch response to the service manager.
- `UniCowHook.sol`: The Uniswap v4 hook that enables users to signal their intention to be willing to wait for a potential CoW match. If the user does signal this intention, the hook will NoOp their swap inside `beforeSwap` and take custody of the input tokens, and creates a new task in the service manager.
- Operators: Operators of the AVS are responsible for processing batches of tasks and submitting a batch response to the service manager.

Each CoW-enabled swap is represented by a `Task` struct in `UniCowServiceManager.sol`. The operators are listening for the `NewTaskCreated` event and place the task into a batch. A batch is a collection of all tasks that were created within a `MAX_BLOCKS_PER_BATCH` window - currently set to 10.

Once a batch is full (i.e. `MAX_BLOCKS_PER_BATCH` blocks have passed), the operators run an optimization algorithm to find the optimal CoW matching between all tasks in the batch.

Once the optimal matching is found, the operators trigger the `respondToBatch` function in `UniCowServiceManager.sol` to perform the token transfers as necessary and settle balances, thereby completing the workflow.

### v4 Hook

For the user to signal their intention to be willing to wait for a potential CoW match, they must pass in `hookData` to the call to `swap` which includes a `0` or `1` flag to signal the enabled/disabled status of CoW along with the sender's address.

If CoW is enabled, the hook will NoOp the swap in `beforeSwap` and take custody of the input tokens, and create a new task in the service manager.

### Operator

Operators are monitoring new blocks and new tasks created via the service manager.

Once a batch is full, the operators run an optimization algorithm to find the optimal CoW matching between all tasks in the batch.

### Optimization Algorithm

This is where the magic happens.

CoW matching is an NP problem - i.e. there is no "algorithm" to solve for, and the best solution needs to be found through a combination of heuristics and optimization techniques.

Our implemented algorithm utilizes ideas from combinatorics and finds a [Pareto Efficient](https://en.wikipedia.org/wiki/Pareto_efficiency#Use_in_engineering) set of solutions. From the Pareto set, it optimizes for the solution which offers the highest output amount of tokens for the users.

The algorithm works as follows. Given a number of tasks in a batch - `Task[]`:

1. Create all combinations of tasks where each task is either by itself (swap through AMM), or paired with one or more other tasks (CoW match)

E.g. For an array `[A, B, C]`, the combinations are - `[[A], [B], [C]], [[A, B], [C]], [[A, C], [B]], [[A], [B, C]] [[A, B, C]]`

Tasks that are "alone" are swapped through the AMM. Tasks that are part of a matching are attempted to be matched with each other.

2. From the combinations, we first filter out all `POSSIBLE` combinations.

A combination is defined to be `POSSIBLE` if and only if:

- All matchings within the combination are of length 1 (i.e. all swaps will happen through the AMM)
- OR, all matchings of length >1 have at least two tasks that have the opposite `zeroForOne` value

3. From the `POSSIBLE` combinations, we then find all `FEASIBLE` combinations by checking various constraints:

For each matching of length 1 in the combination, we find the output amount quoted by the AMM for the swap.

For each matching of length >1 in the combination, we exchange tokens between `zeroForOne` and `oneForZero` tasks and calculate the price at which the swaps effectively took place if this was to happen.

A combination is then considered `FEASIBLE` if and only if:

- All matchings are of length 1 (i.e. all swaps will happen through the AMM)
- OR, all matchings of length >1 are being matched at a price where the users are getting a higher number of tokens than they would have from the AMM pool

4. The `FEASIBLE` combinations give us a Pareto Efficient Set. From here, we find the `BEST` combination by maximizing the total output amount of tokens from all the `FEASIBLE` combinations.

5. Finally, the operator triggers an onchain transaction to carry out the result of the `BEST` combination.

---

Example Matching:

A/B pool set up with initial liquidity and current price such that 1A = ~3.999 B

Three tasks are created in a batch:

1. Sell 10 A for B
2. Sell 80 B for A
3. Sell 20 A for B

The operator will find the following to be the best combination:

```
1. Task 1 got swapped through AMM. Receiving 36.5384 B tokens for 10 A tokens.
2. Task 2 got CoW matched. Receiving 20 A tokens for 80 B tokens, which is 1.119 A tokens more than the AMM pool.
3. Task 3 got CoW matched. Receiving 80 B tokens for 20 A tokens, which is 8.6106 B tokens more than the AMM pool.
```

## Run it yourself

### Prerequisites

- Node.js (v18 or higher)
- Foundry
- `pnpm`
- Docker

### Installation

1. Clone the GitHub repository
2. Run `make build-contracts` to install required dependencies and build the contracts
3. Run `cd operator` and `pnpm install` to install dependencies for the operator
4. Run `make deploy-to-anvil` from the root directory to set up a local anvil instance with EigenLayer and Uniswap v4 contracts deployed
5. Run `make start-anvil` from the root directory to start anvil on one terminal
6. Run `cd operator` and `pnpm dev` to start the operator in another terminal
7. Run `cd operator` and `pnpm create-task <number of tasks>` to create tasks.

Inspect the logs in the operator terminal to see the tasks being created and the balances being settled.
