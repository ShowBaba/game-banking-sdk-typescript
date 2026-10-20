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
  /** A savings or fixed-deposit account's rate, accrued interest, next payout and recent payouts. */
  interest(accountId: string, ro?: RequestOptions) {
    return this.t.request<T.AccountInterest>({ method: "GET", path: `/v1/accounts/${enc(accountId)}/interest` }, ro);
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
  /** The bank's own ledger accounts: fee income earned and levies held. */
  books(bankId: string, ro?: RequestOptions) {
    return this.t.request<T.BankBooks>({ method: "GET", path: `/v1/banks/${enc(bankId)}/books` }, ro);
  }
  /** Sets per-transaction and daily caps; null removes a scope's limits. Needs limits:write. */
  setLimits(bankId: string, params: T.SetLimitsParams, ro?: RequestOptions) {
    return this.t.request<T.Limits>({ method: "PUT", path: `/v1/banks/${enc(bankId)}/limits`, body: params }, ro);
  }
}

export class Fees extends Resource {
  /** A bank's fees and levies, active and inactive, each with its current state. */
  async list(bankId: string, ro?: RequestOptions): Promise<T.FeeRule[]> {
    return (await this.t.request<{ data: T.FeeRule[] }>({ method: "GET", path: `/v1/banks/${enc(bankId)}/fees` }, ro)).data;
  }
  get(bankId: string, feeId: string, ro?: RequestOptions) {
    return this.t.request<T.FeeRule>({ method: "GET", path: `/v1/banks/${enc(bankId)}/fees/${enc(feeId)}` }, ro);
  }
  /** Adds a fee or levy. Needs bank:write. */
  create(bankId: string, params: T.CreateFeeRuleParams, ro?: RequestOptions) {
    return this.t.request<T.FeeRule>({ method: "POST", path: `/v1/banks/${enc(bankId)}/fees`, body: params }, ro);
  }
  /** Changes, pauses ({ status: "inactive" }) or resumes a fee; bumps its version. Needs bank:write. */
  update(bankId: string, feeId: string, params: T.UpdateFeeRuleParams, ro?: RequestOptions) {
    return this.t.request<T.FeeRule>({ method: "PATCH", path: `/v1/banks/${enc(bankId)}/fees/${enc(feeId)}`, body: params }, ro);
  }
  /**
   * What a transfer or hold capture would cost now. Show it to the player, then
   * pass fees_total_minor as max_fee_minor on the payment.
   */
  async quote(params: T.QuoteFeesParams, ro?: RequestOptions): Promise<T.FeeQuote> {
    checkAmount(params, true);
    return this.t.request<T.FeeQuote>({ method: "POST", path: "/v1/fees/quote", body: params }, ro);
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

export class DepositProducts extends Resource {
  async list(bankId: string, ro?: RequestOptions): Promise<T.DepositProduct[]> {
    return (await this.t.request<{ data: T.DepositProduct[] }>({ method: "GET", path: `/v1/banks/${enc(bankId)}/deposit-products` }, ro)).data;
  }
  get(bankId: string, productId: string, ro?: RequestOptions) {
    return this.t.request<T.DepositProduct>({ method: "GET", path: `/v1/banks/${enc(bankId)}/deposit-products/${enc(productId)}` }, ro);
  }
  /** Adds a savings or fixed-deposit product. Needs bank:write; turn on the bank's "savings" flag to open accounts. */
  create(bankId: string, params: T.DepositProductParams, ro?: RequestOptions) {
    return this.t.request<T.DepositProduct>({ method: "POST", path: `/v1/banks/${enc(bankId)}/deposit-products`, body: params }, ro);
  }
  /** Changes a product (bumps its version). code and kind can't change. */
  update(bankId: string, productId: string, params: T.DepositProductParams, ro?: RequestOptions) {
    return this.t.request<T.DepositProduct>({ method: "PATCH", path: `/v1/banks/${enc(bankId)}/deposit-products/${enc(productId)}`, body: params }, ro);
  }
  /** Projects the interest an amount would earn. */
  async quote(params: T.DepositQuoteParams, ro?: RequestOptions): Promise<T.DepositQuote> {
    checkAmount(params, true);
    return this.t.request<T.DepositQuote>({ method: "POST", path: "/v1/deposit-products/quote", body: params }, ro);
  }
}

export class FixedDeposits extends Resource {
  /** Books a fixed deposit from a player's account at the term's current rate. Needs deposits:write. */
  async open(params: T.OpenFixedDepositParams, ro?: RequestOptions): Promise<T.OpenFixedDepositResult> {
    checkAmount(params, true);
    return this.t.request<T.OpenFixedDepositResult>({ method: "POST", path: "/v1/fixed-deposits", body: params, idempotent: true }, ro);
  }
  async list(params: T.ListFixedDepositsParams = {}, ro?: RequestOptions): Promise<T.FixedDeposit[]> {
    return (await this.t.request<{ data: T.FixedDeposit[] }>({ method: "GET", path: "/v1/fixed-deposits", query: { ...params } }, ro)).data;
  }
  get(depositId: string, ro?: RequestOptions) {
    return this.t.request<T.FixedDeposit>({ method: "GET", path: `/v1/fixed-deposits/${enc(depositId)}` }, ro);
  }
  /** Changes what happens at maturity. */
  update(depositId: string, params: { maturity_instruction: T.MaturityInstruction }, ro?: RequestOptions) {
    return this.t.request<T.FixedDeposit>({ method: "PATCH", path: `/v1/fixed-deposits/${enc(depositId)}`, body: params }, ro);
  }
  /** What breaking the deposit early pays now. */
  breakQuote(depositId: string, ro?: RequestOptions) {
    return this.t.request<T.BreakQuote>({ method: "GET", path: `/v1/fixed-deposits/${enc(depositId)}/break-quote` }, ro);
  }
  /** Breaks the deposit early. Pass the quote's penalty_minor as max_penalty_minor (PenaltyChangedError if it rose). */
  break(depositId: string, params: { max_penalty_minor?: number } = {}, ro?: RequestOptions) {
    return this.t.request<T.BreakFixedDepositResult>({ method: "POST", path: `/v1/fixed-deposits/${enc(depositId)}/break`, body: params, idempotent: true }, ro);
  }
}

export class Merchants extends Resource {
  /** Registers a merchant (an NPC shop or a player-run store). Repeat calls with the same external_merchant_id return it. Needs merchants:write. */
  create(params: T.CreateMerchantParams, ro?: RequestOptions) {
    return this.t.request<T.Merchant>({ method: "POST", path: "/v1/merchants", body: params, retrySafe: true }, ro);
  }
  async list(params: T.ListMerchantsParams = {}, ro?: RequestOptions): Promise<T.Merchant[]> {
    return (await this.t.request<{ data: T.Merchant[] }>({ method: "GET", path: "/v1/merchants", query: { ...params } }, ro)).data;
  }
  get(merchantId: string, ro?: RequestOptions) {
    return this.t.request<T.Merchant>({ method: "GET", path: `/v1/merchants/${enc(merchantId)}` }, ro);
  }
  /** Renames, recategorises, suspends or reactivates a merchant. */
  update(merchantId: string, params: T.UpdateMerchantParams, ro?: RequestOptions) {
    return this.t.request<T.Merchant>({ method: "PATCH", path: `/v1/merchants/${enc(merchantId)}`, body: params }, ro);
  }
}

export class CardPrograms extends Resource {
  async list(bankId: string, ro?: RequestOptions): Promise<T.CardProgram[]> {
    return (await this.t.request<{ data: T.CardProgram[] }>({ method: "GET", path: `/v1/banks/${enc(bankId)}/card-programs` }, ro)).data;
  }
  get(bankId: string, programId: string, ro?: RequestOptions) {
    return this.t.request<T.CardProgram>({ method: "GET", path: `/v1/banks/${enc(bankId)}/card-programs/${enc(programId)}` }, ro);
  }
  /** Adds a card program. Turn on the bank's "cards" feature flag to issue cards. Needs bank:write. */
  create(bankId: string, params: T.CardProgramParams, ro?: RequestOptions) {
    return this.t.request<T.CardProgram>({ method: "POST", path: `/v1/banks/${enc(bankId)}/card-programs`, body: params }, ro);
  }
  update(bankId: string, programId: string, params: T.CardProgramParams, ro?: RequestOptions) {
    return this.t.request<T.CardProgram>({ method: "PATCH", path: `/v1/banks/${enc(bankId)}/card-programs/${enc(programId)}`, body: params }, ro);
  }
}

export class Cards extends Resource {
  /**
   * Issues a debit card on a player account, charging any card_issuance fee.
   * The result's card_number and cvv are shown only now. Needs cards:write.
   */
  issue(params: T.IssueCardParams, ro?: RequestOptions) {
    return this.t.request<T.IssueCardResult>({ method: "POST", path: "/v1/cards", body: params, idempotent: true }, ro);
  }
  async list(params: T.ListCardsParams = {}, ro?: RequestOptions): Promise<T.Card[]> {
    return (await this.t.request<{ data: T.Card[] }>({ method: "GET", path: "/v1/cards", query: { ...params } }, ro)).data;
  }
  get(cardId: string, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "GET", path: `/v1/cards/${enc(cardId)}` }, ro);
  }
  /** Changes the name on the card or its own limits. */
  update(cardId: string, params: T.UpdateCardParams, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "PATCH", path: `/v1/cards/${enc(cardId)}`, body: params }, ro);
  }
  /** Pauses the card: new payments are declined (card_blocked). */
  block(cardId: string, params: { reason?: string } = {}, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "POST", path: `/v1/cards/${enc(cardId)}/block`, body: params }, ro);
  }
  unblock(cardId: string, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "POST", path: `/v1/cards/${enc(cardId)}/unblock` }, ro);
  }
  /** Reports the card lost or stolen: final, and no replacement is issued. Approved payments still capture. */
  reportLost(cardId: string, params: { reason?: "lost" | "stolen" } = {}, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "POST", path: `/v1/cards/${enc(cardId)}/report-lost`, body: params }, ro);
  }
  close(cardId: string, params: { reason?: string } = {}, ro?: RequestOptions) {
    return this.t.request<T.Card>({ method: "POST", path: `/v1/cards/${enc(cardId)}/close`, body: params }, ro);
  }
}

