import { randomBytes } from "crypto";
import { bytesToHex } from "viem";
import { deploymentAddresses } from "./deployment_addresses";
import {
  delegationManager,
  account,
  publicClient,
  registryContract,
  avsDirectory,
} from "./utils";

export async function registerOperator() {
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
