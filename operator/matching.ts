import { formatEther } from "viem";
import { Mathb } from "./math";
import { Feasibility, Matching, PossibleResult, Task } from "./utils";
import bigDecimal from "js-big-decimal";

const RoundingModes = bigDecimal.RoundingModes;
interface TransferBalance {
  amount: bigint;
  currency: `0x${string}`;
  sender: `0x${string}`;
}

interface SwapBalance {
  amountSpecified: bigint;
  zeroForOne: boolean;
  sqrtPriceLimitX96: bigint;
}

export function generateTaskCombinations(tasks: Task[]): Task[][][] {
  if (tasks.length === 0) return [];
  if (tasks.length === 1) return [[[tasks[0]]]];

  const result: Task[][][] = [];
  const firstTask = tasks[0];
  const restTasks = tasks.slice(1);
  const subCombinations = generateTaskCombinations(restTasks);

  // Add the combination where the first task is separate from the rest
  result.push([[firstTask], restTasks]);

  // Add combinations where the first task is separate
  for (const subComb of subCombinations) {
    result.push([[firstTask], ...subComb]);
  }

  // Add combinations where the first task is combined with others
  for (const subComb of subCombinations) {
    // Combine with the first group
    result.push([
      [firstTask, ...(Array.isArray(subComb[0]) ? subComb[0] : [subComb[0]])],
      ...subComb.slice(1),
    ]);

    // Combine with each subsequent group
    for (let i = 1; i < subComb.length; i++) {
      // @ts-ignore
      result.push([
        ...subComb.slice(0, i),
        [firstTask, ...(Array.isArray(subComb[i]) ? subComb[i] : [subComb[i]])],
        ...subComb.slice(i + 1),
      ]);
    }
  }

  // Remove duplicates
  return removeDuplicates(result);
}

export function isCombinationPossible(combination: Task[][]): boolean {
  for (const matching of combination) {
    if (matching.length == 1) continue;

    // If there are more than 1 tasks in the matching,
    // there should be at least 2 tasks that have the opposite zeroForOne value
    let zeroForOneCount = 0;
    let oneForZeroCount = 0;
    for (const task of matching) {
      task.zeroForOne ? zeroForOneCount++ : oneForZeroCount++;
    }
    if (zeroForOneCount === 0 || oneForZeroCount === 0) {
      return false;
    }
  }

  return true;
}

