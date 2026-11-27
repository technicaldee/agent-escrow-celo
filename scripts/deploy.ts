// Deploys DeliveryEscrow. Usage: npx hardhat run scripts/deploy.ts --network celo
import hre from "hardhat";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const USDT_CELO = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`).address;
  const owner = getAddress(process.env.OWNER_ADDRESS ?? deployer.account.address);
  const treasury = getAddress(process.env.TREASURY_ADDRESS ?? owner);
  const feeBps = 100; // 1%

  const escrow = await hre.viem.deployContract("DeliveryEscrow", [USDT_CELO, agent, treasury, feeBps, owner]);
  console.log("DeliveryEscrow:", escrow.address);
  console.log({ agent, owner, treasury, feeBps });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
