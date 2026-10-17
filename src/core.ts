import { ConnectionError, GameBankError, errorFor } from "./errors.js";
import type { Environment } from "./types.js";

export const VERSION = "0.5.0";

export interface ClientOptions {
  /** Game API key or developer credential. Defaults to the GBE_API_KEY environment variable. */
  apiKey?: string;
  /** The engine's address, e.g. https://game-banking-engine.onrender.com. Defaults to GBE_BASE_URL. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Default 30 000. */
  timeout?: number;
  /** Extra attempts after a retryable failure. Default 2. */
  maxRetries?: number;
  /** Called after every HTTP response, including retried ones. */
  onResponse?: (info: ResponseInfo) => void;
  /** A custom fetch, e.g. for proxies or tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * The SDK refuses to run in a browser, because a game API key there can be
   * stolen and used to move money. Set this only for trusted internal tools.
   */
  dangerouslyAllowBrowser?: boolean;
}

export interface RequestOptions {
  /** Your own stable key for a money-moving call. Retrying with it never moves money twice. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

export interface ResponseInfo {
  method: string;
  path: string;
  status: number;
  requestId: string | undefined;
  /** True when the engine returned a stored result for a repeated Idempotency-Key. */
  replayed: boolean;
  /** 0 for the first attempt. */
  attempt: number;
}

/** How one operation behaves on the wire. */
export interface Operation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Money-moving: send an Idempotency-Key (generated when the caller gives none). */
  idempotent?: boolean;
  /** Safe to retry after a possible partial failure even without a key (e.g. an upsert). */
  retrySafe?: boolean;
}

const RETRY_STATUSES = new Set([500, 502, 503, 504]);

/** Reads the environment a game API key belongs to from its prefix. */
export function environmentOf(apiKey: string): Environment | undefined {
  if (apiKey.startsWith("gbe_test_sk_")) return "sandbox";
  if (apiKey.startsWith("gbe_live_sk_")) return "production";
  return undefined;
}

function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name];
}

function newKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `sdk_${c.randomUUID()}`;
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/** Exponential backoff with jitter, or the server's Retry-After when it sent one. */
export function retryDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) return Math.min(retryAfterSeconds, 60) * 1000;
  const base = Math.min(500 * 2 ** attempt, 8000);
  return Math.round(base * (0.75 + Math.random() * 0.25));
}

export class Transport {
  readonly baseUrl: string;
  readonly environment: Environment | undefined;
  private readonly token: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onResponse: ClientOptions["onResponse"];
  private readonly headers: Record<string, string>;

  constructor(opts: ClientOptions, extraHeaders: Record<string, string> = {}) {
    if (!opts.dangerouslyAllowBrowser && typeof (globalThis as { document?: unknown }).document !== "undefined") {
      throw new GameBankError({
        status: 0, code: "browser_not_allowed",
        message: "The Game Banking SDK runs on your game servers only. A game API key in a browser can be stolen and used to move money.",
      });
    }
    const token = opts.apiKey ?? env("GBE_API_KEY");
    if (!token) throw new GameBankError({ status: 0, code: "missing_api_key", message: "Pass apiKey or set GBE_API_KEY." });
    const baseUrl = opts.baseUrl ?? env("GBE_BASE_URL");
    if (!baseUrl) throw new GameBankError({ status: 0, code: "missing_base_url", message: "Pass baseUrl (your engine's address) or set GBE_BASE_URL." });
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new GameBankError({ status: 0, code: "fetch_unavailable", message: "No global fetch: use Node.js 18+ or pass options.fetch." });

    this.token = token.trim();
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.environment = environmentOf(this.token);
    this.timeout = opts.timeout ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchImpl = fetchImpl;
    this.onResponse = opts.onResponse;
    this.headers = extraHeaders;
  }

