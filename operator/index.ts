import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import {
  BaseError,
  bytesToHex,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  getContract,
  http,
  parseAbiItem,
  parseAbiParameters,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount, signMessage } from "viem/accounts";
import { anvil, holesky } from "viem/chains";
import { DelegationManagerABI } from "./abis/DelegationManager";
import { AvsDirectoryABI } from "./abis/AvsDirectory";
import { StakeRegistryABI } from "./abis/StakeRegistry";
import { ServiceManagerABI } from "./abis/ServiceManager";
import { QuoterABI } from "./abis/Quoter";
import { HookABI } from "./abis/Hook";
import { deploymentAddresses } from "./deployment_addresses";
import { AbiCoder } from "ethers/lib/utils";
import { Mathb } from "./math";

dotenv.config();

let latestBatchNumber: bigint = BigInt(0);
const MAX_BLOCKS_PER_BATCH = 1;

type Task = {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
  sender: string;
  poolId: string;
  taskCreatedBlock: number;
  poolOutputAmount: bigint;
  poolInputAmount: bigint;
};

const batches: Record<string, Task[]> = {};

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const stakeRegistryAddress = deploymentAddresses.avs.stakeRegistryProxy;

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
  address: deploymentAddresses.eigenlayer.delegation,
  abi: DelegationManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

const registryContract = getContract({
  address: deploymentAddresses.avs.stakeRegistryProxy,
  abi: StakeRegistryABI,
  client: { public: publicClient, wallet: walletClient },
});

const avsDirectory = getContract({
  address: deploymentAddresses.eigenlayer.avsDirectory,
  abi: AvsDirectoryABI,
  client: { public: publicClient, wallet: walletClient },
});

const serviceManager = getContract({
  address: deploymentAddresses.avs.serviceManagerProxy,
  abi: ServiceManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

const quoterContract = getContract({
  address: deploymentAddresses.hook.quoter,
  abi: QuoterABI,
  client: { public: publicClient, wallet: walletClient },
});

const hook = getContract({
  address: deploymentAddresses.hook.hook,
  abi: HookABI,
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
        deploymentAddresses.avs.serviceManagerProxy,
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
        const parsedLogs = parseEventLogs({
          logs: logs,
          abi: ServiceManagerABI,
        });
        // @ts-ignore
        const task = parsedLogs[0].args.task;

        if (!batches[latestBatchNumber.toString()]) {
          batches[latestBatchNumber.toString()] = [];
        }
        batches[latestBatchNumber.toString()].push(task);
        console.log("Task added to batch:", task);
      },
    }
  );

  return unwatch;
};

const processBatch = async (batchNumber: bigint) => {
  const tasks = batches[batchNumber.toString()];
  if (!tasks || tasks.length === 0) {
    console.log("No tasks in batch", batchNumber);
    return;
  }

  for (let i = 0; i < tasks.length; i++) {
    const poolKey = await hook.read.poolKeys([
      tasks[i].poolId as `0x${string}`,
    ]);

    const res = await quoterContract.simulate.quoteExactInputSingle([
      {
        poolKey: {
          currency0: poolKey[0],
          currency1: poolKey[1],
          fee: poolKey[2],
          tickSpacing: poolKey[3],
          hooks: poolKey[4],
        },
        zeroForOne: tasks[i].zeroForOne,
        exactAmount: -tasks[i].amountSpecified,
        sqrtPriceLimitX96: BigInt(0),
        hookData: "0x",
      },
    ]);
    //  take absolute for bigint

    if (tasks[i].zeroForOne) {
      tasks[i].poolInputAmount = Mathb.abs(res.result[0][0]);
      tasks[i].poolOutputAmount = Mathb.abs(res.result[0][1]);
    } else {
      tasks[i].poolInputAmount = Mathb.abs(res.result[0][1]);
      tasks[i].poolOutputAmount = Mathb.abs(res.result[0][0]);
    }
    console.log("Output Amounts added to task", tasks[i]);
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

  await Promise.all([monitorNewBlocks(), monitorNewTasks()]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
