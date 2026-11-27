import assert from "node:assert/strict";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function deploy() {
  const [a, b] = await hre.viem.getWalletClients();
  const reg = await hre.viem.deployContract("HandleRegistry");
  return { reg, a, b };
}

describe("HandleRegistry", () => {
  it("registers a handle and resolves it to the wallet and name", async () => {
    const { reg, a } = await loadFixture(deploy);
    await reg.write.register(["dee_web", "Edidiong Udoh"], { account: a.account });
    const [owner, name] = await reg.read.resolve(["dee_web"]);
    assert.equal(owner.toLowerCase(), a.account.address.toLowerCase());
    assert.equal(name, "Edidiong Udoh");
  });

  it("rejects taken handles, a second handle per wallet, and bad handles", async () => {
    const { reg, a, b } = await loadFixture(deploy);
    await reg.write.register(["dee_web", "Dee"], { account: a.account });
    await assert.rejects(reg.write.register(["dee_web", "Impostor"], { account: b.account }));
    await assert.rejects(reg.write.register(["other_one", "Dee"], { account: a.account }));
    for (const bad of ["ab", "Dee_Web", "dee web", "dee-web", "x".repeat(25)]) {
      await assert.rejects(reg.write.register([bad, "N"], { account: b.account }), bad);
    }
    await assert.rejects(reg.write.register(["valid_one", ""], { account: b.account }));
  });

  it("lets the owner change the display name but never the handle", async () => {
    const { reg, a, b } = await loadFixture(deploy);
    await assert.rejects(reg.write.setName(["x"], { account: b.account })); // not registered
    await reg.write.register(["dee_web", "Dee"], { account: a.account });
    await reg.write.setName(["Edidiong U."], { account: a.account });
    assert.equal((await reg.read.resolve(["dee_web"]))[1], "Edidiong U.");
  });

  it("returns the zero address for an unknown handle", async () => {
    const { reg } = await loadFixture(deploy);
    assert.equal((await reg.read.resolve(["nobody"]))[0], "0x0000000000000000000000000000000000000000");
  });
});
