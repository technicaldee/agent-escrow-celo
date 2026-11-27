import assert from "node:assert/strict";
import hre from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, toHex, parseUnits, getAddress } from "viem";

const USDT = (n: string) => parseUnits(n, 6);
const brief = keccak256(toHex("update the pricing page and fix the mobile nav"));

// Status enum mirror
const S = { None: 0, Funded: 1, Delivered: 2, Disputed: 3, Releasing: 4, Settling: 5, Settled: 6, Released: 7, Refunded: 8 };

async function deploy() {
  const [owner, agent, treasury, client, freelancer, stranger] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("MockUSDT");
  const escrow = await hre.viem.deployContract("DeliveryEscrow", [
    token.address,
    agent.account.address,
    treasury.account.address,
    100, // 1%
    owner.account.address,
  ]);
  await token.write.mint([client.account.address, USDT("1000")]);
  await token.write.approve([escrow.address, USDT("1000")], { account: client.account });
  return { escrow, token, owner, agent, treasury, client, freelancer, stranger };
}

async function funded(payNaira: boolean) {
  const ctx = await loadFixture(deploy);
  const now = BigInt(await time.latest());
  await ctx.escrow.write.fund(
    [ctx.freelancer.account.address, USDT("100"), Number(now + 7n * 86400n), 3 * 86400, payNaira, brief],
    { account: ctx.client.account },
  );
  return { ...ctx, id: 1n };
}

