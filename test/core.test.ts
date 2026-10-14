import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConflictError, ConnectionError, GameBank, GameBankError, InsufficientFundsError, RateLimitError, ServerError,
  formatMinor, toMinor,
} from "../src/index.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fake fetch that returns the scripted replies in order and records each call. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    const r = replies.shift();
    if (!r) throw new Error("no more scripted replies");
    if (r instanceof Error) throw r;
    const text = typeof r.body === "string" ? r.body : r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(r.status === 204 ? null : text, { status: r.status, headers: { "Content-Type": "application/json", ...r.headers } });
  }) as typeof fetch;
  return { fn, calls };
}

const client = (f: typeof fetch, extra: object = {}) =>
  new GameBank({ apiKey: "gbe_test_sk_abc", baseUrl: "http://engine.test/", fetch: f, ...extra });

const transferBody = { transaction: { id: "t1" }, source_balance: {} };
const err = (status: number, code: string, details = {}) => ({ status, body: { error: { code, message: code, details, correlation_id: "req_1" } } });

describe("configuration", () => {
  it("reads the environment from the key prefix and trims the base URL", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { mode: "manual" } }]);
    const gb = client(fn);
    assert.equal(gb.environment, "sandbox");
    await gb.clock.get();
    assert.equal(calls[0]!.url, "http://engine.test/v1/clock");
    assert.equal(calls[0]!.headers.Authorization, "Bearer gbe_test_sk_abc");
    assert.equal(new GameBank({ apiKey: "gbe_live_sk_x", baseUrl: "http://e" }).environment, "production");
  });

  it("refuses to run in a browser unless explicitly allowed", () => {
    const g = globalThis as { document?: unknown };
    g.document = {};
    try {
      assert.throws(() => new GameBank({ apiKey: "gbe_test_sk_x", baseUrl: "http://e" }), (e: GameBankError) => e.code === "browser_not_allowed");
      assert.doesNotThrow(() => new GameBank({ apiKey: "gbe_test_sk_x", baseUrl: "http://e", dangerouslyAllowBrowser: true }));
    } finally {
      delete g.document;
    }
  });

  it("requires a key and a base URL, falling back to GBE_API_KEY and GBE_BASE_URL", () => {
    const saved = { key: process.env.GBE_API_KEY, url: process.env.GBE_BASE_URL };
    delete process.env.GBE_API_KEY;
    delete process.env.GBE_BASE_URL;
    try {
      assert.throws(() => new GameBank({ baseUrl: "http://e" }), (e: GameBankError) => e.code === "missing_api_key");
      assert.throws(() => new GameBank({ apiKey: "gbe_test_sk_x" }), (e: GameBankError) => e.code === "missing_base_url");
      process.env.GBE_API_KEY = "gbe_live_sk_env";
      process.env.GBE_BASE_URL = "http://from-env";
      assert.equal(new GameBank().environment, "production");
    } finally {
      for (const [k, v] of [["GBE_API_KEY", saved.key], ["GBE_BASE_URL", saved.url]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("idempotency and retries", () => {
  it("generates one Idempotency-Key per money call and reuses it on retries", async () => {
    const { fn, calls } = fakeFetch([new TypeError("socket hang up"), { status: 503, body: {} }, { status: 201, body: transferBody }]);
    const r = await client(fn).transfers.create({ source_account_id: "a", destination_account_id: "b", amount_minor: 100 }, { maxRetries: 2 });
    assert.equal(r.transaction.id, "t1");
    assert.equal(calls.length, 3);
    const keys = calls.map((c) => c.headers["Idempotency-Key"]);
    assert.ok(keys[0]?.startsWith("sdk_"));
    assert.deepEqual(new Set(keys).size, 1);
  });

  it("uses the caller's key as given", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: transferBody }]);
    await client(fn).transfers.create({ source_account_id: "a", destination_account_id: "b", amount_minor: 1 }, { idempotencyKey: "order-42" });
    assert.equal(calls[0]!.headers["Idempotency-Key"], "order-42");
  });

  it("never retries a plain POST that may have reached the server", async () => {
    for (const reply of [new TypeError("reset") as Reply, { status: 502, body: {} }]) {
      const { fn, calls } = fakeFetch([reply, { status: 201, body: {} }]);
      await assert.rejects(client(fn).accounts.open({ bank_id: "b", player_id: "p" }));
      assert.equal(calls.length, 1, "accounts.open must not be retried");
      assert.equal(calls[0]!.headers["Idempotency-Key"], undefined);
    }
  });

  it("retries rate limits for any request, honouring Retry-After", async () => {
    const { fn, calls } = fakeFetch([{ status: 429, body: { error: { code: "rate_limited" } }, headers: { "Retry-After": "1" } }, { status: 201, body: { id: "acc" } }]);
    const started = Date.now();
    const a = await client(fn).accounts.open({ bank_id: "b", player_id: "p" });
    assert.equal(a.id, "acc");
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - started >= 950, "should wait for Retry-After");
  });

  it("retries GETs and upserts after network errors", async () => {
    const { fn, calls } = fakeFetch([new TypeError("reset"), { status: 200, body: { id: "p1" } }, new TypeError("reset"), { status: 200, body: { id: "p2" } }]);
    const gb = client(fn);
    assert.equal((await gb.players.get("p1")).id, "p1");
    assert.equal((await gb.players.upsert({ external_player_id: "x" })).id, "p2");
    assert.equal(calls.length, 4);
  });

  it("stops after maxRetries and surfaces the last error", async () => {
    const { fn, calls } = fakeFetch([{ status: 500, body: {} }, { status: 500, body: {} }]);
    await assert.rejects(client(fn, { maxRetries: 1 }).accounts.balance("a"), ServerError);
    assert.equal(calls.length, 2);
  });

  it("retries request_in_progress conflicts for keyed requests only", async () => {
    const { fn, calls } = fakeFetch([{ ...err(409, "request_in_progress"), headers: { "Retry-After": "1" } }, { status: 201, body: transferBody }]);
    await client(fn).transfers.create({ source_account_id: "a", destination_account_id: "b", amount_minor: 1 });
    assert.equal(calls.length, 2);
  });
});

