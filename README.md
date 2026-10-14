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
