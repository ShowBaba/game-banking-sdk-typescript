// Contract test: the PRD §16.2 journey against a real engine.
// Runs only when GBE_BASE_URL is set, e.g. GBE_BASE_URL=http://localhost:8080 npm test
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  AuthenticationError, ConflictError, FeeChangedError, GameBank, GameBankManagement, InsufficientFundsError, NotFoundError,
  PenaltyChangedError, PermissionDeniedError, type ResponseInfo, type Scope, verifyWebhook,
} from "../src/index.js";

const baseUrl = process.env.GBE_BASE_URL;
const ALL_SCOPES: Scope[] = ["bank:read", "bank:write", "account:read", "account:write", "transfer:create", "funding:create", "transaction:reverse", "limits:write", "webhooks:read", "webhooks:write",
  "merchants:write", "cards:read", "cards:write", "cards:charge", "deposits:write"];
// Where the engine can reach this test's webhook receiver (the engine runs in Docker in CI and locally).
const receiverHost = process.env.GBE_WEBHOOK_RECEIVER_HOST ?? "host.docker.internal";

/** A local webhook receiver that keeps each raw delivery. */
async function startReceiver() {
  const got: { headers: IncomingHttpHeaders; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      got.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const waitFor = async (pred: (b: { headers: IncomingHttpHeaders; body: Buffer }) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const hit = got.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("no matching webhook delivery within 20s");
  };
  return { url: `http://${receiverHost}:${(server.address() as AddressInfo).port}/hooks`, got, waitFor, close: () => server.close() };
}
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
  assert.equal(bank.system_accounts?.length, 8); // incl. levies_payable
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
  assert.equal(held.hold.reserved_fee_minor, 0, "no hold_capture fees configured yet");
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

  // Fees: a ₦50 + 1% transfer fee (max ₦500) set up with the developer credential,
  // and a ₦50 levy from ₦10,000 set up with the game key.
  const cfg = mgmt.game(game.id, "sandbox");
  const fee = await cfg.fees.create(bank.id, {
    code: "transfer_fee", name: "Transfer fee", event: "transfer", model: "combined", fixed_minor: 50_00, percentage_bps: 100, max_fee_minor: 500_00,
  });
  assert.equal(fee.state, "in_effect");
  assert.equal(fee.credit_account, "fee_income");
  const levy = await gb.fees.create(bank.id, { code: "stamp_duty", name: "Stamp duty", event: "transfer", kind: "levy", model: "fixed", fixed_minor: 50_00, min_amount_minor: 10_000_00 });
  assert.equal(levy.credit_account, "levies_payable");
  assert.equal((await gb.fees.list(bank.id)).length, 2);

  const quote = await gb.fees.quote({ bank_id: bank.id, amount_minor: 1_000_00 });
  assert.equal(quote.fees_total_minor, 60_00); // ₦50 + 1% of ₦1,000; below the levy's ₦10,000
  const before = (await gb.accounts.balance(adaAcct.id)).posted_balance;
  const pay = { source_account_id: adaAcct.id, destination_account_id: tundeAcct.id, amount_minor: 1_000_00, max_fee_minor: quote.fees_total_minor };
  const paid = await gb.transfers.create(pay);
  assert.equal(paid.fees_total_minor, 60_00);
  assert.equal(paid.total_debit_minor, 1_060_00);
  assert.equal(paid.source_balance.posted_balance, before - 1_060_00);
  assert.deepEqual(paid.transaction.entries.map((e) => e.kind).sort(), ["fee", "fee", "principal", "principal"]);
  const latest = (await gb.accounts.transactions(adaAcct.id, { limit: 2 })).data;
  assert.ok(latest.some((l) => l.kind === "fee" && l.narration === "Transfer fee"), "the fee is its own labelled statement line");

  // The schedule changes after the player saw the quote: the engine refuses rather than charge more.
  await cfg.fees.update(bank.id, fee.id, { fixed_minor: 60_00 });
  await assert.rejects(gb.transfers.create(pay), (e: unknown) => e instanceof FeeChangedError && e instanceof ConflictError && e.code === "fee_changed");

  // The bank's books, and a reversal that refunds the fee.
  assert.equal((await gb.banks.books(bank.id)).fee_income_minor, 60_00);
  await gb.transactions.reverse(paid.transaction.id, { reason: "refund" });
  assert.equal((await gb.banks.books(bank.id)).fee_income_minor, 0);
  assert.equal((await cfg.fees.update(bank.id, fee.id, { status: "inactive" })).state, "inactive");

  // Webhooks: a debit alert reaches a real endpoint, signed, and verifies with the SDK helper.
  assert.equal((await mgmt.game(game.id, "sandbox").webhooks.endpoints.list()).length, 0, "developer credentials can manage webhooks");
  await assert.rejects(new GameBank({ apiKey: readOnly.secret!, baseUrl }).webhooks.endpoints.list(), PermissionDeniedError);
  const receiver = await startReceiver();
  try {
    const ep = await gb.webhooks.endpoints.create({ url: receiver.url, event_types: ["account.debited"], description: "contract" });
    assert.ok(ep.secret?.startsWith("whsec_") && ep.secret.startsWith(ep.secret_prefix));
    assert.equal((await gb.webhooks.endpoints.get(ep.id)).secret, undefined, "the secret is shown once");
    const probe = await gb.webhooks.endpoints.test(ep.id);
    assert.equal(probe.state, "delivered", probe.last_error ?? "");

    const sent = await gb.transfers.create({ source_account_id: adaAcct.id, destination_account_id: tundeAcct.id, amount_minor: 5_00, narration: "Webhook check" });
    const hit = await receiver.waitFor((d) => d.body.includes(sent.transaction.id));
    const event = verifyWebhook(hit.body, hit.headers["gbe-signature"] as string, ep.secret!);
    assert.equal(event.type, "account.debited");
    if (event.type !== "account.debited") throw new Error("unreachable");
    assert.equal(event.data.account_id, adaAcct.id);
    assert.equal(event.data.total_minor, 5_00);
    assert.equal(event.data.counterparty?.account_name, "Tunde Bello");
    assert.equal(event.data.balance_after.posted_minor, sent.source_balance.posted_balance);
    assert.equal(hit.headers["gbe-event-id"], event.id);

    // The event log, its deliveries, rotation and redelivery.
    const feed = await gb.webhooks.events.list({ type: "account.debited", account_id: adaAcct.id, limit: 1 });
    assert.equal(feed.data[0]?.id, event.id);
    assert.equal((await gb.webhooks.events.get(event.id)).id, event.id);
    const [delivery] = await gb.webhooks.events.deliveries(event.id);
    assert.equal(delivery?.state, "delivered");
    const rotated = await gb.webhooks.endpoints.rotateSecret(ep.id);
    assert.ok(rotated.secret && rotated.secret !== ep.secret && rotated.previous_secret_expires_at);
    const before = receiver.got.length;
    await gb.webhooks.events.redeliver(event.id, { endpoint_id: ep.id });
    const again = await receiver.waitFor((d) => receiver.got.indexOf(d) >= before);
    verifyWebhook(again.body, again.headers["gbe-signature"] as string, rotated.secret!);
    verifyWebhook(again.body, again.headers["gbe-signature"] as string, ep.secret!); // both sign during the overlap

    assert.equal((await gb.webhooks.endpoints.update(ep.id, { status: "disabled" })).status, "disabled");
    await gb.webhooks.endpoints.delete(ep.id);
    await assert.rejects(gb.webhooks.endpoints.get(ep.id), NotFoundError);
  } finally {
    receiver.close();
  }

  // Merchants and cards: a shop with a merchant account, a card, a payment, a refund, a lost card.
  const shop = await gb.merchants.create({ external_merchant_id: `shop-${uniq()}`, name: "Mama Put", category: "food" });
  assert.equal((await gb.merchants.create({ external_merchant_id: shop.external_merchant_id, name: "x" })).id, shop.id, "merchants are idempotent");
  const till = await gb.accounts.open({ bank_id: bank.id, merchant_id: shop.id });
  assert.equal(till.owner_type, "merchant");
  assert.equal(till.merchant_id, shop.id);
  await cfg.banks.update(bank.id, { feature_flags: { cards: true } });
  const program = await cfg.cardPrograms.create(bank.id, { name: "Classic", daily_limit_minor: 3_000_00 });
  assert.equal(program.bin.length, 6);
  const issued = await gb.cards.issue({ account_id: adaAcct.id, name_on_card: "Ada Obi" });
  assert.equal(issued.card_number.length, 16);
  assert.equal(issued.card.masked_number, `${issued.card_number.slice(0, 6)}******${issued.card_number.slice(12)}`);
  assert.equal((await gb.cards.get(issued.card.id)).status, "active");

  const spendable = (await gb.accounts.balance(adaAcct.id)).available_balance;
  const auth = await gb.cardAuthorizations.authorize({
    card_number: issued.card_number, expiry_month: issued.card.expiry_month, expiry_year: issued.card.expiry_year, cvv: issued.cvv,
    merchant_account_number: till.account_number, amount_minor: 200_00, capture: false, description: "Jollof",
  });
  assert.equal(auth.authorization.status, "approved");
  assert.equal(auth.balance.available_balance, spendable - 200_00);
  const captured = await gb.cardAuthorizations.capture(auth.authorization.id, { amount_minor: 150_00 });
  assert.equal(captured.transaction.type, "card_payment");
  assert.equal(captured.merchant_balance.posted_balance, 150_00);
  assert.equal(captured.card_balance.available_balance, spendable - 150_00, "the uncaptured ₦50 is released");
  const refunded = await gb.cardAuthorizations.refund(auth.authorization.id, { amount_minor: 50_00, reason: "cold" });
  assert.equal(refunded.transaction.type, "card_refund");
  assert.equal(refunded.authorization.refunded_minor, 50_00);

  // By default a payment is approved and captured in the same call.
  const instant = await gb.cardAuthorizations.authorize({ card_id: issued.card.id, merchant_account_id: till.id, amount_minor: 20_00 });
  assert.equal(instant.authorization.status, "captured");
  assert.equal(instant.transaction?.type, "card_payment");
  assert.equal(instant.merchant_balance?.posted_balance, 120_00);

  // Declines are results, not errors; a payment approved before a card is lost still captures.
  const pending = await gb.cardAuthorizations.authorize({ card_id: issued.card.id, merchant_account_id: till.id, amount_minor: 10_00, capture: false });
  assert.equal((await gb.cards.reportLost(issued.card.id, { reason: "stolen" })).status, "stolen");
  const refused = await gb.cardAuthorizations.authorize({ card_id: issued.card.id, merchant_account_id: till.id, amount_minor: 10_00 });
  assert.equal(refused.authorization.status, "declined");
  assert.equal(refused.authorization.decline_code, "card_stolen");
  assert.equal((await gb.cardAuthorizations.capture(pending.authorization.id)).authorization.status, "captured");
  assert.equal((await gb.cards.list({ account_id: adaAcct.id })).length, 1, "no replacement card");
  assert.equal((await gb.cardAuthorizations.list({ card_id: issued.card.id })).length, 4);

  // Clock and integrity.
  await gb.clock.configure({ mode: "manual" });
  const adv = await gb.clock.advance({ days: 1 });
  assert.notEqual(adv.clock.game_day, undefined);
  const recon = await gb.reconcile();
  assert.equal(recon.ok, true, JSON.stringify(recon.differences));

  // Savings: ₦100,000 at 36.5% earns ₦100 a game day; a fixed deposit can be broken early.
  await cfg.banks.update(bank.id, { feature_flags: { savings: true } });
  const saver = await cfg.depositProducts.create(bank.id, { code: "easy_saver", name: "Easy Saver", kind: "savings", rate_tiers: [{ from_minor: 0, rate_bps: 3650 }] });
  const term = await cfg.depositProducts.create(bank.id, {
    code: "term", name: "Term Deposit", kind: "fixed_deposit", terms: [{ days: 30, rate_bps: 3650 }], early_forfeit_bps: 10_000, early_penalty_fixed_minor: 100_00,
  });
  const savings = await gb.accounts.open({ bank_id: bank.id, player_id: ada.id, product_id: saver.id });
  assert.equal(savings.account_type, "savings");
  await gb.funding.create({ account_id: savings.id, amount_minor: 100_000_00, reason: "savings", reference: `save-${uniq()}` });
  await gb.funding.create({ account_id: adaAcct.id, amount_minor: 100_000_00, reason: "deposit", reference: `fd-${uniq()}` });
  const fd = await gb.fixedDeposits.open({ source_account_id: adaAcct.id, product_id: term.id, term_days: 30, amount_minor: 100_000_00 });
  assert.equal(fd.fixed_deposit.status, "active");
  assert.equal((await gb.depositProducts.quote({ product_id: term.id, amount_minor: 100_000_00, term_days: 30 })).gross_interest_minor, 3_000_00);
  await gb.clock.advance({ days: 2 });
  const position = await gb.accounts.interest(savings.id);
  assert.equal(position.accrued_interest_minor, 200_00);
  assert.equal(position.rate_bps, 3650);
  const bq = await gb.fixedDeposits.breakQuote(fd.fixed_deposit.id);
  assert.equal(bq.accrued_interest_minor, 200_00);
  assert.equal(bq.payout_minor, 100_000_00 - 100_00, "all interest forfeited, ₦100 penalty");
  await assert.rejects(gb.fixedDeposits.break(fd.fixed_deposit.id, { max_penalty_minor: 50_00 }), PenaltyChangedError);
  assert.equal((await gb.fixedDeposits.break(fd.fixed_deposit.id, { max_penalty_minor: bq.penalty_minor })).fixed_deposit.status, "broken");
  assert.equal((await gb.banks.books(bank.id)).accrued_interest_minor >= 200_00, true);

  // Renaming and deleting a game. Deleting revokes its keys at once.
  assert.equal((await mgmt.games.update(game.id, { name: "TS Game renamed" })).name, "TS Game renamed");
  await mgmt.games.delete(game.id);
  await assert.rejects(mgmt.games.get(game.id), NotFoundError);
  await assert.rejects(gb.clock.get(), AuthenticationError);
});