describe("errors", () => {
  it("maps engine error codes to typed errors with details and request ID", async () => {
    const { fn } = fakeFetch([err(422, "insufficient_funds", { available_balance: 5, requested_amount: 9 })]);
    await assert.rejects(client(fn).transfers.create({ source_account_id: "a", destination_account_id: "b", amount_minor: 9 }), (e: unknown) => {
      assert.ok(e instanceof InsufficientFundsError);
      assert.equal(e.status, 422);
      assert.equal(e.details.available_balance, 5);
      assert.equal(e.requestId, "req_1");
      return true;
    });
    const c = fakeFetch([err(409, "idempotency_key_reused")]);
    await assert.rejects(client(c.fn).transfers.create({ source_account_id: "a", destination_account_id: "b", amount_minor: 9 }), ConflictError);
  });

  it("reports a network failure as ConnectionError after retries", async () => {
    const { fn } = fakeFetch([new TypeError("ECONNREFUSED"), new TypeError("ECONNREFUSED")]);
    await assert.rejects(client(fn, { maxRetries: 1 }).clock.get(), (e: unknown) => e instanceof ConnectionError && e.status === 0);
  });

  it("explains an HTML page instead of the engine", async () => {
    const { fn } = fakeFetch([{ status: 200, body: "<!doctype html><html></html>", headers: { "Content-Type": "text/html" } }]);
    await assert.rejects(client(fn).clock.get(), (e: GameBankError) => e.code === "invalid_response" && /baseUrl/.test(e.message));
  });

  it("rejects a non-integer amount before sending anything", async () => {
    const { fn, calls } = fakeFetch([]);
    await assert.rejects(client(fn).funding.create({ account_id: "a", amount_minor: 10.5, reason: "r", reference: "x" }), RangeError);
    assert.equal(calls.length, 0);
  });

  it("subtypes are still GameBankErrors", () => {
    assert.ok(new RateLimitError({ status: 429, code: "rate_limited", message: "" }) instanceof GameBankError);
  });
});

describe("money", () => {
  it("converts between decimal strings and minor units without floats", () => {
    assert.equal(toMinor("100.50", 2), 10050);
    assert.equal(toMinor("1,234.5", 2), 123450);
    assert.equal(toMinor("0.07", 2), 7);
    assert.equal(toMinor("42", 0), 42);
    assert.equal(toMinor("-3.2", 1), -32);
    assert.equal(formatMinor(10050, 2), "100.50");
    assert.equal(formatMinor(7, 2), "0.07");
    assert.equal(formatMinor(-5, 3), "-0.005");
    assert.equal(formatMinor(42, 0), "42");
    assert.throws(() => toMinor("1.005", 2), RangeError);
    assert.throws(() => toMinor("abc", 2), RangeError);
    assert.throws(() => toMinor("99999999999999999", 2), RangeError);
  });
});
