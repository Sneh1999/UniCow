import * as dotenv from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getContract,
  http,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, holesky } from "viem/chains";
import { SwapRouterABI } from "./abis/SwapRouter";
import { waitForTransactionReceipt } from "viem/actions";
dotenv.config();

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);

const walletClient = createWalletClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
  account,
});

const publicClient = createPublicClient({
  chain: process.env.IS_DEV === "true" ? anvil : holesky,
  transport: http(),
});

async function createTask() {
  const swapRouter = getContract({
    address: process.env.SWAP_ROUTER_ADDRESS! as `0x${string}`,
    abi: SwapRouterABI,
    client: {
      public: publicClient,
      wallet: walletClient,
    },
  });

  const txHash = await swapRouter.write.swap([
    {
      currency0: process.env.TOKEN0! as `0x${string}`,
      currency1: process.env.TOKEN1! as `0x${string}`,
      fee: 3000,
      tickSpacing: 120,
      hooks: process.env.HOOK_ADDRESS! as `0x${string}`,
    },
    {
      zeroForOne: true,
      amountSpecified: -BigInt(0.001 * 1e18),
      sqrtPriceLimitX96: BigInt(4295128739 + 1),
    },
    {
      takeClaims: false,
      settleUsingBurn: false,
    },
    encodeAbiParameters(parseAbiParameters("int8,address"), [
      1,
      account.address,
    ]),
  ]);

  await waitForTransactionReceipt(publicClient, {
    hash: txHash,
  });
  console.log("task created", txHash);
}

async function main() {
  // create task every 1 min
  //   setInterval(async () => {
  await createTask();
  //   }, 60 * 1000);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
