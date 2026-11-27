# Delivery Escrow Agent

**Pay a freelancer abroad without a marketplace.** A client pays USD₮ into an onchain escrow. When the work is approved, an agent converts the payout to **naira (cNGN) on Textile FX** and sends it to the freelancer. 1% fee instead of the 10–20% marketplaces take. Live on **Celo mainnet**.

**Live demo:** https://technicaldee.github.io/agent-escrow-celo/ (works in MiniPay and MetaMask)

| | |
|---|---|
| Escrow contract | [`0xaeeb6938ad76a8a674d6000487e01655cc9fc5a6`](https://celoscan.io/address/0xaeeb6938ad76a8a674d6000487e01655cc9fc5a6) |
| Agent (ERC-8004) | ID `10162` on the Celo Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Agent wallet | `0x73b6b21FF635aB583aaEAEb4C58b90B01af3C71e` |
| Attribution tag | `celo_0546234e302b` (ERC-8021, on every transaction the agent sends) |

## The problem

Nigerian freelancers are paid by clients abroad through marketplaces that charge 10–20%, or by direct transfer where one side has to trust the other. OPay launched Shield Pay (escrow) this month, but it only works between OPay users and OPay is both custodian and judge. This agent works across borders and wallets, and every payout and ruling is a public onchain record.

## How it works

1. **Client funds** a job in USD₮ (`fund`). The brief is hashed onchain so the scope can't change later.
2. **Freelancer delivers** and posts evidence (`markDelivered`). A review window starts.
3. **Client approves** (`approve`), or stays silent and anyone can `autoRelease` after the window, or the client `dispute`s inside it.
4. **Payout.** In naira mode the contract parks the payout, the agent picks it up (`beginSettlement`), swaps USD₮→cNGN on Textile FX, sends the cNGN to the freelancer and records it (`confirmSettled`). If the swap fails, the agent sends USD₮ to the freelancer instead.
5. **Disputes** are ruled on by the agent (`resolve`).

### Trust model (what the agent can and can't do)

- The agent **cannot take funds for itself.** It can only pay the freelancer or refund the client.
- Every stuck state has a timeout that returns control to the humans: a silent client is auto-released; an agent that never rules lets either side force a 50/50 split after 7 days; if the agent doesn't pick up a naira payout within 1 hour the freelancer can claim USD₮; an undelivered job is refundable to the client after the deadline plus 3 days.
- Fee is capped at 3% in the contract.

## Tracks

- **Stablecoin Corridors (Textile FX):** every naira payout is a tagged USD₮→cNGN conversion on Textile FX, with the cNGN paid to the freelancer's wallet.
- **ERC-8004:** the agent is registered (ID 10162) and `agent.json` links the registration and the escrow.
- Self Agent ID: not integrated yet.

## Mainnet transactions

- ERC-8004 registration: [`0xd8e0661e…c22179`](https://celoscan.io/tx/0xd8e0661ec5c1d8a0f08ce7cd5b98d4bacfd2fd06c9ec2145c9f4c76fbfc22179)
- Textile FX swap USD₮→cNGN (1.485 → 2,136.20 cNGN): [`0x8757b051…696695`](https://celoscan.io/tx/0x8757b051bd74f2f61a00f5161ed3616373ecd56f562adb6d201133954a696695)
- cNGN payout to the freelancer's wallet: [`0xa9aa2547…e38e`](https://celoscan.io/tx/0xa9aa2547052679c5a20096e995966382b179093ae04c08ae47c65e5e5fe3e38e)

## Run it

```bash
npm install
npm test              # 10 contract tests: payouts, fee, disputes, timeouts, access control
npm run quote -- 25   # live Textile FX price check for 25 USD₮ in cNGN (no wallet needed)
cp .env.example .env  # add AGENT_PRIVATE_KEY, ESCROW_ADDRESS, ATTRIBUTION_CODES
npm run agent         # watches the contract and settles naira payouts
```

`npm run typecheck`, `npm run deploy` and `npm run register` are also available.

## Layout

- `contracts/DeliveryEscrow.sol`: the escrow
- `src/`: the agent (`agent.ts` loop, `settle.ts` naira payout, `textile.ts` Textile RFQ client, `chain.ts` tagged wallet client)
- `docs/index.html`: the web page for clients and freelancers (MiniPay and MetaMask)
- `test/`: contract tests

## Status and known limits

- The agent currently settles payouts. Automatic delivery review and dispute rulings are not built yet; disputes need the agent's operator.
- Textile's minimum swap is 1 USD₮ after the fee, so naira jobs must be at least 1.02 USD₮ (the page enforces this).
- A first live run found a bug where a lagging RPC node reported a stale balance of 0; the agent now reads the amount owed from the contract.
- Real client runs: in progress.
