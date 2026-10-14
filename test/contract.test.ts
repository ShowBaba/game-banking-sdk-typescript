// Contract test: the PRD §16.2 journey against a real engine.
// Runs only when GBE_BASE_URL is set, e.g. GBE_BASE_URL=http://localhost:8080 npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConflictError, GameBank, GameBankManagement, InsufficientFundsError, NotFoundError, PermissionDeniedError,
  type ResponseInfo, type Scope,
} from "../src/index.js";

const baseUrl = process.env.GBE_BASE_URL;
const ALL_SCOPES: Scope[] = ["bank:read", "bank:write", "account:read", "account:write", "transfer:create", "funding:create", "transaction:reverse", "limits:write"];
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

test("PRD §16.2 journey through the TypeScript SDK", { skip: !baseUrl && "set GBE_BASE_URL to run against an engine" }, async () => {
  // Sign up (a browser flow, so plain fetch) to get a developer session token.
  const reg = await fetch(`${baseUrl}/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "SDK Contract TS", email: `sdk-ts-${uniq()}@studio.test`, password: "contract-test-password" }),
  });
  assert.equal(reg.status, 201, await reg.clone().text());
  const session = ((await reg.json()) as { session: { token: string } }).session.token;

  // Management: a game, a full-scope sandbox key, and a bank configured with the developer credential.
  const mgmt = new GameBankManagement({ apiKey: session, baseUrl });
  assert.equal((await mgmt.me()).name, "SDK Contract TS");
  const game = await mgmt.games.create({ name: `TS Game ${uniq()}` });
  const key = await mgmt.apiKeys.issue(game.id, { environment: "sandbox", label: "contract", scopes: ALL_SCOPES });
  assert.ok(key.secret?.startsWith("gbe_test_sk_"));
  const bank = await mgmt.game(game.id, "sandbox").banks.create({ name: "Eko Trust Bank", base_currency: "NGN" });
  assert.equal(bank.system_accounts?.length, 7);
  const readOnly = await mgmt.apiKeys.issue(game.id, { environment: "sandbox", scopes: ["account:read"] });

  const responses: ResponseInfo[] = [];
  const gb = new GameBank({ apiKey: key.secret!, baseUrl, onResponse: (r) => responses.push(r) });
  assert.equal(gb.environment, "sandbox");

  // Players and accounts.
  const ada = await gb.players.upsert({ external_player_id: `ada-${uniq()}`, display_name: "Ada Obi" });
  assert.equal((await gb.players.upsert({ external_player_id: ada.external_player_id })).id, ada.id, "upsert is idempotent");
  const tunde = await gb.players.upsert({ external_player_id: `tunde-${uniq()}`, display_name: "Tunde Bello" });
  const adaAcct = await gb.accounts.open({ bank_id: bank.id, player_id: ada.id });
  const tundeAcct = await gb.accounts.open({ bank_id: bank.id, player_id: tunde.id });
  assert.match(adaAcct.account_number, /^\d{10}$/);

  // Funding, with an idempotent replay and a key reused for a different request.
  const salary = { account_id: adaAcct.id, amount_minor: 10_000_00, reason: "salary", reference: `pay-${uniq()}` };
  const funded = await gb.funding.create(salary, { idempotencyKey: `fund-${salary.reference}` });
  assert.equal(funded.balance.posted_balance, 10_000_00);
  const replay = await gb.funding.create(salary, { idempotencyKey: `fund-${salary.reference}` });
  assert.equal(replay.transaction.id, funded.transaction.id);
  assert.equal(responses.at(-1)?.replayed, true);
  await assert.rejects(gb.funding.create({ ...salary, amount_minor: 1 }, { idempotencyKey: `fund-${salary.reference}` }),
    (e: unknown) => e instanceof ConflictError && e.code === "idempotency_key_reused");

  // Name enquiry, then a transfer by account number.
  const who = await gb.nameEnquiry(bank.bank_code, tundeAcct.account_number);
  assert.equal(who.account_name, "Tunde Bello");
  const t = await gb.transfers.create({
    source_account_id: adaAcct.id, destination_account_number: tundeAcct.account_number, amount_minor: 2_500_00, narration: "Generator",
  });
  assert.equal(t.source_balance.posted_balance, 7_500_00);
  assert.equal(t.destination_balance?.posted_balance, 2_500_00);
  assert.equal(t.transaction.entries.length, 2);

  // Typed business errors.
  await assert.rejects(gb.transfers.create({ source_account_id: tundeAcct.id, destination_account_id: adaAcct.id, amount_minor: 99_999_00 }),
    (e: unknown) => e instanceof InsufficientFundsError && e.details.available_balance === 2_500_00 && !!e.requestId);
  await assert.rejects(gb.accounts.get("00000000-0000-0000-0000-000000000000"), NotFoundError);
  await assert.rejects(new GameBank({ apiKey: readOnly.secret!, baseUrl }).transfers.create({ source_account_id: adaAcct.id, destination_account_id: tundeAcct.id, amount_minor: 1 }),
    (e: unknown) => e instanceof PermissionDeniedError && e.code === "insufficient_scope");

  // Hold, then a partial capture: posted only moves on capture.
  const held = await gb.holds.place({ account_id: adaAcct.id, amount_minor: 3_000_00, reason: "Order #1", destination_account_id: tundeAcct.id });
  assert.equal(held.balance.posted_balance, 7_500_00);
  assert.equal(held.balance.available_balance, 4_500_00);
  const cap = await gb.holds.capture(held.hold.id, { amount_minor: 2_000_00 });
  assert.equal(cap.hold.status, "captured");
  assert.equal(cap.source_balance.posted_balance, 5_500_00);
  assert.equal(cap.source_balance.available_balance, 5_500_00);

  // A transfer whose first response is lost on the way back must post exactly once.
  let dropped = false;
  const lossy = new GameBank({
    apiKey: key.secret!, baseUrl,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      if (!dropped && String(input).endsWith("/v1/transfers")) {
        dropped = true;
        throw new TypeError("connection reset after the engine processed the request");
      }
      return res;
    },
  });
  const lost = await lossy.transfers.create({ source_account_id: adaAcct.id, destination_account_id: tundeAcct.id, amount_minor: 500_00 });
  assert.ok(dropped);
  assert.equal(lost.source_balance.posted_balance, 5_000_00, "the retried transfer must not post twice");
  assert.equal((await gb.accounts.balance(adaAcct.id)).posted_balance, 5_000_00);

  // History through the paginating iterator (small pages to force several requests).
  const lines = [];
  for await (const line of gb.accounts.iterateTransactions(adaAcct.id, { limit: 2 })) lines.push(line);
  assert.deepEqual(lines.map((l) => l.amount_minor), [500_00, 2_000_00, 2_500_00, 10_000_00]);
  assert.ok(lines.every((l) => l.session_id.length === 30 && l.game_time));

  // Reversal keeps the original and posts a compensating transaction.
  const rev = await gb.transactions.reverse(t.transaction.id, { reason: "customer dispute" });
  assert.equal(rev.type, "reversal");
  assert.equal((await gb.transactions.get(t.transaction.id)).status, "reversed");

  // Clock and integrity.
  await gb.clock.configure({ mode: "manual" });
  const adv = await gb.clock.advance({ days: 1 });
  assert.notEqual(adv.clock.game_day, undefined);
  const recon = await gb.reconcile();
  assert.equal(recon.ok, true, JSON.stringify(recon.differences));
});