describe("DeliveryEscrow", () => {
  it("pays USD₮ directly on client approval, minus the 1% fee", async () => {
    const { escrow, token, client, freelancer, treasury, id } = await funded(false);
    assert.equal(await token.read.balanceOf([escrow.address]), USDT("100"));
    await escrow.write.markDelivered([id, "https://staging.example.com"], { account: freelancer.account });
    await escrow.write.approve([id], { account: client.account });
    assert.equal(await token.read.balanceOf([freelancer.account.address]), USDT("99"));
    assert.equal(await token.read.balanceOf([treasury.account.address]), USDT("1"));
    assert.equal((await escrow.read.jobs([id]))[8], S.Released);
  });

  it("naira path: release parks the payout, the agent settles it, the freelancer can bail out to USD₮", async () => {
    const { escrow, token, client, freelancer, agent, id } = await funded(true);
    await escrow.write.markDelivered([id, "ipfs://evidence"], { account: freelancer.account });
    await escrow.write.approve([id], { account: client.account });
    assert.equal((await escrow.read.jobs([id]))[8], S.Releasing);
    assert.equal(await token.read.balanceOf([escrow.address]), USDT("99")); // fee already out

    await escrow.write.beginSettlement([id], { account: agent.account });
    assert.equal(await token.read.balanceOf([agent.account.address]), USDT("99"));
    await escrow.write.confirmSettled([id, keccak256(toHex("swap")), 150_000_000n], { account: agent.account });
    assert.equal((await escrow.read.jobs([id]))[8], S.Settled);
  });

  it("naira path: freelancer can claim USD₮ if the agent never picks the payout up", async () => {
    const { escrow, token, client, freelancer, id } = await funded(true);
    await escrow.write.approve([id], { account: client.account });
    await assert.rejects(escrow.write.claimUsdt([id], { account: freelancer.account }));
    await time.increase(3601);
    await escrow.write.claimUsdt([id], { account: freelancer.account });
    assert.equal(await token.read.balanceOf([freelancer.account.address]), USDT("99"));
  });

  it("auto-releases when the client stays silent past the review window", async () => {
    const { escrow, token, freelancer, stranger, id } = await funded(false);
    await escrow.write.markDelivered([id, "ipfs://evidence"], { account: freelancer.account });
    await assert.rejects(escrow.write.autoRelease([id], { account: stranger.account }));
    await time.increase(3 * 86400 + 1);
    await escrow.write.autoRelease([id], { account: stranger.account });
    assert.equal(await token.read.balanceOf([freelancer.account.address]), USDT("99"));
  });

  it("dispute: the agent rules 70/30 and the money splits", async () => {
    const { escrow, token, client, freelancer, agent, treasury, id } = await funded(false);
    await escrow.write.markDelivered([id, "ipfs://evidence"], { account: freelancer.account });
    await escrow.write.dispute([id, "ipfs://reason"], { account: client.account });
    await escrow.write.resolve([id, 7000, "ipfs://rationale"], { account: agent.account });
    // 70 to freelancer less 1% fee, 30 back to the client
    assert.equal(await token.read.balanceOf([freelancer.account.address]), USDT("69.3"));
    assert.equal(await token.read.balanceOf([treasury.account.address]), USDT("0.7"));
    assert.equal(await token.read.balanceOf([client.account.address]), USDT("900") + USDT("30"));
  });

  it("dispute: if the agent is silent for 7 days either side can force a 50/50 split", async () => {
    const { escrow, token, client, freelancer, stranger, id } = await funded(false);
    await escrow.write.markDelivered([id, "ipfs://evidence"], { account: freelancer.account });
    await escrow.write.dispute([id, "ipfs://reason"], { account: client.account });
    await assert.rejects(escrow.write.splitIfUnruled([id], { account: client.account }));
    await time.increase(7 * 86400 + 1);
    await assert.rejects(escrow.write.splitIfUnruled([id], { account: stranger.account }));
    await escrow.write.splitIfUnruled([id], { account: freelancer.account });
    assert.equal(await token.read.balanceOf([client.account.address]), USDT("950"));
    assert.equal(await token.read.balanceOf([freelancer.account.address]), USDT("49.5"));
  });

  it("client can only dispute inside the review window", async () => {
    const { escrow, client, freelancer, id } = await funded(false);
    await escrow.write.markDelivered([id, "ipfs://evidence"], { account: freelancer.account });
    await time.increase(3 * 86400 + 1);
    await assert.rejects(escrow.write.dispute([id, "late"], { account: client.account }));
  });

  it("refund only after deadline + grace, and only if nothing was delivered", async () => {
    const { escrow, token, client, freelancer, id } = await funded(false);
    await assert.rejects(escrow.write.refund([id], { account: client.account }));
    await time.increase(7 * 86400 + 3 * 86400 + 1);
    await escrow.write.refund([id], { account: client.account });
    assert.equal(await token.read.balanceOf([client.account.address]), USDT("1000"));
    await assert.rejects(escrow.write.markDelivered([id, "x"], { account: freelancer.account }));
  });

  it("enforces roles", async () => {
    const { escrow, client, freelancer, stranger, agent, id } = await funded(true);
    await assert.rejects(escrow.write.approve([id], { account: stranger.account }));
    await assert.rejects(escrow.write.markDelivered([id, "x"], { account: client.account }));
    await assert.rejects(escrow.write.resolve([id, 5000, "x"], { account: agent.account })); // not disputed
    await assert.rejects(escrow.write.beginSettlement([id], { account: agent.account })); // not releasing
    await assert.rejects(escrow.write.setFeeBps([50], { account: stranger.account }));
  });

  it("rejects bad funding params and caps the fee at 3%", async () => {
    const { escrow, owner, client, freelancer } = await loadFixture(deploy);
    const now = BigInt(await time.latest());
    await assert.rejects(escrow.write.fund([client.account.address, USDT("1"), Number(now + 1000n), 3600, false, brief], { account: client.account }));
    await assert.rejects(escrow.write.fund([freelancer.account.address, 0n, Number(now + 1000n), 3600, false, brief], { account: client.account }));
    await assert.rejects(escrow.write.fund([freelancer.account.address, USDT("1"), Number(now - 1n), 3600, false, brief], { account: client.account }));
    await assert.rejects(escrow.write.fund([freelancer.account.address, USDT("1"), Number(now + 1000n), 60, false, brief], { account: client.account }));
    await assert.rejects(escrow.write.setFeeBps([301], { account: owner.account }));
    await escrow.write.setFeeBps([300], { account: owner.account });
    assert.equal(await escrow.read.feeBps(), 300);
    assert.equal(getAddress(await escrow.read.owner()), getAddress(owner.account.address));
  });
});
