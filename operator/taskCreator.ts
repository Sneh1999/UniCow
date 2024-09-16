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
import { deploymentAddresses } from "./deployment_addresses";
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

async function createTask(numTasks: number) {
  const swapRouter = getContract({
    address: deploymentAddresses.hook.swapRouter,
    abi: SwapRouterABI,
    client: {
      public: publicClient,
      wallet: walletClient,
    },
  });

  const amounts = [10, 20];
  const amountsBigInt = amounts.map((amount) => BigInt(amount * 1e18));

  for (let i = 0; i < numTasks; i++) {
    const randomAmount =
      amountsBigInt[Math.floor(Math.random() * amounts.length)];

    const swapParamsZeroForOne = {
      zeroForOne: true,
      amountSpecified: -randomAmount,
      sqrtPriceLimitX96: BigInt("152398000000000000000000000000"), // 3.7
    };
    const swapParamsOneForZero = {
      zeroForOne: false,
      amountSpecified: -(randomAmount * BigInt(4)),
      sqrtPriceLimitX96: BigInt(
        "162369000000000000000000000000" // 4.2
      ),
    };

    const randomSwapParams =
      Math.random() < 0.5 ? swapParamsZeroForOne : swapParamsOneForZero;

    const txHash = await swapRouter.write.swap([
      {
        currency0: deploymentAddresses.hook.token0,
        currency1: deploymentAddresses.hook.token1,
        fee: 3000,
        tickSpacing: 120,
        hooks: deploymentAddresses.hook.hook,
      },
      randomSwapParams,
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
}

async function main() {
  // read CLI args
  const numTasks = parseInt(process.argv[2]);

  await createTask(numTasks);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