export class CardAuthorizations extends Resource {
  /**
   * Authorises a card payment at a merchant. A decline is not an error: check
   * result.authorization.status ("declined") and decline_code. Needs cards:charge.
   */
  async authorize(params: T.AuthorizeCardParams, ro?: RequestOptions): Promise<T.AuthorizeCardResult> {
    checkAmount(params, true);
    return this.t.request<T.AuthorizeCardResult>({ method: "POST", path: "/v1/card-authorizations", body: params, idempotent: true }, ro);
  }
  async list(params: T.ListCardAuthorizationsParams = {}, ro?: RequestOptions): Promise<T.CardAuthorization[]> {
    return (await this.t.request<{ data: T.CardAuthorization[] }>({ method: "GET", path: "/v1/card-authorizations", query: { ...params } }, ro)).data;
  }
  get(authorizationId: string, ro?: RequestOptions) {
    return this.t.request<T.CardAuthorization>({ method: "GET", path: `/v1/card-authorizations/${enc(authorizationId)}` }, ro);
  }
  /** Settles all or part of an approved payment into the merchant account; the rest is released. */
  async capture(authorizationId: string, params: T.CaptureCardParams = {}, ro?: RequestOptions): Promise<T.CaptureCardResult> {
    checkAmount(params, false);
    return this.t.request<T.CaptureCardResult>({ method: "POST", path: `/v1/card-authorizations/${enc(authorizationId)}/capture`, body: params, idempotent: true }, ro);
  }
  /** Cancels an approved payment and frees its funds. */
  release(authorizationId: string, params: { reason?: string } = {}, ro?: RequestOptions) {
    return this.t.request<{ authorization: T.CardAuthorization; balance: T.Balance }>(
      { method: "POST", path: `/v1/card-authorizations/${enc(authorizationId)}/release`, body: params, idempotent: true }, ro);
  }
  /** Refunds all or part of a captured payment from the merchant account. Fees are not refunded. */
  async refund(authorizationId: string, params: T.RefundCardParams = {}, ro?: RequestOptions): Promise<T.RefundCardResult> {
    checkAmount(params, false);
    return this.t.request<T.RefundCardResult>({ method: "POST", path: `/v1/card-authorizations/${enc(authorizationId)}/refunds`, body: params, idempotent: true }, ro);
  }
}