export function computePossibleResult(
  combination: Task[][],
  sqrtPriceCurrentX96: bigint
): PossibleResult {
  const result: Partial<PossibleResult> = {};

  const matchings: Matching[] = [];

  // set poolSpotPrice
  const priceCurrentNumber = getPriceFromSqrtX96(sqrtPriceCurrentX96);
  result.poolSpotPrice = priceCurrentNumber;

  // compute total pool inputs and outputs
  let totalPoolToken0Input = BigInt(0);
  let totalPoolToken1Input = BigInt(0);
  let totalPoolToken0Output = BigInt(0);
  let totalPoolToken1Output = BigInt(0);

  for (const matching of combination) {
    for (const task of matching) {
      if (task.zeroForOne) {
        totalPoolToken0Input += task.poolInputAmount ?? BigInt(0);
        totalPoolToken1Output += task.poolOutputAmount ?? BigInt(0);
      } else {
        totalPoolToken1Input += task.poolInputAmount ?? BigInt(0);
        totalPoolToken0Output += task.poolOutputAmount ?? BigInt(0);
      }
    }
  }

  result.totalPoolToken0Input = totalPoolToken0Input;
  result.totalPoolToken1Input = totalPoolToken1Input;
  result.totalPoolToken0Output = totalPoolToken0Output;
  result.totalPoolToken1Output = totalPoolToken1Output;
  result.poolAveragePrice = getAverageSwapPrice({
    token0Input: totalPoolToken0Input,
    token1Input: totalPoolToken1Input,
    token0Output: totalPoolToken0Output,
    token1Output: totalPoolToken1Output,
  });

  // compute matching trades
  let totalToken0Input = BigInt(0);
  let totalToken1Input = BigInt(0);
  let totalToken0Output = BigInt(0);
  let totalToken1Output = BigInt(0);
  for (const matching of combination) {
    if (matching.length == 1) {
      const task = matching[0];
      if (task.zeroForOne) {
        totalToken0Input += task.poolInputAmount ?? BigInt(0);
        totalToken1Output += task.poolOutputAmount ?? BigInt(0);
        matchings.push({
          tasks: [task],
          totalToken0Input: task.poolInputAmount!,
          totalToken1Input: BigInt(0),
          totalToken0Output: BigInt(0),
          totalToken1Output: task.poolOutputAmount!,
          feasibility: Feasibility.SWAP_EACH_TASK,
        });
      } else {
        totalToken1Input += task.poolInputAmount ?? BigInt(0);
        totalToken0Output += task.poolOutputAmount ?? BigInt(0);

        matchings.push({
          tasks: [task],
          totalToken0Input: BigInt(0),
          totalToken1Input: task.poolInputAmount!,
          totalToken0Output: task.poolOutputAmount!,
          totalToken1Output: BigInt(0),
          feasibility: Feasibility.SWAP_EACH_TASK,
        });
      }

      continue;
    }

    let currMatching: Matching = {
      tasks: matching,
      totalToken0Input: BigInt(0),
      totalToken1Input: BigInt(0),
      totalToken0Output: BigInt(0),
      totalToken1Output: BigInt(0),
      feasibility: Feasibility.NONE,
    };

    // If there are more than 1 tasks in the matching
    const zeroForOneTasks = matching.filter((task) => task.zeroForOne);
    const oneForZeroTasks = matching.filter((task) => !task.zeroForOne);

    if (zeroForOneTasks.length === 0 || oneForZeroTasks.length === 0) {
      currMatching.feasibility = Feasibility.NONE;
      continue;
    }

    let availableToken0 = BigInt(0);
    let availableToken1 = BigInt(0);

    let minimumSqrtPriceLimitX96 = BigInt(sqrtPriceCurrentX96);
    let maximumSqrtPriceLimitX96 = BigInt(0);

    for (const task of zeroForOneTasks) {
      availableToken0 += Mathb.abs(task.amountSpecified);
      minimumSqrtPriceLimitX96 = Mathb.min(
        minimumSqrtPriceLimitX96,
        task.sqrtPriceLimitX96
      );
    }

    for (const task of oneForZeroTasks) {
      availableToken1 += Mathb.abs(task.amountSpecified);
      maximumSqrtPriceLimitX96 = Mathb.max(
        maximumSqrtPriceLimitX96,
        task.sqrtPriceLimitX96
      );
    }

    currMatching.totalToken0Input = availableToken0;
    currMatching.totalToken1Input = availableToken1;

    const minimumPrice = getPriceFromSqrtX96(minimumSqrtPriceLimitX96);
    const maximumPrice = getPriceFromSqrtX96(maximumSqrtPriceLimitX96);

    // check if availableToken0Input can be matched against availableToken1Input
    // at an execution price of roughly poolSpotPrice

    const idealToken1OutputForToken0 = getIdealOutputForSpotPrice(
      availableToken0,
      result.poolSpotPrice,
      true
    );

    const minimumToken1OutputForToken0 = getIdealOutputForSpotPrice(
      availableToken0,
      minimumPrice,
      true
    );

    const idealToken0OutputForToken1 = getIdealOutputForSpotPrice(
      availableToken1,
      result.poolSpotPrice,
      false
    );

    const minimumToken0OutputForToken1 = getIdealOutputForSpotPrice(
      availableToken1,
      maximumPrice,
      false
    );

    totalToken0Input += availableToken0;
    totalToken1Input += availableToken1;

    if (
      idealToken1OutputForToken0 <= availableToken1 &&
      idealToken0OutputForToken1 <= availableToken0
    ) {
      totalToken0Output += idealToken0OutputForToken1;
      totalToken1Output += idealToken1OutputForToken0;
      currMatching.totalToken0Output = idealToken0OutputForToken1;
      currMatching.totalToken1Output = idealToken1OutputForToken0;
      currMatching.feasibility = Feasibility.IDEAL;
    } else if (
      idealToken1OutputForToken0 <= availableToken1 &&
      minimumToken0OutputForToken1 <= availableToken0
    ) {
      totalToken0Output += availableToken0;
      totalToken1Output += idealToken1OutputForToken0;
      currMatching.totalToken0Output = availableToken0;
      currMatching.totalToken1Output = idealToken1OutputForToken0;
      currMatching.feasibility = Feasibility.IDEAL_ZERO_FOR_ONE;
    } else if (
      idealToken0OutputForToken1 <= availableToken0 &&
      minimumToken1OutputForToken0 <= availableToken1
    ) {
      totalToken0Output += idealToken0OutputForToken1;
      totalToken1Output += availableToken1;
      currMatching.totalToken0Output = idealToken0OutputForToken1;
      currMatching.totalToken1Output = availableToken1;
      currMatching.feasibility = Feasibility.IDEAL_ONE_FOR_ZERO;
    } else {
      currMatching.feasibility = Feasibility.NONE;
    }

    matchings.push(currMatching);
  }

  const isResultFeasible =
    matchings.some((matching) => matching.feasibility === Feasibility.NONE) ===
    false;

  if (isResultFeasible) {
    result.matchingAveragePrice = getAverageSwapPrice({
      token0Input: totalToken0Input,
      token1Input: totalToken1Input,
      token0Output: totalToken0Output,
      token1Output: totalToken1Output,
    });
  } else {
    result.matchingAveragePrice = new bigDecimal(0);
  }

  result.matchings = matchings;
  result.totalToken0Input = totalToken0Input;
  result.totalToken1Input = totalToken1Input;
  result.totalToken0Output = totalToken0Output;
  result.totalToken1Output = totalToken1Output;
  result.feasible = isResultFeasible;

  return result as PossibleResult;
}

