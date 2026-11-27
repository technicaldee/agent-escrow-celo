import crypto from "node:crypto";
import { erc20Abi, toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { publicClient, agentWallet } from "./chain";
import { CELO, TEXTILE_API, env } from "./config";

type Quote = {
  rfqId: string;
  claimToken: string;
  quote: { takerPays: string; buyAmount: string; feeAmount: string; reactor: Address; expiresAt: string };
  transactions: {
    approval: { to: Address; data: Hex; value: string };
    swap: { to: Address; data: Hex; value: string };
  };
};

const json = { "Content-Type": "application/json" };

/** Free indicative price for selling `usdtAmount` (6 decimals) for cNGN. No wallet needed. */
export async function previewUsdtToCngn(usdtAmount: bigint) {
  const res = await fetch(`${TEXTILE_API}/rfq/preview`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      chainId: CELO.chainId,
      sellToken: CELO.usdt,
      buyToken: CELO.cngn,
      sellAmount: usdtAmount.toString(),
    }),
  });
  const { data } = (await res.json()) as { data: any };
  if (data?.status !== "preview") throw new Error(`Textile preview failed: ${JSON.stringify(data)}`);
  return {
    cngnOut: BigInt(data.buyAmount),
    feeUsdt: BigInt(data.feeAmount),
    availableUsdt: BigInt(data.availableSellAmount ?? 0),
  };
}

async function signTakerControl(account: PrivateKeyAccount) {
  const nonce = toHex(crypto.randomBytes(32));
  const issuedAt = Date.now(); // unix milliseconds
  const signature = await account.signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId: CELO.chainId },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account.address, chainId: BigInt(CELO.chainId), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

async function requestFirmQuote(usdtAmount: bigint, account: PrivateKeyAccount): Promise<Quote> {
  const headers: Record<string, string> = { ...json };
  const body: Record<string, unknown> = {
    chainId: CELO.chainId,
    sellToken: CELO.usdt,
    buyToken: CELO.cngn,
    sellAmount: usdtAmount.toString(),
    taker: account.address,
  };
  if (env.textileApiKey) headers.Authorization = `Bearer ${env.textileApiKey}`;

  const send = () =>
    fetch(`${TEXTILE_API}/rfq/request`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75_000), // worst-case server hold is ~70s
    });

  let res = await send();
  if (res.status === 401 && !env.textileApiKey) {
    body.takerProof = await signTakerControl(account);
    res = await send();
  }
  const payload = (await res.json()) as any;
  if (!res.ok) throw new Error(`Textile quote error ${res.status}: ${JSON.stringify(payload)}`);
  if (payload.data.status !== "quoted") throw new Error(`Textile no quote: ${JSON.stringify(payload.data)}`);
  return payload.data as Quote;
}

export type SwapResult = { cngnOut: bigint; swapTx: Hex; rfqId: string };

/**
 * Swaps `usdtAmount` USD₮ held by the agent wallet for cNGN on Textile FX (mainnet) and returns
 * the amount received. All transactions go through the tagged wallet client.
 */
export async function swapUsdtToCngn(usdtAmount: bigint): Promise<SwapResult> {
  const { account, client } = agentWallet();
  const q = await requestFirmQuote(usdtAmount, account);
  const required = BigInt(q.quote.takerPays);

  const allowance = await publicClient.readContract({
    address: CELO.usdt,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, q.quote.reactor],
  });
  if (allowance < required) {
    if (allowance > 0n) {
      // USDT-style tokens reject approve(nonzero -> nonzero): reset first.
      const reset = await client.writeContract({
        address: CELO.usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [q.quote.reactor, 0n],
      });
      await publicClient.waitForTransactionReceipt({ hash: reset });
    }
    const approve = await client.sendTransaction({
      to: q.transactions.approval.to,
      data: q.transactions.approval.data,
      value: BigInt(q.transactions.approval.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: approve }); // must confirm before the swap
  }

  if (Date.now() >= Date.parse(q.quote.expiresAt)) {
    throw new Error("Quote expired while approving; request a new one");
  }
  const swapTx = await client.sendTransaction({
    to: q.transactions.swap.to,
    data: q.transactions.swap.data,
    value: BigInt(q.transactions.swap.value),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
  if (receipt.status !== "success") throw new Error(`Swap reverted: ${swapTx}`);

  // Report the hash so Textile reconciles the fill.
  await fetch(`${TEXTILE_API}/rfq/${q.rfqId}/submit`, {
    method: "POST",
    headers: {
      ...json,
      ...(env.textileApiKey ? { Authorization: `Bearer ${env.textileApiKey}` } : { "X-Rfq-Claim": q.claimToken }),
    },
    body: JSON.stringify({ txHash: swapTx }),
  }).catch(() => undefined); // reconciliation is best-effort; the swap already settled

  return { cngnOut: BigInt(q.quote.buyAmount), swapTx, rfqId: q.rfqId };
}