export class WebhookEndpoints extends Resource {
  /**
   * Registers an endpoint. The result's `secret` is shown only now: store it
   * and pass it to verifyWebhook. Needs webhooks:write.
   */
  create(params: T.CreateWebhookEndpointParams, ro?: RequestOptions) {
    return this.t.request<T.WebhookEndpoint>({ method: "POST", path: "/v1/webhooks/endpoints", body: params }, ro);
  }
  async list(ro?: RequestOptions): Promise<T.WebhookEndpoint[]> {
    return (await this.t.request<{ data: T.WebhookEndpoint[] }>({ method: "GET", path: "/v1/webhooks/endpoints" }, ro)).data;
  }
  get(endpointId: string, ro?: RequestOptions) {
    return this.t.request<T.WebhookEndpoint>({ method: "GET", path: `/v1/webhooks/endpoints/${enc(endpointId)}` }, ro);
  }
  /** Changes the URL, description or event types, or pauses ({ status: "disabled" }) and re-enables it. */
  update(endpointId: string, params: T.UpdateWebhookEndpointParams, ro?: RequestOptions) {
    return this.t.request<T.WebhookEndpoint>({ method: "PATCH", path: `/v1/webhooks/endpoints/${enc(endpointId)}`, body: params }, ro);
  }
  delete(endpointId: string, ro?: RequestOptions) {
    return this.t.request<void>({ method: "DELETE", path: `/v1/webhooks/endpoints/${enc(endpointId)}` }, ro);
  }
  /** Issues a new secret (in the result). The old one keeps signing for 24 hours. */
  rotateSecret(endpointId: string, ro?: RequestOptions) {
    return this.t.request<T.WebhookEndpoint>({ method: "POST", path: `/v1/webhooks/endpoints/${enc(endpointId)}/rotate-secret` }, ro);
  }
  /** Sends a webhook.test event now and returns how that attempt went. */
  test(endpointId: string, ro?: RequestOptions) {
    return this.t.request<T.WebhookDelivery>({ method: "POST", path: `/v1/webhooks/endpoints/${enc(endpointId)}/test` }, ro);
  }
}

