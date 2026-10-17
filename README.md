# @gamebanking/sdk (TypeScript / JavaScript)

Server-side SDK for the Game Banking Engine. Node.js 18+ (also Bun and Deno), ESM, no runtime dependencies.

> Game API keys move money. Use this SDK on your game servers only. It refuses to run in a browser.

## Install

```bash
npm install @gamebanking/sdk
```

## Quick start

```ts
import { GameBank, InsufficientFundsError } from "@gamebanking/sdk";

const gb = new GameBank({ apiKey: process.env.GBE_API_KEY, baseUrl: "https://your-engine.example.com" });

// Map your player, open an account, pay a salary.
const player = await gb.players.upsert({ external_player_id: "user-42", display_name: "Ada Obi" });
const account = await gb.accounts.open({ bank_id: BANK_ID, player_id: player.id });
await gb.funding.create(
  { account_id: account.id, amount_minor: 500_000, reason: "salary", reference: "payroll-2040-06-01-user-42" },
  { idempotencyKey: "payroll-2040-06-01-user-42" }, // your stable ID: retrying never pays twice
);

// Confirm the recipient, then transfer.
const who = await gb.nameEnquiry("058", "5915945174");
try {
  await gb.transfers.create({ source_account_id: account.id, destination_account_number: "5915945174", amount_minor: 1_000 });
} catch (e) {
  if (e instanceof InsufficientFundsError) console.log("short by", Number(e.details.requested_amount) - Number(e.details.available_balance));
  else throw e;
}

// Statement, newest first, across pages.
for await (const line of gb.accounts.iterateTransactions(account.id)) console.log(line.direction, line.amount_display, line.narration);
```

Holds: `gb.holds.place(...)`, `gb.holds.capture(id, { amount_minor })`, `gb.holds.release(id)`. Reversals: `gb.transactions.reverse(id, { reason })`. Clock: `gb.clock.get()`, `configure()`, `advance()`.

## Fees and charges

```ts
import { FeeChangedError } from "@gamebanking/sdk";

// Show the player what the transfer costs, then cap the fee at what they saw.
const quote = await gb.fees.quote({ bank_id: BANK_ID, amount_minor: 2_000_00 });
try {
  const r = await gb.transfers.create({
    source_account_id: account.id, destination_account_number: "5915945174",
    amount_minor: 2_000_00, max_fee_minor: quote.fees_total_minor,
  });
  console.log(r.fees, r.total_debit_minor); // each fee is its own ledger and statement line
} catch (e) {
  if (e instanceof FeeChangedError) { /* the schedule changed: quote again */ } else throw e;
}

// Configure fees (bank:write): ₦50 + 1%, capped at ₦500, on transfers of ₦1,000 or more.
await gb.fees.create(BANK_ID, {
  code: "transfer_fee", name: "Transfer fee", event: "transfer", model: "combined",
  fixed_minor: 50_00, percentage_bps: 100, max_fee_minor: 500_00, min_amount_minor: 1_000_00,
});
const books = await gb.banks.books(BANK_ID); // fee_income_minor, levies_payable_minor
```

## Merchants and cards

```ts
// A shop and its merchant account (card payments settle here).
const shop = await gb.merchants.create({ external_merchant_id: "shop:mama-put", name: "Mama Put", category: "food" });
const till = await gb.accounts.open({ bank_id: BANK_ID, merchant_id: shop.id });

// Once per bank: turn on cards and add a program (bank:write).
await gb.banks.update(BANK_ID, { feature_flags: { cards: true } });
await gb.cardPrograms.create(BANK_ID, { name: "Classic", daily_limit_minor: 50_000_00 });

// Issue a card: card_number and cvv are shown only now.
const { card, card_number, cvv } = await gb.cards.issue({ account_id: account.id });

// Pay: an approved payment is charged at once (status "captured"). A decline is a result, not an exception.
const paid = await gb.cardAuthorizations.authorize({ card_id: card.id, merchant_account_id: till.id, amount_minor: 2_500_00 });
if (paid.authorization.status === "declined") showPlayer(paid.authorization.decline_code); // e.g. "insufficient_funds"

// Or hold first when the final amount or the sale isn't settled yet (a fuel pump, a pre-order).
const held = await gb.cardAuthorizations.authorize({ card_id: card.id, merchant_account_id: till.id, amount_minor: 2_500_00, capture: false });
await gb.cardAuthorizations.capture(held.authorization.id, { amount_minor: 2_100_00 }); // or release(); refund() later, in parts

await gb.cards.reportLost(card.id, { reason: "stolen" }); // final; no replacement is issued
```

