import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { ATTRIBUTION_CODES, env } from "./config";

export const publicClient = createPublicClient({ chain: celo, transport: http(env.rpcUrl) });

/**
 * Wallet client for the agent. The attribution tag is attached where the client is built,
 * so every sendTransaction / writeContract call is tagged and no call site can forget it.
 */
export function agentWallet() {
  const account = privateKeyToAccount(env.agentKey());
  const client = createWalletClient({ account, chain: celo, transport: http(env.rpcUrl) }).extend(
    withAttribution(ATTRIBUTION_CODES),
  );
  return { account, client };
}