export class WebhookEvents extends Resource {
  /** One page of the event log, newest first (kept 30 days). Also a polling feed. */
  list(params: T.ListWebhookEventsParams = {}, ro?: RequestOptions) {
    return this.t.request<T.Page<T.WebhookEvent>>({ method: "GET", path: "/v1/webhooks/events", query: { ...params } }, ro);
  }
  /** Every event matching the filter, newest first, fetching pages as needed. */
  async *iterate(params: Omit<T.ListWebhookEventsParams, "cursor"> = {}, ro?: RequestOptions): AsyncGenerator<T.WebhookEvent> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, ...(cursor ? { cursor } : {}) }, ro);
      yield* page.data;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  get(eventId: string, ro?: RequestOptions) {
    return this.t.request<T.WebhookEvent>({ method: "GET", path: `/v1/webhooks/events/${enc(eventId)}` }, ro);
  }
  /** The event's deliveries, one per endpoint, with attempts and the last error. */
  async deliveries(eventId: string, ro?: RequestOptions): Promise<T.WebhookDelivery[]> {
    return (await this.t.request<{ data: T.WebhookDelivery[] }>({ method: "GET", path: `/v1/webhooks/events/${enc(eventId)}/deliveries` }, ro)).data;
  }
  /** Sends the event again, to one endpoint or every subscribed one. Retries start over. */
  async redeliver(eventId: string, params: { endpoint_id?: string } = {}, ro?: RequestOptions): Promise<T.WebhookDelivery[]> {
    return (await this.t.request<{ data: T.WebhookDelivery[] }>({ method: "POST", path: `/v1/webhooks/events/${enc(eventId)}/redeliver`, body: params }, ro)).data;
  }
}

