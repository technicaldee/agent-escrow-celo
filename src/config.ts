import "dotenv/config";
import { getAddress, type Address, type Hex } from "viem";

/** Celo mainnet (chain id 42220) addresses used by the agent. */
export const CELO = {
  chainId: 42220,
  usdt: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"), // 6 decimals
  cngn: getAddress("0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f"), // 6 decimals
  identityRegistry: getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
  reputationRegistry: getAddress("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"),
} as const;

export const TEXTILE_API = "https://api.textilecredit.com/v2";

/** Attribution tag(s) appended to the calldata of every transaction we send (ERC-8021). */
export const ATTRIBUTION_CODES: string[] = (process.env.ATTRIBUTION_CODES ?? "celo_0546234e302b")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const env = {
  rpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo.org",
  agentKey: () => required("AGENT_PRIVATE_KEY") as Hex,
  escrow: () => getAddress(required("ESCROW_ADDRESS")) as Address,
  textileApiKey: process.env.TEXTILE_API_KEY, // optional: keyless callers sign a proof of control
};
