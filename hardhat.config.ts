import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    celo: { url: process.env.CELO_RPC_URL ?? "https://forno.celo.org", chainId: 42220, accounts },
    celoSepolia: { url: "https://forno.celo-sepolia.celo-testnet.org", chainId: 11142220, accounts },
  },
};

export default config;
