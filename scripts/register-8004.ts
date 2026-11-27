// Registers the agent on the ERC-8004 Identity Registry (Celo mainnet). The agent key owns the identity.
// Usage: npx tsx scripts/register-8004.ts
import { parseEventLogs } from "viem";
import { agentWallet, publicClient } from "../src/chain";
import { CELO } from "../src/config";

const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string" },
    { name: "owner", type: "address", indexed: true },
  ] },
] as const;

const AGENT_URI = process.env.AGENT_URI ?? "https://raw.githubusercontent.com/technicaldee/agent-escrow-celo/main/agent.json";

async function main() {
  const { account, client } = agentWallet();
  const { request } = await publicClient.simulateContract({ account, address: CELO.identityRegistry, abi, functionName: "register", args: [AGENT_URI] });
  const hash = await client.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [registered] = parseEventLogs({ abi, eventName: "Registered", logs: receipt.logs });
  console.log("Registered agent", registered.args.agentId, "tx", hash);
  console.log(`Now add to agent.json: "registrations": [{ "agentId": ${registered.args.agentId}, "agentRegistry": "eip155:42220:${CELO.identityRegistry}" }]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
