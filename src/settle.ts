import { erc20Abi, type Address, type Hex } from "viem";
import { escrowAbi } from "./abi";
import { agentWallet, publicClient } from "./chain";
import { CELO, env } from "./config";
import { swapUsdtToCngn } from "./textile";

/**
 * Naira payout for one job: pick the USD₮ up from the escrow, convert on Textile FX, send the
 * cNGN to the freelancer, then record it onchain. If the swap fails the agent returns the USD₮
 * to the freelancer so the money never stays parked with the agent.
 */
export async function settleToNaira(jobId: bigint, freelancer: Address) {
  const { client, account } = agentWallet();
  const escrow = env.escrow();

  const begin = await client.writeContract({ address: escrow, abi: escrowAbi, functionName: "beginSettlement", args: [jobId] });
  await publicClient.waitForTransactionReceipt({ hash: begin });

  const net = (await publicClient.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;

  let swapTx: Hex;
  try {
    const swap = await swapUsdtToCngn(net);
    swapTx = swap.swapTx;
    const send = await client.writeContract({ address: CELO.cngn, abi: erc20Abi, functionName: "transfer", args: [freelancer, swap.cngnOut] });
    await publicClient.waitForTransactionReceipt({ hash: send });
    const confirm = await client.writeContract({ address: escrow, abi: escrowAbi, functionName: "confirmSettled", args: [jobId, swapTx, swap.cngnOut] });
    await publicClient.waitForTransactionReceipt({ hash: confirm });
    return { kind: "naira" as const, swapTx, cngnOut: swap.cngnOut };
  } catch (err) {
    // Fallback: never leave the freelancer's money with the agent.
    const refund = await client.writeContract({ address: CELO.usdt, abi: erc20Abi, functionName: "transfer", args: [freelancer, net] });
    await publicClient.waitForTransactionReceipt({ hash: refund });
    const confirm = await client.writeContract({ address: escrow, abi: escrowAbi, functionName: "confirmSettled", args: [jobId, refund, 0n] });
    await publicClient.waitForTransactionReceipt({ hash: confirm });
    return { kind: "usdt-fallback" as const, error: String(err), tx: refund };
  }
}
