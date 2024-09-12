import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbiItem,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount, signMessage } from "viem/accounts";
import { anvil, holesky } from "viem/chains";
import { DelegationManagerABI } from "./abis/DelegationManager";
import { AvsDirectoryABI } from "./abis/AvsDirectory";
import { StakeRegistryABI } from "./abis/StakeRegistry";
import { ServiceManagerABI } from "./abis/ServiceManager";

dotenv.config();

let latestBatchNumber: bigint = BigInt(0);
const MAX_BLOCKS_PER_BATCH = 10;

type Task = {
  zeroForOne: boolean;
  amountSpecified: number;
  sqrtPriceLimitX96: bigint;
  sender: string;
  poolId: string;
  taskCreatedBlock: number;
};

type Batches = {
  [batch: string]: Task[];
};

const batches: Batches = {};
const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const stakeRegistryAddress = process.env
  .STAKE_REGISTRY_ADDRESS! as `0x${string}`;

const walletClient = createWalletClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
  account,
});

const publicClient = createPublicClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
});

const delegationManager = getContract({
  address: process.env.DELEGATION_MANAGER_ADDRESS! as `0x${string}`,
  abi: DelegationManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

const registryContract = getContract({
  address: stakeRegistryAddress,
  abi: StakeRegistryABI,
  client: { public: publicClient, wallet: walletClient },
});

const avsDirectory = getContract({
  address: process.env.AVS_DIRECTORY_ADDRESS! as `0x${string}`,
  abi: AvsDirectoryABI,
  client: { public: publicClient, wallet: walletClient },
});

const serviceManager = getContract({
  address: process.env.SERVICE_MANAGER_ADDRESS! as `0x${string}`,
  abi: ServiceManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

async function registerOperator() {
  const isOperator = await delegationManager.read.isOperator([account.address]);
  if (!isOperator) {
    // register as operator
    const txHash = await delegationManager.write.registerAsOperator([
      {
        __deprecated_earningsReceiver: account.address,
        delegationApprover: "0x0000000000000000000000000000000000000000",
        stakerOptOutWindowBlocks: 0,
      },
      "",
    ]);

    await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log("operator registered to eigenlayer", txHash);
  }

  const isOperatorRegistered = await registryContract.read.operatorRegistered([
    account.address,
  ]);

  if (!isOperatorRegistered) {
    const salt = bytesToHex(randomBytes(32));
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60;

    const digestHash =
      await avsDirectory.read.calculateOperatorAVSRegistrationDigestHash([
        account.address,
        process.env.SERVICE_MANAGER_ADDRESS! as `0x${string}`,
        salt,
        BigInt(expiry),
      ]);

    const signature = await account.sign({
      hash: digestHash,
    });

    const tx2 = await registryContract.write.registerOperatorWithSignature([
      {
        expiry: BigInt(expiry),
        salt: salt,
        signature: signature,
      },
      account.address,
    ]);

    await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });
    console.log("operator registered to AVS successfully", tx2);
  }
}

const monitorNewTasks = async () => {
  const unwatch = serviceManager.watchEvent.NewTaskCreated(
    {},
    {
      onLogs: (logs) => {
        // console.log(logs);
        const parsedLogs = parseEventLogs({
          logs: logs,
          abi: ServiceManagerABI,
        });
        // @ts-ignore
        const task = parsedLogs[0].args.task;
        batches[latestBatchNumber.toString()] = [
          ...batches[latestBatchNumber.toString()],
          task,
        ];
        console.log("Task added to batch:", {
          task,
          latestBatchNumber,
        });
      },
    }
  );

  return unwatch;
};

const processBatch = (batchNumber: bigint) => {
  const tasks = batches[batchNumber.toString()];
  if (tasks.length === 0) {
    console.log("No tasks in batch", batchNumber);
    return;
  }

  if (tasks.length > 1) {
    // do an onchain swap
    return;
  }

  /*
    ETH -> USDC, 1 ETH = 3000 USDC

    selling ETH for USDC
    Task memory task1 = Task({
        zeroForOne: true,
        amountSpecified: -1,
        sqrtPriceLimitX96: 2995,
        sender: sender,
        poolId: poolId,
        taskCreatedBlock: uint32(block.number)
    });

    
    -> pool will give 2997 USDC
    -> minimum acceptable is 2995 USDC

    Task memory task2 = Task({
        zeroForOne: false,
        amountSpecified: -3000,
        sqrtPriceLimitX96: 3005,
        sender: sender,
        poolId: poolId,
        taskCreatedBlock: uint32(block.number)
    });

    -> pool 0.9985 ETH
    -> minimum acceptable is 0.998336 ETH

    -----

    can you give better than 2997 USDC to Task1, and better than 0.9985 ETH to Task2

    they both win, if:

    amount1Output > 2997 USDC
    amount2Output > 0.9985 ETH

    fulfill both orders against each other

    amount1Output = 3000 USDC
    amount2Output = 1 ETH

    3004.5/1 > 3000/1 > 2997/1
  */

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (tasks[i].zeroForOne === tasks[j].zeroForOne) {
        continue;
      }
      const task1Limit =
        (tasks[i].sqrtPriceLimitX96 / BigInt(2 ^ 96)) ^ BigInt(2);
      const task2Limit =
        (tasks[j].sqrtPriceLimitX96 / BigInt(2 ^ 96)) ^ BigInt(2);
    }
  }
};
// create a listener to get latest block number

const monitorNewBlocks = async () => {
  const unwatch = publicClient.watchBlockNumber({
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

  return unwatch;
};

async function main() {
  await registerOperator();
  await monitorNewBlocks();
  await monitorNewTasks();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