function getPriceFromSqrtX96(sqrtPriceX96: bigint) {
  const Q96 = new bigDecimal("79228162514264337593543950336");
  const sqrtPriceX96Decimal = new bigDecimal(sqrtPriceX96);
  const sqrtPriceCurrent = sqrtPriceX96Decimal.divide(
    Q96,
    18,
    RoundingModes.FLOOR
  );
  const priceCurrent = sqrtPriceCurrent.multiply(sqrtPriceCurrent);
  return Number(priceCurrent.getValue());
}

function getIdealOutputForSpotPrice(
  inputAmount: bigint,
  priceCurrent: number,
  zeroForOne: boolean
) {
  const priceCurrentDecimal = new bigDecimal(priceCurrent);
  let inputAmountDecimal = new bigDecimal(inputAmount);
  let outputAmountDecimal: bigDecimal;

  // Price is always represented as token0 in terms of token1
  // e.g. if 1 Token0 = 100 Token1
  // then price = 100 / 1 = 100
  // if 1 Token1 = 100 Token0
  // then price = 1 / 100 = 0.01
  if (zeroForOne) {
    // outputAmount = inputAmount * P
    outputAmountDecimal = inputAmountDecimal.multiply(priceCurrentDecimal);
  } else {
    // outputAmount = inputAmount / P
    outputAmountDecimal = inputAmountDecimal.divide(
      priceCurrentDecimal,
      18,
      RoundingModes.FLOOR
    );
  }

  return BigInt(outputAmountDecimal.floor().getValue());
}

export function computeBestResult(possibleResults: PossibleResult[]) {
  let bestResultBasedOnTotalOutput: PossibleResult | null = null;

  for (const possibleResult of possibleResults) {
    if (bestResultBasedOnTotalOutput === null) {
      bestResultBasedOnTotalOutput = possibleResult;
      continue;
    }

    const totalToken0Output = possibleResult.totalToken0Output;
    const totalToken1Output = possibleResult.totalToken1Output;

    if (
      totalToken0Output > bestResultBasedOnTotalOutput.totalToken0Output &&
      totalToken1Output > bestResultBasedOnTotalOutput.totalToken1Output
    ) {
      bestResultBasedOnTotalOutput = possibleResult;
    }
  }

  return bestResultBasedOnTotalOutput as PossibleResult;
}

