import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount, signMessage } from "viem/accounts";
import { anvil, holesky } from "viem/chains";
import { DelegationManagerABI } from "./abis/DelegationManager";
import { AvsDirectoryABI } from "./abis/AvsDirectory";
import { StakeRegistryABI } from "./abis/StakeRegistry";
import { ServiceManagerABI } from "./abis/ServiceManager";

dotenv.config();

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const stakeRegistryAddress = process.env
  .STAKE_REGISTRY_ADDRESS! as `0x${string}`;

const walleClient = createWalletClient({
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
  client: { public: publicClient, wallet: walleClient },
});

const registryContract = getContract({
  address: stakeRegistryAddress,
  abi: StakeRegistryABI,
  client: { public: publicClient, wallet: walleClient },
});

const avsDirectory = getContract({
  address: process.env.AVS_DIRECTORY_ADDRESS! as `0x${string}`,
  abi: AvsDirectoryABI,
  client: { public: publicClient, wallet: walleClient },
});

const serviceManager = getContract({
  address: process.env.SERVICE_MANAGER_ADDRESS! as `0x${string}`,
  abi: ServiceManagerABI,
  client: { public: publicClient, wallet: walleClient },
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
        process.env.AVS_ADDRESS! as `0x${string}`,
        salt,
        BigInt(expiry),
      ]);

    const signature = await signMessage({
      message: digestHash,
      privateKey: process.env.PRIVATE_KEY! as `0x${string}`,
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
  const unwatch = publicClient.watchEvent({
    address: serviceManager.address,
    event: parseAbiItem(
      "event NewTaskCreated(uint32 indexed taskIndex, Task task)"
    ),
    onLogs: (logs) => {
      console.log(logs);
    },
  });
  return unwatch;
};

async function main() {
  await registerOperator();
  await monitorNewTasks();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
