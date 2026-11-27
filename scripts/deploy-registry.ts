// Deploys HandleRegistry. Usage: npx hardhat run scripts/deploy-registry.ts --network celo
import hre from "hardhat";

async function main() {
  const reg = await hre.viem.deployContract("HandleRegistry");
  console.log("HandleRegistry:", reg.address);
}
main().catch((e) => { console.error(e); process.exit(1); });
