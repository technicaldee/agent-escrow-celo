// The agent loop: watches the escrow contract and acts on what it sees.
//   SettlementRequested -> convert the freelancer's payout to cNGN on Textile FX and send it
// Usage: npx tsx src/agent.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { escrowAbi } from "./abi";
import { publicClient } from "./chain";
import { env } from "./config";
import { settleToNaira } from "./settle";

const STATE = ".agent-state.json";
const POLL_MS = 6_000;

const load = (): { fromBlock: string } =>
  existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { fromBlock: "" };

async function main() {
  const escrow = env.escrow();
  const state = load();
  let from = state.fromBlock ? BigInt(state.fromBlock) : await publicClient.getBlockNumber();
  console.log(`agent watching ${escrow} from block ${from}`);

  for (;;) {
    try {
      const head = await publicClient.getBlockNumber();
      if (head >= from) {
        const logs = await publicClient.getContractEvents({ address: escrow, abi: escrowAbi, fromBlock: from, toBlock: head });
        for (const log of logs) {
          if (log.eventName === "SettlementRequested") {
            const { id, freelancer } = log.args as { id: bigint; freelancer: `0x${string}` };
            console.log(`job ${id}: settling to naira for ${freelancer}`);
            const result = await settleToNaira(id, freelancer);
            console.log(`job ${id}:`, result);
          }
        }
        from = head + 1n;
        writeFileSync(STATE, JSON.stringify({ fromBlock: from.toString() }));
      }
    } catch (err) {
      // RPC nodes behind a load balancer can briefly disagree about the head block. Retry, don't die.
      console.error("poll failed, retrying:", String(err).split("\n")[0]);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
