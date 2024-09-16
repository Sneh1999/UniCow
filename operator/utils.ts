import * as dotenv from "dotenv";
dotenv.config();

import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, holesky } from "viem/chains";
import { AvsDirectoryABI } from "./abis/AvsDirectory";
import { DelegationManagerABI } from "./abis/DelegationManager";
import { HookABI } from "./abis/Hook";
import { QuoterABI } from "./abis/Quoter";
import { ServiceManagerABI } from "./abis/ServiceManager";
import { StakeRegistryABI } from "./abis/StakeRegistry";
import { deploymentAddresses } from "./deployment_addresses";
import { PoolManagerABI } from "./abis/PoolManager";
import bigDecimal from "js-big-decimal";

export type Task = {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
  sender: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: PoolKey;
  taskCreatedBlock: number;
  taskId: number;

  poolOutputAmount: bigint | null;
  poolInputAmount: bigint | null;
};

export enum Feasibility {
  NONE = "Token0 output > available token 0, token1 output > available token 1",
  IDEAL = "Ideal for everyone involved",
  IDEAL_ZERO_FOR_ONE = "Ideal for zeroForOne, Feasible for oneForZero",
  IDEAL_ONE_FOR_ZERO = "Ideal for oneForZero, Feasible for zeroForOne",
  SWAP_EACH_TASK = "Feasible to swap using the pool",
}

export type PossibleResult = {
  matchings: Matching[];
  poolSpotPrice: number;

  poolAveragePrice: bigDecimal;
  totalPoolToken0Input: bigint;
  totalPoolToken1Input: bigint;
  totalPoolToken0Output: bigint;
  totalPoolToken1Output: bigint;

  matchingAveragePrice: bigDecimal;
  totalToken0Input: bigint;
  totalToken1Input: bigint;
  totalToken0Output: bigint;
  totalToken1Output: bigint;

  feasible: boolean;
};

export type Matching = {
  tasks: Task[];
  feasibility: Feasibility;

  totalToken0Input: bigint;
  totalToken1Input: bigint;
  totalToken0Output: bigint;
  totalToken1Output: bigint;
};

export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export const account = privateKeyToAccount(
  process.env.PRIVATE_KEY! as `0x${string}`
);

export const walletClient = createWalletClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
  account,
  pollingInterval: 2000,
});

export const publicClient = createPublicClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
  pollingInterval: 2000,
});

export const delegationManager = getContract({
  address: deploymentAddresses.eigenlayer.delegation,
  abi: DelegationManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

export const registryContract = getContract({
  address: deploymentAddresses.avs.stakeRegistryProxy,
  abi: StakeRegistryABI,
  client: { public: publicClient, wallet: walletClient },
});

export const avsDirectory = getContract({
  address: deploymentAddresses.eigenlayer.avsDirectory,
  abi: AvsDirectoryABI,
  client: { public: publicClient, wallet: walletClient },
});

export const serviceManager = getContract({
  address: deploymentAddresses.avs.serviceManagerProxy,
  abi: ServiceManagerABI,
  client: { public: publicClient, wallet: walletClient },
});

export const quoterContract = getContract({
  address: deploymentAddresses.hook.quoter,
  abi: QuoterABI,
  client: { public: publicClient, wallet: walletClient },
});

export const hook = getContract({
  address: deploymentAddresses.hook.hook,
  abi: HookABI,
  client: { public: publicClient, wallet: walletClient },
});

export const poolManager = getContract({
  address: deploymentAddresses.hook.poolManager,
  abi: PoolManagerABI,
  client: { public: publicClient, wallet: walletClient },
});