/** Signed event notifications (debit and credit alerts). Verify deliveries with verifyWebhook. */
export class Webhooks {
  readonly endpoints: WebhookEndpoints;
  readonly events: WebhookEvents;
  constructor(t: Transport) {
    this.endpoints = new WebhookEndpoints(t);
    this.events = new WebhookEvents(t);
  }
}

/**
 * Runtime client for game servers, authenticated with a game API key.
 *
 *     const gb = new GameBank({ apiKey: process.env.GBE_API_KEY });
 *     const { transaction } = await gb.transfers.create({ source_account_id, destination_account_number, amount_minor: 1000 });
 */
export class GameBank {
  /** "sandbox" or "production", read from the API key's prefix. */
  readonly environment: T.Environment | undefined;
  /** The engine this client talks to. */
  readonly baseUrl: string;
  readonly players: Players;
  readonly accounts: Accounts;
  readonly funding: Funding;
  readonly transfers: Transfers;
  readonly holds: Holds;
  readonly transactions: Transactions;
  readonly banks: Banks;
  readonly fees: Fees;
  readonly currencies: Currencies;
  readonly clock: GameClock;
  readonly webhooks: Webhooks;
  readonly merchants: Merchants;
  readonly cardPrograms: CardPrograms;
  readonly cards: Cards;
  readonly cardAuthorizations: CardAuthorizations;
  readonly depositProducts: DepositProducts;
  readonly fixedDeposits: FixedDeposits;
  protected readonly transport: Transport;

  constructor(options: ClientOptions = {}, transport?: Transport) {
    this.transport = transport ?? new Transport(options);
    this.environment = this.transport.environment;
    this.baseUrl = this.transport.baseUrl;
    const t = this.transport;
    this.players = new Players(t);
    this.accounts = new Accounts(t);
    this.funding = new Funding(t);
    this.transfers = new Transfers(t);
    this.holds = new Holds(t);
    this.transactions = new Transactions(t);
    this.banks = new Banks(t);
    this.fees = new Fees(t);
    this.currencies = new Currencies(t);
    this.clock = new GameClock(t);
    this.webhooks = new Webhooks(t);
    this.merchants = new Merchants(t);
    this.cardPrograms = new CardPrograms(t);
    this.cards = new Cards(t);
    this.cardAuthorizations = new CardAuthorizations(t);
    this.depositProducts = new DepositProducts(t);
    this.fixedDeposits = new FixedDeposits(t);
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
  /** Renames a game, changes its slug, or suspends/reactivates it. */
  update(gameId: string, params: T.UpdateGameParams, ro?: RequestOptions) {
    return this.t.request<T.Game>({ method: "PATCH", path: `/v1/games/${enc(gameId)}`, body: params }, ro);
  }
  /**
   * Deletes a game permanently: every API key is revoked at once and the game
   * leaves the developer API. Ledger and audit history are kept.
   */
  delete(gameId: string, ro?: RequestOptions) {
    return this.t.request<void>({ method: "DELETE", path: `/v1/games/${enc(gameId)}` }, ro);
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
