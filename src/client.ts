import { Transport, type ClientOptions, type RequestOptions } from "./core.js";
import { assertMinor } from "./money.js";
import type * as T from "./types.js";

const enc = encodeURIComponent;

function checkAmount(params: { amount_minor?: number | undefined }, required: boolean) {
  if (params.amount_minor === undefined && !required) return;
  assertMinor(params.amount_minor, "amount_minor");
}

class Resource {
  constructor(protected readonly t: Transport) {}
}

export class Players extends Resource {
  /** Maps your player ID to an engine player; repeat calls return the same player. */
  upsert(params: T.UpsertPlayerParams, ro?: RequestOptions) {
    return this.t.request<T.Player>({ method: "POST", path: "/v1/players", body: params, retrySafe: true }, ro);
  }
  get(playerId: string, ro?: RequestOptions) {
    return this.t.request<T.Player>({ method: "GET", path: `/v1/players/${enc(playerId)}` }, ro);
  }
  /** Looks a player up by your own player ID. */
  findByExternalId(externalPlayerId: string, ro?: RequestOptions) {
    return this.t.request<T.Player>({ method: "GET", path: "/v1/players", query: { external_player_id: externalPlayerId } }, ro);
  }
}

export class Accounts extends Resource {
  open(params: T.OpenAccountParams, ro?: RequestOptions) {
    return this.t.request<T.Account>({ method: "POST", path: "/v1/accounts", body: params }, ro);
  }
  get(accountId: string, ro?: RequestOptions) {
    return this.t.request<T.Account>({ method: "GET", path: `/v1/accounts/${enc(accountId)}` }, ro);
  }
  async list(params: T.ListAccountsParams = {}, ro?: RequestOptions): Promise<T.Account[]> {
    const r = await this.t.request<{ data: T.Account[] }>({ method: "GET", path: "/v1/accounts", query: { ...params } }, ro);
    return r.data;
  }
  /** Freezes (no debits), unfreezes or closes an account. Closing needs a zero balance. */
  updateStatus(accountId: string, params: T.UpdateAccountStatusParams, ro?: RequestOptions) {
    return this.t.request<T.Account>({ method: "PATCH", path: `/v1/accounts/${enc(accountId)}`, body: params }, ro);
  }
  balance(accountId: string, ro?: RequestOptions) {
    return this.t.request<T.Balance>({ method: "GET", path: `/v1/accounts/${enc(accountId)}/balance` }, ro);
  }
  /** One page of history, newest first. Pass next_cursor back as cursor for the next page. */
  transactions(accountId: string, params: { limit?: number; cursor?: string } = {}, ro?: RequestOptions) {
    return this.t.request<T.Page<T.HistoryItem>>({ method: "GET", path: `/v1/accounts/${enc(accountId)}/transactions`, query: params }, ro);
  }
  /** Every history line, newest first, fetching pages as needed. */
  async *iterateTransactions(accountId: string, params: { limit?: number } = {}, ro?: RequestOptions): AsyncGenerator<T.HistoryItem> {
    let cursor: string | undefined;
    do {
      const page = await this.transactions(accountId, { ...params, ...(cursor ? { cursor } : {}) }, ro);
      yield* page.data;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  async holds(accountId: string, params: { status?: T.Hold["status"] } = {}, ro?: RequestOptions): Promise<T.Hold[]> {
    const r = await this.t.request<{ data: T.Hold[] }>({ method: "GET", path: `/v1/accounts/${enc(accountId)}/holds`, query: params }, ro);
    return r.data;
  }
}

export class Funding extends Resource {
  /** Credits a player account from the bank's issuance account. Needs the funding:create scope. */
  async create(params: T.FundingParams, ro?: RequestOptions): Promise<T.FundingResult> {
    checkAmount(params, true);
    return this.t.request<T.FundingResult>({ method: "POST", path: "/v1/funding", body: params, idempotent: true }, ro);
  }
}

export class Transfers extends Resource {
  /** Moves money between two customer accounts in the same bank, atomically. */
  async create(params: T.TransferParams, ro?: RequestOptions): Promise<T.TransferResult> {
    checkAmount(params, true);
    return this.t.request<T.TransferResult>({ method: "POST", path: "/v1/transfers", body: params, idempotent: true }, ro);
  }
}

export class Holds extends Resource {
  /** Reserves funds: available balance drops, posted balance does not. */
  async place(params: T.PlaceHoldParams, ro?: RequestOptions): Promise<T.HoldResult> {
    checkAmount(params, true);
    return this.t.request<T.HoldResult>({ method: "POST", path: "/v1/holds", body: params, idempotent: true }, ro);
  }
  get(holdId: string, ro?: RequestOptions) {
    return this.t.request<T.Hold>({ method: "GET", path: `/v1/holds/${enc(holdId)}` }, ro);
  }
  /** Posts all or part of a hold as a transfer and releases the rest. */
  async capture(holdId: string, params: T.CaptureHoldParams = {}, ro?: RequestOptions): Promise<T.CaptureResult> {
    checkAmount(params, false);
    return this.t.request<T.CaptureResult>({ method: "POST", path: `/v1/holds/${enc(holdId)}/capture`, body: params, idempotent: true }, ro);
  }
  /** Cancels a hold and restores the available balance. */
  release(holdId: string, params: { reason?: string } = {}, ro?: RequestOptions) {
    return this.t.request<T.HoldResult>({ method: "POST", path: `/v1/holds/${enc(holdId)}/release`, body: params, idempotent: true }, ro);
  }
}

export class Transactions extends Resource {
  get(transactionId: string, ro?: RequestOptions) {
    return this.t.request<T.Transaction>({ method: "GET", path: `/v1/transactions/${enc(transactionId)}` }, ro);
  }
  /** Posts a compensating transaction. Needs the transaction:reverse scope. */
  reverse(transactionId: string, params: T.ReverseParams, ro?: RequestOptions) {
    return this.t.request<T.Transaction>({ method: "POST", path: `/v1/transactions/${enc(transactionId)}/reverse`, body: params, idempotent: true }, ro);
  }
}

export class Banks extends Resource {
  /** Creates a bank with its own system ledger accounts. */
  create(params: T.CreateBankParams, ro?: RequestOptions) {
    return this.t.request<T.Bank>({ method: "POST", path: "/v1/banks", body: params }, ro);
  }
  async list(ro?: RequestOptions): Promise<T.Bank[]> {
    return (await this.t.request<{ data: T.Bank[] }>({ method: "GET", path: "/v1/banks" }, ro)).data;
  }
  get(bankId: string, ro?: RequestOptions) {
    return this.t.request<T.Bank>({ method: "GET", path: `/v1/banks/${enc(bankId)}` }, ro);
  }
  update(bankId: string, params: T.UpdateBankParams, ro?: RequestOptions) {
    return this.t.request<T.Bank>({ method: "PATCH", path: `/v1/banks/${enc(bankId)}`, body: params }, ro);
  }
  limits(bankId: string, ro?: RequestOptions) {
    return this.t.request<T.Limits>({ method: "GET", path: `/v1/banks/${enc(bankId)}/limits` }, ro);
  }
  /** Sets per-transaction and daily caps; null removes a scope's limits. Needs limits:write. */
  setLimits(bankId: string, params: T.SetLimitsParams, ro?: RequestOptions) {
    return this.t.request<T.Limits>({ method: "PUT", path: `/v1/banks/${enc(bankId)}/limits`, body: params }, ro);
  }
}

export class Currencies extends Resource {
  /** Standard ISO currencies plus this game's custom units. */
  async list(ro?: RequestOptions): Promise<T.Currency[]> {
    return (await this.t.request<{ data: T.Currency[] }>({ method: "GET", path: "/v1/currencies" }, ro)).data;
  }
  /** Defines a custom virtual unit, e.g. { code: "GOLD", name: "Gold", exponent: 0 }. */
  create(params: T.CreateCurrencyParams, ro?: RequestOptions) {
    return this.t.request<T.Currency>({ method: "POST", path: "/v1/currencies", body: params }, ro);
  }
}

export class GameClock extends Resource {
  get(ro?: RequestOptions) {
    return this.t.request<T.Clock>({ method: "GET", path: "/v1/clock" }, ro);
  }
  /** Changes mode, speed or time zone, or jumps forward. Needs limits:write. */
  configure(params: T.ConfigureClockParams, ro?: RequestOptions) {
    return this.t.request<T.Clock>({ method: "PUT", path: "/v1/clock", body: params }, ro);
  }
  /** Moves a manual clock forward and runs the jobs that became due (hold expiry, daily jobs). */
  advance(params: T.AdvanceClockParams, ro?: RequestOptions) {
    return this.t.request<T.AdvanceClockResult>({ method: "POST", path: "/v1/clock/advance", body: params }, ro);
  }
}

/**
 * Runtime client for game servers, authenticated with a game API key.
 *
 *     const gb = new GameBank({ apiKey: process.env.GBE_API_KEY, baseUrl: "https://engine.example.com" });
 *     const { transaction } = await gb.transfers.create({ source_account_id, destination_account_number, amount_minor: 1000 });
 */
export class GameBank {
  /** "sandbox" or "production", read from the API key's prefix. */
  readonly environment: T.Environment | undefined;
  readonly players: Players;
  readonly accounts: Accounts;
  readonly funding: Funding;
  readonly transfers: Transfers;
  readonly holds: Holds;
  readonly transactions: Transactions;
  readonly banks: Banks;
  readonly currencies: Currencies;
  readonly clock: GameClock;
  protected readonly transport: Transport;

  constructor(options: ClientOptions = {}, transport?: Transport) {
    this.transport = transport ?? new Transport(options);
    this.environment = this.transport.environment;
    const t = this.transport;
    this.players = new Players(t);
    this.accounts = new Accounts(t);
    this.funding = new Funding(t);
    this.transfers = new Transfers(t);
    this.holds = new Holds(t);
    this.transactions = new Transactions(t);
    this.banks = new Banks(t);
    this.currencies = new Currencies(t);
    this.clock = new GameClock(t);
  }

  /** Confirms a recipient before a transfer: returns only the account name and status. */
  nameEnquiry(bankCode: string, accountNumber: string, ro?: RequestOptions) {
    return this.transport.request<T.NameEnquiry>({ method: "GET", path: "/v1/name-enquiry", query: { bank_code: bankCode, account_number: accountNumber } }, ro);
  }

  /** Compares stored balances with the ledger for this game and environment. */
  reconcile(ro?: RequestOptions) {
    return this.transport.request<T.ReconciliationReport>({ method: "GET", path: "/v1/reconciliation" }, ro);
  }
}

class Games extends Resource {
  create(params: { name: string; slug?: string }, ro?: RequestOptions) {
    return this.t.request<T.Game>({ method: "POST", path: "/v1/games", body: params }, ro);
  }
  async list(ro?: RequestOptions): Promise<T.Game[]> {
    return (await this.t.request<{ data: T.Game[] }>({ method: "GET", path: "/v1/games" }, ro)).data;
  }
  get(gameId: string, ro?: RequestOptions) {
    return this.t.request<T.Game>({ method: "GET", path: `/v1/games/${enc(gameId)}` }, ro);
  }
  update(gameId: string, params: { status: "active" | "suspended" }, ro?: RequestOptions) {
    return this.t.request<T.Game>({ method: "PATCH", path: `/v1/games/${enc(gameId)}`, body: params }, ro);
  }
}

class ApiKeys extends Resource {
  /** Issues a game API key. The secret is in the result once; store it on your servers. */
  async issue(gameId: string, params: T.IssueApiKeyParams, ro?: RequestOptions): Promise<T.ApiKey> {
    return (await this.t.request<{ api_key: T.ApiKey }>({ method: "POST", path: `/v1/games/${enc(gameId)}/api-keys`, body: params }, ro)).api_key;
  }
  async list(gameId: string, ro?: RequestOptions): Promise<T.ApiKey[]> {
    return (await this.t.request<{ data: T.ApiKey[] }>({ method: "GET", path: `/v1/games/${enc(gameId)}/api-keys` }, ro)).data;
  }
  /** Revokes a key immediately. */
  revoke(gameId: string, keyId: string, ro?: RequestOptions) {
    return this.t.request<void>({ method: "DELETE", path: `/v1/games/${enc(gameId)}/api-keys/${enc(keyId)}` }, ro);
  }
}

class DeveloperCredentials extends Resource {
  async list(ro?: RequestOptions): Promise<T.DeveloperCredential[]> {
    return (await this.t.request<{ data: T.DeveloperCredential[] }>({ method: "GET", path: "/v1/developer/credentials" }, ro)).data;
  }
  issue(params: { label?: string; expires_at?: string } = {}, ro?: RequestOptions) {
    return this.t.request<T.DeveloperCredential>({ method: "POST", path: "/v1/developer/credentials", body: params }, ro);
  }
  revoke(credentialId: string, ro?: RequestOptions) {
    return this.t.request<void>({ method: "DELETE", path: `/v1/developer/credentials/${enc(credentialId)}` }, ro);
  }
}

/**
 * Management client for setup scripts and CI, authenticated with a developer
 * credential (gbe_dev_…) or a sign-in session token.
 */
export class GameBankManagement {
  readonly games: Games;
  readonly apiKeys: ApiKeys;
  readonly credentials: DeveloperCredentials;
  private readonly transport: Transport;

  constructor(private readonly options: ClientOptions = {}) {
    this.transport = new Transport(options);
    this.games = new Games(this.transport);
    this.apiKeys = new ApiKeys(this.transport);
    this.credentials = new DeveloperCredentials(this.transport);
  }

  /** The developer this credential belongs to. */
  me(ro?: RequestOptions) {
    return this.transport.request<T.Developer>({ method: "GET", path: "/v1/developer" }, ro);
  }

  async auditLogs(gameId: string, params: { environment?: T.Environment; limit?: number; before?: string } = {}, ro?: RequestOptions): Promise<T.AuditLog[]> {
    return (await this.transport.request<{ data: T.AuditLog[] }>({ method: "GET", path: `/v1/games/${enc(gameId)}/audit-logs`, query: params }, ro)).data;
  }

  /**
   * A GameBank client acting on one of your games with your developer
   * credential: configure banks, currencies, limits and the clock. Moving
   * money still needs a game API key.
   */
  game(gameId: string, environment: T.Environment): GameBank {
    return new GameBank(this.options, this.transport.withHeaders({ "X-Game-Id": gameId, "X-Environment": environment }, this.options));
  }
}
