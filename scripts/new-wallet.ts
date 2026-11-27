// Generates the agent's wallet and writes the key to .env (gitignored). Prints only the address.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

if (existsSync(".env") && readFileSync(".env", "utf8").includes("AGENT_PRIVATE_KEY=")) {
  console.log("AGENT_PRIVATE_KEY already exists in .env - not overwriting.");
  process.exit(0);
}
const key = generatePrivateKey();
appendFileSync(".env", `AGENT_PRIVATE_KEY=${key}\n`);
console.log("Agent wallet address:", privateKeyToAccount(key).address);