## Savings and fixed deposits

```ts
// Once per bank: turn savings on and define products (bank:write).
await gb.banks.update(BANK_ID, { feature_flags: { savings: true } });
const saver = await gb.depositProducts.create(BANK_ID, {
  code: "easy_saver", name: "Easy Saver", kind: "savings", rate_tiers: [{ from_minor: 0, rate_bps: 300 }],
  withholding_tax_bps: 1000, withdrawals_per_month: 3, excess_withdrawal_action: "forfeit_interest",
});
const term = await gb.depositProducts.create(BANK_ID, { code: "term", name: "Term Deposit", kind: "fixed_deposit", terms: [{ days: 90, rate_bps: 800 }] });

// A savings account earns daily on the game clock and is paid monthly.
const savings = await gb.accounts.open({ bank_id: BANK_ID, player_id: player.id, product_id: saver.id });
const { accrued_interest_minor, next_payout_day } = await gb.accounts.interest(savings.id);

// A fixed deposit (deposits:write); break it early with a quote first.
const { fixed_deposit } = await gb.fixedDeposits.open({ source_account_id: account.id, product_id: term.id, term_days: 90, amount_minor: 50_000_00 });
const quote = await gb.fixedDeposits.breakQuote(fixed_deposit.id);
await gb.fixedDeposits.break(fixed_deposit.id, { max_penalty_minor: quote.penalty_minor }); // PenaltyChangedError if it rose
```

## Webhooks: debit and credit alerts

Every money movement on a player's account sends a signed `account.debited` or `account.credited` event to your endpoint. Verify it with the **raw** body:

```ts
import express from "express";
import { verifyWebhook, WebhookVerificationError } from "@gamebanking/sdk";

// Register once (webhooks:write). The secret is shown only here.
const ep = await gb.webhooks.endpoints.create({ url: "https://game.example.com/gbe/webhooks", event_types: ["account.debited", "account.credited"] });

app.post("/gbe/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.get("GBE-Signature"), process.env.GBE_WEBHOOK_SECRET!);
    if (event.type === "account.debited") {
      const a = event.data; // amount_minor, charges, total_minor, balance_after, counterparty, sequence…
      notifyPlayer(a.player_id, `-${a.total_display} ${a.narration ?? ""}`);
    }
    res.sendStatus(204); // answer within 10s; delivery is at least once, so dedupe on event.id
  } catch (e) {
    res.sendStatus(e instanceof WebhookVerificationError ? 400 : 500);
  }
});
```

`gb.webhooks.endpoints` also has `list`, `get`, `update` (`{ status: "disabled" | "active" }`), `delete`, `rotateSecret` (the old secret keeps signing for 24 hours) and `test`. `gb.webhooks.events` has `list` / `iterate` (the last 30 days, filterable by `type` and `account_id`, also a polling feed), `get`, `deliveries` and `redeliver`.

## Setup and CI

```ts
import { GameBankManagement } from "@gamebanking/sdk";

const mgmt = new GameBankManagement({ apiKey: process.env.GBE_DEV_CREDENTIAL, baseUrl });
const game = await mgmt.games.create({ name: "Lagos Hustle" });
const key = await mgmt.apiKeys.issue(game.id, { environment: "sandbox", scopes: ["account:read", "account:write", "transfer:create"] });
console.log(key.secret); // shown once
await mgmt.game(game.id, "sandbox").banks.create({ name: "Eko Trust Bank", base_currency: "NGN" });
```

`mgmt.games.update(id, { name, slug, status })` renames or suspends a game; `mgmt.games.delete(id)` deletes it and revokes its keys.

## Behaviour

Retries, idempotency keys, error types and money helpers follow the shared contract in [`CONTRACT.md`](CONTRACT.md). Options: `apiKey`, `baseUrl`, `timeout` (ms), `maxRetries`, `onResponse`, `fetch`. Per call: `{ idempotencyKey, signal, timeout, maxRetries }`. `toMinor("100.50", 2)` and `formatMinor(10050, 2)` convert amounts without floating point.

## Development

Unit tests need no network:

```bash
npm install
npm test
```

The contract test runs the full journey against a real engine. `ci/docker-compose.yml` starts one (PostgreSQL plus the engine's published image) on port 8080:

```bash
docker compose -f ci/docker-compose.yml up -d && ./ci/wait-for-engine.sh
GBE_BASE_URL=http://localhost:8080 npm test
docker compose -f ci/docker-compose.yml down -v
```

To test against a local engine build instead, build its image and set `GBE_ENGINE_IMAGE` to that tag. CI (`.github/workflows/ci.yml`) runs both on every push.
