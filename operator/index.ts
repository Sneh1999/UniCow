import { parseEventLogs } from "viem";
import { ServiceManagerABI } from "./abis/ServiceManager";
import {
  computeBalances,
  computeBestResult,
  computePossibleResult,
  generateTaskCombinations,
  isCombinationPossible,
} from "./matching";
import { Mathb } from "./math";
import { registerOperator } from "./register";
import {
  PossibleResult,
  Task,
  account,
  hook,
  publicClient,
  quoterContract,
  serviceManager,
} from "./utils";

let latestBatchNumber: bigint = BigInt(0);
const MAX_BLOCKS_PER_BATCH = 10;
const batches: Record<string, Task[]> = {};

const startMonitoring = async () => {
  const unwatchTasks = serviceManager.watchEvent.NewTaskCreated(
    {},
    {
      onLogs: async (logs) => {
        const parsedLogs = parseEventLogs({
          logs: logs,
          abi: ServiceManagerABI,
          eventName: "NewTaskCreated",
        });

        const event = parsedLogs[0];

        const poolKey = await hook.read.poolKeys([event.args.task.poolId]);

        const task = {
          ...event.args.task,
          poolKey: {
            currency0: poolKey[0],
            currency1: poolKey[1],
            fee: poolKey[2],
            tickSpacing: poolKey[3],
            hooks: poolKey[4],
          },
          poolOutputAmount: null,
          poolInputAmount: null,
        };

        if (!batches[latestBatchNumber.toString()]) {
          batches[latestBatchNumber.toString()] = [];
        }
        batches[latestBatchNumber.toString()].push(task);
        console.log("Task added to batch:", task);
      },
    }
  );

  const unwatchBlocks = publicClient.watchBlockNumber({
    onBlockNumber: (blockNumber) => {
      console.log("blockNumber", blockNumber);
      if (latestBatchNumber === BigInt(0)) {
        console.log("first batch created", blockNumber);
        latestBatchNumber = blockNumber;
      } else if (blockNumber - latestBatchNumber >= MAX_BLOCKS_PER_BATCH) {
        // process the balances
        // check if the cow can be done
        processBatch(latestBatchNumber);
        // create a new batch
        latestBatchNumber = blockNumber;
        console.log("new batch created", latestBatchNumber);
      }
    },
  });

  return { unwatchTasks, unwatchBlocks };
};

const processBatch = async (batchNumber: bigint) => {
  const tasks = batches[batchNumber.toString()];
  if (!tasks || tasks.length === 0) {
    console.log("No tasks in batch", batchNumber);
    return;
  }

  const promises = [];
  for (let i = 0; i < tasks.length; i++) {
    promises.push(
      quoterContract.simulate
        .quoteExactInputSingle([
          {
            poolKey: tasks[i].poolKey,
            zeroForOne: tasks[i].zeroForOne,
            exactAmount: -tasks[i].amountSpecified,
            sqrtPriceLimitX96: BigInt(0),
            hookData: "0x",
          },
        ])
        .then((res) => {
          if (tasks[i].zeroForOne) {
            tasks[i].poolInputAmount = Mathb.abs(res.result[0][0]);
            tasks[i].poolOutputAmount = Mathb.abs(res.result[0][1]);
          } else {
            tasks[i].poolInputAmount = Mathb.abs(res.result[0][1]);
            tasks[i].poolOutputAmount = Mathb.abs(res.result[0][0]);
          }
        })
    );
  }
  await Promise.all(promises);

  // Goal: Find the pareto set of CoW matching amongst the tasks
  const allCombinations = generateTaskCombinations(tasks);
  const possibleCombinations = allCombinations.filter(isCombinationPossible);

  const poolId = possibleCombinations[0][0][0].poolId;
  const [sqrtPriceCurrentX96] = await hook.read.getPoolSlot0([poolId]);

  const allResults: PossibleResult[] = [];
  for (const combination of possibleCombinations) {
    const result = computePossibleResult(combination, sqrtPriceCurrentX96);
    allResults.push(result);
  }

  const feasibleResults = allResults.filter((result) => result.feasible);
  const bestResult = computeBestResult(feasibleResults);
  console.log("Best result", bestResult);

  const balances = computeBalances(bestResult);
  console.log("Balances", balances);

  // respond to batch
  let referenceTaskIndices: number[] = [];
  for (const task of tasks) {
    referenceTaskIndices.push(task.taskId);
  }

  if (balances) {
    const messageHash = await serviceManager.read.getMessageHash([
      tasks[0].poolId,
      balances.transferBalances,
      balances.swapBalances,
    ]);
    const signature = await account.sign({
      hash: messageHash,
    });
    console.log("Signature", signature);
    const txHash = await serviceManager.write.respondToBatch([
      tasks,
      referenceTaskIndices,
      balances.transferBalances,
      balances.swapBalances,
      signature,
    ]);

    await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    console.log("Transaction Successful", txHash);
  }
};

async function main() {
  await registerOperator();
  await startMonitoring();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