export function computeBalances(possibleResult: PossibleResult) {
  const transferBalances: TransferBalance[] = [];
  const swapBalances: SwapBalance[] = [];

  // taskId to analysis
  const analysis: Record<string, string> = {};

  for (const matching of possibleResult.matchings) {
    if (matching.feasibility === Feasibility.SWAP_EACH_TASK) {
      for (const task of matching.tasks) {
        swapBalances.push({
          amountSpecified: task.amountSpecified,
          zeroForOne: task.zeroForOne,
          sqrtPriceLimitX96: task.sqrtPriceLimitX96,
        });

        analysis[task.taskId] = `Task ${
          task.taskId
        } got swapped through AMM. Receiving ${formatEther(
          task.poolOutputAmount!
        )} tokens for ${formatEther(task.poolInputAmount!)} tokens`;
      }

      continue;
    }

    for (const task of matching.tasks) {
      if (task.zeroForOne) {
        const inputShare = new bigDecimal(task.poolInputAmount!).divide(
          new bigDecimal(matching.totalToken0Input),
          18,
          RoundingModes.FLOOR
        );
        const outputAmount = inputShare.multiply(
          new bigDecimal(matching.totalToken1Output)
        );
        const outputAmountBigInt = BigInt(outputAmount.floor().getValue());

        transferBalances.push({
          amount: outputAmountBigInt,
          currency: task.poolKey.currency1,
          sender: task.sender as `0x${string}`,
        });

        const extraOutputAmount = outputAmountBigInt - task.poolOutputAmount!;

        analysis[task.taskId] = `Task ${
          task.taskId
        } got CoW matched. Receiving ${formatEther(
          outputAmountBigInt
        )} tokens for ${formatEther(
          task.poolInputAmount!
        )} tokens, which is ${formatEther(
          extraOutputAmount
        )} tokens more than the AMM's output`;
      } else {
        const inputShare = new bigDecimal(task.poolInputAmount!).divide(
          new bigDecimal(matching.totalToken1Input),
          18,
          RoundingModes.FLOOR
        );
        const outputAmount = inputShare.multiply(
          new bigDecimal(matching.totalToken0Output)
        );
        const outputAmountBigInt = BigInt(outputAmount.floor().getValue());

        transferBalances.push({
          amount: BigInt(outputAmount.floor().getValue()),
          currency: task.poolKey.currency0,
          sender: task.sender as `0x${string}`,
        });

        const extraOutputAmount = outputAmountBigInt - task.poolOutputAmount!;

        analysis[task.taskId] = `Task ${
          task.taskId
        } got CoW matched. Receiving ${formatEther(
          outputAmountBigInt
        )} tokens for ${formatEther(
          task.poolInputAmount!
        )} tokens, which is ${formatEther(
          extraOutputAmount
        )} tokens more than the AMM's output`;
      }
    }
  }

  return { swapBalances, transferBalances, analysis };
}

function removeDuplicates(combinations: Task[][][]): Task[][][] {
  const uniqueCombinations = new Set<string>();

  return combinations.filter((combination) => {
    const key = JSON.stringify(
      combination.map((group) => group.map((t) => t.taskId).sort())
    );
    if (!uniqueCombinations.has(key)) {
      uniqueCombinations.add(key);
      return true;
    }
    return false;
  });
}

function getAverageSwapPrice(params: {
  token0Input: bigint;
  token1Input: bigint;
  token0Output: bigint;
  token1Output: bigint;
}) {
  const zero = BigInt(0);
  const { token0Input, token1Input, token0Output, token1Output } = params;
  if (
    token0Input === zero ||
    token1Input === zero ||
    token0Output === zero ||
    token1Output === zero
  ) {
    return new bigDecimal(0);
  }

  const token0InputDecimal = new bigDecimal(params.token0Input);
  const token1InputDecimal = new bigDecimal(params.token1Input);
  const token0OutputDecimal = new bigDecimal(params.token0Output);
  const token1OutputDecimal = new bigDecimal(params.token1Output);

  const oneHalf = token1OutputDecimal.divide(
    token0InputDecimal,
    18,
    RoundingModes.FLOOR
  );
  const secondHalf = token1InputDecimal.divide(
    token0OutputDecimal,
    18,
    RoundingModes.FLOOR
  );

  const numerator = oneHalf.add(secondHalf);
  const denominator = new bigDecimal(2);

  return numerator.divide(denominator, 18, RoundingModes.FLOOR);
}