  /** A copy of this transport that sends extra headers (used for X-Game-Id / X-Environment). */
  withHeaders(headers: Record<string, string>, opts: ClientOptions): Transport {
    return new Transport({ ...opts, apiKey: this.token, baseUrl: this.baseUrl }, { ...this.headers, ...headers });
  }

  async request<T>(op: Operation, ro: RequestOptions = {}): Promise<T> {
    const url = this.url(op);
    const key = op.idempotent ? ro.idempotencyKey ?? newKey() : ro.idempotencyKey;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": `gamebanking-sdk-typescript/${VERSION}`,
      ...this.headers,
    };
    if (op.body !== undefined) headers["Content-Type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
    const body = op.body === undefined ? undefined : JSON.stringify(op.body);
    const retrySafe = op.method === "GET" || op.method === "PUT" || !!key || !!op.retrySafe;
    const maxRetries = ro.maxRetries ?? this.maxRetries;

    for (let attempt = 0; ; attempt++) {
      let err: GameBankError;
      try {
        const res = await this.send(url, { method: op.method, headers, body }, ro);
        const requestId = res.headers.get("X-Request-Id") ?? undefined;
        this.onResponse?.({
          method: op.method, path: op.path, status: res.status, requestId,
          replayed: res.headers.get("Idempotent-Replayed") === "true", attempt,
        });
        if (res.ok) return (await this.parse(res, requestId)) as T;
        err = await this.toError(res, requestId);
      } catch (e) {
        if (!(e instanceof GameBankError)) throw e; // caller's abort
        err = e;
      }
      if (attempt >= maxRetries || !this.shouldRetry(err, retrySafe)) throw err;
      await sleep(retryDelay(attempt, err.retryAfter), ro.signal);
    }
  }

  private shouldRetry(err: GameBankError, retrySafe: boolean): boolean {
    if (err.status === 429) return true;
    if (!retrySafe) return false;
    return err.status === 0 || RETRY_STATUSES.has(err.status) || (err.status === 409 && err.code === "request_in_progress");
  }

  private url(op: Operation): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(op.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const s = q.toString();
    return `${this.baseUrl}${op.path}${s ? `?${s}` : ""}`;
  }

  private async send(url: string, init: RequestInit, ro: RequestOptions): Promise<Response> {
    const ac = new AbortController();
    const timeoutMs = ro.timeout ?? this.timeout;
    const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => ac.abort(ro.signal?.reason);
    if (ro.signal?.aborted) onAbort();
    ro.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: ac.signal });
    } catch (e) {
      if (ro.signal?.aborted) throw ro.signal.reason ?? e;
      const timedOut = ac.signal.aborted;
      throw new ConnectionError({
        status: 0,
        code: timedOut ? "timeout" : "connection_error",
        message: timedOut ? `No response from ${this.baseUrl} within ${timeoutMs} ms` : `Could not reach the engine at ${this.baseUrl}: ${(e as Error).message}`,
        cause: e,
      });
    } finally {
      clearTimeout(timer);
      ro.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async parse(res: Response, requestId: string | undefined): Promise<unknown> {
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new GameBankError({
        status: res.status, code: "invalid_response", requestId,
        message: `Expected JSON from the engine but got ${res.headers.get("Content-Type") ?? "an unknown content type"}. Check that baseUrl (${this.baseUrl}) points at the engine, not a website.`,
      });
    }
  }

  private async toError(res: Response, requestId: string | undefined): Promise<GameBankError> {
    let e: { code?: string; message?: string; details?: Record<string, unknown>; correlation_id?: string } | undefined;
    try {
      e = ((await res.json()) as { error?: typeof e }).error;
    } catch {
      /* not JSON */
    }
    const ra = Number(res.headers.get("Retry-After"));
    return errorFor({
      status: res.status,
      code: e?.code ?? `http_${res.status}`,
      message: e?.message ?? (res.statusText || `HTTP ${res.status}`),
      details: e?.details ?? {},
      requestId: e?.correlation_id ?? requestId,
      retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined,
    });
  }
}
