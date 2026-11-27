// Free price check: how much cNGN does a USD₮ amount buy right now? Usage: npx tsx scripts/quote.ts 25
import { parseUnits, formatUnits } from "viem";
import { previewUsdtToCngn } from "../src/textile";

async function main() {
  const usdt = parseUnits(process.argv[2] ?? "10", 6);
  const q = await previewUsdtToCngn(usdt);
  console.log(`${formatUnits(usdt, 6)} USD₮ -> ${formatUnits(q.cngnOut, 6)} cNGN (fee ${formatUnits(q.feeUsdt, 6)} USD₮, depth ${formatUnits(q.availableUsdt, 6)} USD₮)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
