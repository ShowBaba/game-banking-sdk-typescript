// Request and response shapes. Field names match the API's JSON (snake_case).
// Amounts are integers in minor units; timestamps are RFC 3339 strings.

export type Environment = "sandbox" | "production";
export type Metadata = Record<string, unknown>;

export interface CurrencyBrief {
  code: string;
  exponent: number;
  symbol: string | null;
}

export interface Currency extends CurrencyBrief {
  id: string;
  name: string;
  standard: boolean;
  status: string;
}

export interface Account {
  id: string;
  bank_id: string;
  bank_code: string;
  owner_type: "player" | "system" | "merchant";
  player_id: string | null;
  /** Set on merchant accounts. */
  merchant_id: string | null;
  /** The deposit product of a savings or fixed-deposit account. */
  product_id: string | null;
  /** Receives the account's interest; null pays the account itself. */
  interest_account_id: string | null;
  system_role: string | null;
  account_type: string;
  account_number: string;
  account_name: string;
  currency: CurrencyBrief;
  status: "active" | "frozen" | "closed";
  allow_negative_balance: boolean;
  posted_balance: number;
  available_balance: number;
  held_balance: number;
  version: number;
  metadata: Metadata;
  created_at: string;
  updated_at: string;
}

export interface Bank {
  id: string;
  environment: Environment;
  name: string;
  slug: string;
  bank_code: string;
  base_currency: Currency;
  branding: Metadata;
  feature_flags: Record<string, boolean>;
  config_version: number;
  status: string;
  created_at: string;
  updated_at: string;
  /** Included when a bank is created or fetched by ID. */
  system_accounts?: Account[];
}

export interface Balance {
  account_id: string;
  account_number: string;
  currency: CurrencyBrief;
  posted_balance: number;
  available_balance: number;
  held_balance: number;
  posted_display: string;
  available_display: string;
  version: number;
  as_of: string;
  as_of_game_time?: string;
}

export interface Player {
  id: string;
  external_player_id: string;
  display_name: string | null;
  status: string;
  metadata: Metadata;
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: string;
  account_id: string;
  account_number: string;
  account_name: string;
  side: "debit" | "credit";
  amount_minor: number;
  balance_after: number;
  /** principal, or a fee or levy charged with the payment. */
  kind: EntryKind;
  /** On fee and levy lines: the fee rule that charged it, and its name. */
  fee_rule_id?: string;
  description?: string;
}

export type EntryKind = "principal" | "fee" | "levy";

export interface Transaction {
  id: string;
  session_id: string;
  type: string;
  status: "pending" | "posted" | "failed" | "reversed";
  bank_id: string;
  currency: CurrencyBrief;
  amount_minor: number;
  amount_display: string;
  reference: string | null;
  narration: string | null;
  initiated_by: { type: string; id: string };
  related_transaction_id: string | null;
  reversed_by_transaction_id?: string;
  metadata: Metadata;
  created_at: string;
  posted_at: string | null;
  game_time: string;
  entries: Entry[];
}

export interface HistoryItem {
  entry_id: string;
  transaction_id: string;
  session_id: string;
  type: string;
  status: string;
  /** "debit" or "credit" from the account holder's point of view. */
  direction: "debit" | "credit";
  amount_minor: number;
  amount_display: string;
  balance_after: number;
  /** principal, fee or levy. A fee or levy line's narration is the fee's name. */
  kind: EntryKind;
  narration: string | null;
  reference: string | null;
  counterparty: { account_id: string; account_number: string; account_name: string; bank_code: string } | null;
  real_time: string;
  game_time: string;
  related_transaction_id: string | null;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface Hold {
  id: string;
  bank_id: string;
  account_id: string;
  destination_account_id: string | null;
  amount_minor: number;
  /** Held on top of the amount for the capture's expected fees. */
  reserved_fee_minor: number;
  captured_amount_minor: number | null;
  status: "active" | "captured" | "released" | "expired";
  reason: string;
  reference: string | null;
  expires_at_game: string;
  capture_transaction_id: string | null;
  created_at: string;
  created_game_time: string;
  closed_at: string | null;
  closed_game_time: string | null;
}

export interface NameEnquiry {
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  status: string;
}

export interface Clock {
  mode: "real_time" | "scaled" | "manual";
  speed: number;
  time_zone: string;
  game_time: string;
  game_day: string;
  real_time: string;
}

export interface LimitPolicy {
  per_transaction_max?: number | null;
  daily_max?: number | null;
}

export type LimitScope = "player_funding" | "game_funding" | "account_transfer";

export interface Limits {
  bank_id: string;
  currency: string;
  limits: Record<LimitScope, LimitPolicy | null>;
  game_day: string;
  game_funding_used_today: number;
  note: string;
}

export interface ReconciliationReport {
  started_at: string;
  finished_at: string;
  accounts_checked: number;
  transactions_checked: number;
  differences: Array<Record<string, unknown>>;
  ok: boolean;
}

// ---- results of money movement ----

export interface FundingResult {
  transaction: Transaction;
  balance: Balance;
}
export interface TransferResult {
  transaction: Transaction;
  source_balance: Balance;
  destination_balance?: Balance;
  /** Fees and levies charged to the sender on top of the amount. */
  fees: FeeCharge[];
  fees_total_minor: number;
  /** Amount plus fees. */
  total_debit_minor: number;
}
export interface HoldResult {
  hold: Hold;
  balance: Balance;
}
export interface CaptureResult {
  hold: Hold;
  transaction: Transaction;
  source_balance: Balance;
  destination_balance?: Balance;
  fees: FeeCharge[];
  fees_total_minor: number;
  total_debit_minor: number;
}
export interface AdvanceClockResult {
  clock: Clock;
  previous_game_time: string;
  jobs: { game_day: string; holds_expired: number; jobs_run: string[] };
}

// ---- request parameters ----

export interface UpsertPlayerParams {
  external_player_id: string;
  display_name?: string;
  metadata?: Metadata;
}
export interface OpenAccountParams {
  bank_id: string;
  /** For a player account. */
  player_id?: string;
  /** For a merchant account, which receives card payments. */
  merchant_id?: string;
  /** A savings product: the account earns interest and follows its rules (account_type becomes savings). */
  product_id?: string;
  /** Pay interest into another of the player's accounts. */
  interest_account_id?: string;
  account_type?: "current" | "savings";
  account_name?: string;
  currency?: string;
  metadata?: Metadata;
}
export interface ListAccountsParams {
  bank_id?: string;
  player_id?: string;
  merchant_id?: string;
  include_system?: boolean;
  limit?: number;
}
export interface UpdateAccountStatusParams {
  status: "active" | "frozen" | "closed";
  reason?: string;
}
export interface FundingParams {
  account_id: string;
  amount_minor: number;
  reason: string;
  /** Your own unique ID for this issuance. */
  reference: string;
  currency?: string;
  source_account_id?: string;
  narration?: string;
  metadata?: Metadata;
}
export interface TransferParams {
  source_account_id: string;
  amount_minor: number;
  destination_account_id?: string;
  destination_account_number?: string;
  destination_bank_code?: string;
  bank_id?: string;
  currency?: string;
  reference?: string;
  narration?: string;
  metadata?: Metadata;
  /**
   * Refuse with FeeChangedError if the fees now total more than this, e.g. the
   * fees_total_minor of a quote the player accepted.
   */
  max_fee_minor?: number;
}
export interface PlaceHoldParams {
  account_id: string;
  amount_minor: number;
  reason: string;
  reference?: string;
  destination_account_id?: string;
  destination_account_number?: string;
  expires_at_game?: string;
  expires_in_game_seconds?: number;
  /** Caps the capture fee reserved now (FeeChangedError if higher). */
  max_fee_minor?: number;
}
export interface CaptureHoldParams {
  /** Omit to capture the whole hold. */
  amount_minor?: number;
  destination_account_id?: string;
  destination_account_number?: string;
  narration?: string;
  reference?: string;
  metadata?: Metadata;
  /** Refuse with FeeChangedError if the capture's fees now total more than this. */
  max_fee_minor?: number;
}
export interface ReverseParams {
  reason: string;
  narration?: string;
}
export interface CreateBankParams {
  name: string;
  base_currency: string;
  slug?: string;
  bank_code?: string;
  branding?: Metadata;
  feature_flags?: Record<string, boolean>;
}
export interface UpdateBankParams {
  name?: string;
  branding?: Metadata;
  feature_flags?: Record<string, boolean>;
  status?: "active" | "suspended";
}
export type SetLimitsParams = Partial<Record<LimitScope, LimitPolicy | null>>;
export interface CreateCurrencyParams {
  code: string;
  name: string;
  exponent: number;
  symbol?: string;
}
export interface ConfigureClockParams {
  mode?: "real_time" | "scaled" | "manual";
  speed?: number;
  time_zone?: string;
  /** Jump forward to this game time (RFC 3339). */
  game_time?: string;
}
export interface AdvanceClockParams {
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
  /** Advance to this game time (RFC 3339) instead of by a duration. */
  to?: string;
}

// ---- fees and charges ----

export type FeeEvent = "transfer" | "hold_capture" | "account_maintenance" | "card_issuance" | "card_payment" | "savings_excess_withdrawal";
export type FeeKind = "fee" | "levy";
export type FeeModel = "fixed" | "percentage" | "combined";
export type FeeRuleState = "in_effect" | "scheduled" | "ended" | "inactive";

/** A fee or levy a bank charges. Amounts are minor units; times are game time. */
export interface FeeRule {
  id: string;
  bank_id: string;
  /** Stable identifier, e.g. "player_transfer_fee". Cannot change. */
  code: string;
  /** Shown on statements. */
  name: string;
  event: FeeEvent;
  /** A fee credits the bank's fee_income; a levy credits levies_payable. */
  kind: FeeKind;
  model: FeeModel;
  fixed_minor: number;
  /** Basis points: 100 = 1%. */
  percentage_bps: number;
  min_fee_minor: number | null;
  max_fee_minor: number | null;
  /** Applies only from this amount, inclusive (the account balance, for maintenance). */
  min_amount_minor: number | null;
  max_amount_minor: number | null;
  payer: "sender";
  credit_account: "fee_income" | "levies_payable";
  status: "active" | "inactive";
  effective_from: string;
  /** Exclusive. */
  effective_to: string | null;
  version: number;
  /** Where the rule stands at the current game time. Only in_effect rules charge. */
  state: FeeRuleState;
  /** Settings that are valid but can never take effect. */
  warnings: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateFeeRuleParams {
  code: string;
  name: string;
  event: FeeEvent;
  model: FeeModel;
  kind?: FeeKind;
  fixed_minor?: number;
  percentage_bps?: number;
  min_fee_minor?: number;
  max_fee_minor?: number;
  min_amount_minor?: number;
  max_amount_minor?: number;
  status?: "active" | "inactive";
  /** Game time; defaults to now. */
  effective_from?: string;
  effective_to?: string;
  /** Start at the current game time. Do not combine with effective_from. */
  start_now?: boolean;
}

/** Send only what changes. code and event cannot change. */
export interface UpdateFeeRuleParams extends Partial<Omit<CreateFeeRuleParams, "code" | "event">> {
  /** Fields to reset to "no limit", e.g. ["max_fee_minor", "effective_to"]. */
  clear?: Array<"min_fee_minor" | "max_fee_minor" | "min_amount_minor" | "max_amount_minor" | "effective_to">;
}

/** One fee or levy charged on a payment. */
export interface FeeCharge {
  fee_rule_id: string;
  fee_rule_version: number;
  code: string;
  name: string;
  kind: FeeKind;
  amount_minor: number;
  credit_account: "fee_income" | "levies_payable";
}

export interface QuoteFeesParams {
  bank_id: string;
  amount_minor: number;
  /** Defaults to transfer. */
  event?: "transfer" | "hold_capture" | "card_payment";
}

export interface FeeQuote {
  bank_id: string;
  event: "transfer" | "hold_capture";
  amount_minor: number;
  fees: FeeCharge[];
  fees_total_minor: number;
  total_debit_minor: number;
  game_time: string;
}

/** The bank's own ledger accounts, from which its profit and loss derives. */
export interface BankBooks {
  /** Interest paid to savers (negative). */
  interest_expense_minor: number;
  /** Interest earned by savers, not yet paid. */
  accrued_interest_minor: number;
  /** Money in active fixed deposits. */
  fixed_deposits_minor: number;
  bank_id: string;
  currency: string;
  /** Fees the bank has earned. */
  fee_income_minor: number;
  /** Levies collected and held for others. */
  levies_payable_minor: number;
  accounts: Array<{ system_role: string; account_name: string; account_number: string; balance_minor: number; balance_display: string }>;
  as_of: string;
}

// ---- management (developer credential) ----

export interface Developer {
  id: string;
  name: string;
  contact_email: string;
  status: string;
  has_password: boolean;
  created_at: string;
  updated_at: string;
}
export interface Game {
  id: string;
  developer_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface ApiKey {
  id: string;
  game_id: string;
  environment: Environment;
  label: string;
  prefix: string;
  /** Present only in the response that created the key. Store it then. */
  secret?: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface DeveloperCredential {
  id: string;
  label: string;
  prefix: string;
  /** Present only in the response that created the credential. */
  secret?: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface AuditLog {
  id: string;
  developer_id: string | null;
  game_id: string | null;
  environment: Environment | null;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  correlation_id: string | null;
  metadata: Metadata;
  created_at: string;
}
export type Scope =
  | "bank:read" | "bank:write" | "account:read" | "account:write"
  | "transfer:create" | "funding:create" | "transaction:reverse" | "limits:write"
  | "webhooks:read" | "webhooks:write"
  | "merchants:write" | "cards:read" | "cards:write" | "cards:charge" | "deposits:write";
export interface UpdateGameParams {
  name?: string;
  slug?: string;
  status?: "active" | "suspended";
}
export interface IssueApiKeyParams {
  environment: Environment;
  label?: string;
  /** Defaults to bank:read, account:read, account:write, transfer:create. */
  scopes?: Scope[];
  expires_at?: string;
}

// ---- Webhooks -------------------------------------------------------------------

/** Event types an endpoint can subscribe to. */
export type WebhookEventType =
  | "account.debited" | "account.credited"
  | "card.issued" | "card.blocked" | "card.unblocked" | "card.reported_lost" | "card.closed" | "card.expired"
  | "card.authorization.approved" | "card.authorization.declined" | "card.authorization.captured"
  | "card.authorization.released" | "card.authorization.expired" | "card.refunded"
  | "interest.paid" | "interest.forfeited" | "savings.withdrawal_limit_exceeded"
  | "fixed_deposit.opened" | "fixed_deposit.matured" | "fixed_deposit.rolled_over" | "fixed_deposit.broken";

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  /** ["*"] means every type. */
  event_types: (WebhookEventType | "*")[];
  /** The engine disables an endpoint after three days of failed deliveries. */
  status: "active" | "disabled";
  disabled_reason: string | null;
  /** The first characters of the signing secret, to tell secrets apart. */
  secret_prefix: string;
  /** The signing secret: only when the endpoint is created or its secret rotated. */
  secret?: string;
  /** Until then deliveries are also signed with the previous secret. */
  previous_secret_expires_at: string | null;
  failing_since: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface CreateWebhookEndpointParams {
  /** https (the sandbox also accepts http). Private and loopback addresses are refused. */
  url: string;
  description?: string;
  /** Defaults to ["*"]. */
  event_types?: (WebhookEventType | "*")[];
}
export interface UpdateWebhookEndpointParams {
  url?: string;
  description?: string;
  event_types?: (WebhookEventType | "*")[];
  /** "active" re-enables an endpoint; "disabled" pauses it. */
  status?: "active" | "disabled";
}

/** A fee or levy line on an alert: charged on a debit, refunded on a credit. */
export interface AlertCharge {
  kind: "fee" | "levy";
  name: string;
  fee_rule_id: string | null;
  amount_minor: number;
}

/** The data of an account.debited or account.credited event. */
export interface AccountAlert {
  account_id: string;
  account_number: string;
  account_name: string;
  player_id: string | null;
  bank_id: string;
  bank_code: string;
  transaction_id: string;
  session_id: string;
  /** funding, transfer, fee, reversal… */
  transaction_type: string;
  related_transaction_id: string | null;
  /** The principal (0 for a fee-only transaction). */
  amount_minor: number;
  charges: AlertCharge[];
  /** Principal plus charges: what left (or reached) the account. */
  total_minor: number;
  total_display: string;
  currency: { code: string; exponent: number; symbol: string | null };
  balance_after: { posted_minor: number; available_minor: number };
  narration: string | null;
  reference: string | null;
  /** The other side; customer account numbers are masked to the last four digits. */
  counterparty: { type: "customer" | "bank"; account_name: string; account_number: string; bank_code: string } | null;
  game_time: string;
  /** Increases with every ledger entry: keep the alert with the highest sequence for the latest balance. */
  sequence: number;
}

interface WebhookEventBase {
  /** Deduplicate on this: delivery is at least once. */
  id: string;
  created_at: string;
  game_time: string | null;
  game_id: string;
  environment: Environment;
}
/** The body of a webhook delivery, and an item of the events feed. */
export type WebhookEvent =
  | (WebhookEventBase & { type: "account.debited" | "account.credited"; data: AccountAlert })
  | (WebhookEventBase & { type: "webhook.test"; data: { endpoint_id: string; message: string } })
  | (WebhookEventBase & { type: "card.issued" | "card.blocked" | "card.unblocked" | "card.reported_lost" | "card.closed" | "card.expired"; data: Card })
  | (WebhookEventBase & {
      type: "card.authorization.approved" | "card.authorization.declined" | "card.authorization.captured" | "card.authorization.released";
      data: CardAuthorization;
    })
  | (WebhookEventBase & { type: "card.authorization.expired"; data: { authorization_id: string; card_id: string; account_id: string; amount_minor: number; status: "expired" } })
  | (WebhookEventBase & { type: "card.refunded"; data: { refund: CardRefund; authorization: CardAuthorization } })
  | (WebhookEventBase & {
      type: "interest.paid";
      data: { account_id: string; paid_to_account_id: string; period: string; gross_minor: number; tax_minor: number; net_minor: number; transaction_id: string };
    })
  | (WebhookEventBase & { type: "interest.forfeited"; data: { account_id: string; period: string; forfeited_minor: number } })
  | (WebhookEventBase & {
      type: "savings.withdrawal_limit_exceeded";
      data: { account_id: string; month: string; withdrawals: number; allowed: number; action: "block" | "forfeit_interest" | "fee" };
    })
  | (WebhookEventBase & { type: "fixed_deposit.opened" | "fixed_deposit.matured" | "fixed_deposit.rolled_over"; data: FixedDeposit })
  | (WebhookEventBase & { type: "fixed_deposit.broken"; data: { fixed_deposit: FixedDeposit; quote: BreakQuote } });

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  endpoint_url: string;
  state: "pending" | "delivering" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  /** The endpoint's HTTP status on the last attempt. */
  last_status: number | null;
  last_error: string | null;
  last_response_ms: number | null;
  delivered_at: string | null;
  created_at: string;
}
export interface ListWebhookEventsParams {
  type?: WebhookEventType | "webhook.test";
  account_id?: string;
  limit?: number;
  cursor?: string;
}

// ---- Merchants and cards ---------------------------------------------------------

export interface Merchant {
  id: string;
  external_merchant_id: string;
  name: string;
  category: string;
  /** The player who runs the shop, if any. */
  owner_player_id: string | null;
  status: "active" | "suspended";
  metadata: Metadata;
  created_at: string;
  updated_at: string;
}
export interface CreateMerchantParams {
  /** Your own ID for the merchant; creating it again returns the existing one. */
  external_merchant_id: string;
  name: string;
  /** e.g. "food", "weapons"; default "general". */
  category?: string;
  owner_player_id?: string;
  metadata?: Metadata;
}
export interface UpdateMerchantParams {
  name?: string;
  category?: string;
  /** A suspended merchant's card payments are declined. */
  status?: "active" | "suspended";
  metadata?: Metadata;
}
export interface ListMerchantsParams {
  status?: "active" | "suspended";
  owner_player_id?: string;
  external_merchant_id?: string;
  limit?: number;
}

export interface CardProgram {
  id: string;
  bank_id: string;
  name: string;
  bin: string;
  validity_months: number;
  /** How long an authorisation holds funds, in game seconds. */
  auth_expiry_seconds: number;
  per_txn_limit_minor: number | null;
  daily_limit_minor: number | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}
export interface CardProgramParams {
  /** Required when creating. */
  name?: string;
  /** Create only: 6 digits, unique in the game. Chosen for you when omitted. */
  bin?: string;
  validity_months?: number;
  auth_expiry_seconds?: number;
  per_txn_limit_minor?: number;
  daily_limit_minor?: number;
  status?: "active" | "inactive";
  clear?: ("per_txn_limit_minor" | "daily_limit_minor")[];
}

export type CardStatus = "active" | "blocked" | "lost" | "stolen" | "expired" | "closed";

export interface Card {
  id: string;
  bank_id: string;
  account_id: string;
  player_id: string;
  program_id: string;
  /** e.g. "505812******4242". */
  masked_number: string;
  last4: string;
  expiry_month: number;
  /** Valid through the end of expiry_month of game time. */
  expiry_year: number;
  name_on_card: string;
  status: CardStatus;
  status_reason: string | null;
  /** The card's own limits; null uses the program's. */
  per_txn_limit_minor: number | null;
  daily_limit_minor: number | null;
  effective_per_txn_limit_minor: number | null;
  effective_daily_limit_minor: number | null;
  metadata: Metadata;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}
export interface IssueCardParams {
  /** A player account. */
  account_id: string;
  program_id?: string;
  name_on_card?: string;
  per_txn_limit_minor?: number;
  daily_limit_minor?: number;
  /** Refuse (FeeChangedError) if the issuance fee is higher. */
  max_fee_minor?: number;
  metadata?: Metadata;
}
/** card_number and cvv are shown only here. */
export interface IssueCardResult {
  card: Card;
  card_number: string;
  cvv: string;
  fees: FeeCharge[];
  fees_total_minor: number;
  balance: Balance;
}
export interface UpdateCardParams {
  name_on_card?: string;
  per_txn_limit_minor?: number;
  daily_limit_minor?: number;
  /** Go back to the program's limit. */
  clear?: ("per_txn_limit_minor" | "daily_limit_minor")[];
  metadata?: Metadata;
}
export interface ListCardsParams {
  account_id?: string;
  player_id?: string;
  status?: CardStatus;
  limit?: number;
}

export type DeclineCode =
  | "invalid_expiry" | "invalid_cvv" | "card_blocked" | "card_lost" | "card_stolen" | "card_expired" | "card_closed"
  | "account_frozen" | "account_closed" | "merchant_inactive" | "exceeds_transaction_limit" | "exceeds_daily_limit"
  | "insufficient_funds";

export interface CardRefund {
  id: string;
  transaction_id: string;
  amount_minor: number;
  reason: string | null;
  game_time: string;
  created_at: string;
}

export interface CardAuthorization {
  id: string;
  card_id: string;
  card_last4: string;
  bank_id: string;
  account_id: string;
  merchant: { id: string; name: string; category: string };
  merchant_account_id: string;
  status: "approved" | "declined" | "captured" | "released" | "expired" | "refunded";
  decline_code: DeclineCode | null;
  decline_message: string | null;
  amount_minor: number;
  captured_minor: number;
  refunded_minor: number;
  currency: CurrencyBrief;
  hold_id: string | null;
  /** Held on top of the amount while approved. */
  reserved_fee_minor: number;
  expires_at_game: string | null;
  capture_transaction_id: string | null;
  reference: string | null;
  description: string | null;
  refunds: CardRefund[];
  game_time: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}
export interface AuthorizeCardParams {
  /** The card: card_id, or card_number with expiry_month and expiry_year (and optionally cvv). */
  card_id?: string;
  card_number?: string;
  expiry_month?: number;
  expiry_year?: number;
  cvv?: string;
  /** A merchant account in the card's bank. */
  merchant_account_id?: string;
  merchant_account_number?: string;
  amount_minor: number;
  reference?: string;
  description?: string;
  max_fee_minor?: number;
  /**
   * True (the default) captures an approved payment in full in the same call.
   * False only reserves the money: capture or release it later, or it expires.
   */
  capture?: boolean;
}
/** A decline is not an error: check authorization.status and decline_code. */
export interface AuthorizeCardResult {
  authorization: CardAuthorization;
  fees: FeeCharge[];
  fees_total_minor: number;
  /** The cardholder's account after the call. */
  balance: Balance;
  /** Set when the payment was captured (approved, without `capture: false`). */
  transaction?: Transaction;
  merchant_balance?: Balance;
  total_debit_minor?: number;
}
export interface CaptureCardParams {
  /** Omit or 0 to capture everything; the rest is released. */
  amount_minor?: number;
  max_fee_minor?: number;
}
export interface CaptureCardResult {
  authorization: CardAuthorization;
  transaction: Transaction;
  card_balance: Balance;
  merchant_balance: Balance;
  fees: FeeCharge[];
  fees_total_minor: number;
  total_debit_minor: number;
}
export interface RefundCardParams {
  /** Omit or 0 to refund the rest. */
  amount_minor?: number;
  reason?: string;
}
export interface RefundCardResult {
  refund: CardRefund;
  authorization: CardAuthorization;
  transaction: Transaction;
  card_balance: Balance;
  merchant_balance: Balance;
}
export interface ListCardAuthorizationsParams {
  card_id?: string;
  merchant_id?: string;
  account_id?: string;
  status?: CardAuthorization["status"];
  limit?: number;
}

// ---- Savings and fixed deposits ---------------------------------------------------

/** An annual rate from a balance upwards (300 = 3%). */
export interface DepositTier { from_minor: number; rate_bps: number }
/** A fixed-deposit term on offer. */
export interface DepositTerm { days: number; rate_bps: number }
export type MaturityInstruction = "payout" | "rollover_principal" | "rollover_all";

export interface DepositProduct {
  id: string;
  bank_id: string;
  code: string;
  name: string;
  kind: "savings" | "fixed_deposit";
  rate_tiers: DepositTier[];
  tier_method: "whole_balance" | "banded";
  terms: DepositTerm[];
  day_count: "act_365" | "act_360";
  accrual_basis: "end_of_day" | "minimum_daily";
  payout_frequency: "monthly" | "quarterly" | "at_maturity";
  withholding_tax_bps: number;
  min_opening_minor: number;
  min_balance_minor: number;
  max_balance_minor: number | null;
  withdrawals_per_month: number | null;
  excess_withdrawal_action: "block" | "forfeit_interest" | "fee";
  early_forfeit_bps: number;
  early_penalty_fixed_minor: number;
  early_penalty_bps: number;
  default_maturity_instruction: MaturityInstruction;
  status: "active" | "inactive";
  version: number;
  created_at: string;
  updated_at: string;
}
/** On create: code, name, kind and rate_tiers (savings) or terms (fixed deposits). */
export interface DepositProductParams {
  code?: string;
  name?: string;
  kind?: "savings" | "fixed_deposit";
  rate_tiers?: DepositTier[];
  tier_method?: "whole_balance" | "banded";
  terms?: DepositTerm[];
  day_count?: "act_365" | "act_360";
  accrual_basis?: "end_of_day" | "minimum_daily";
  payout_frequency?: "monthly" | "quarterly";
  withholding_tax_bps?: number;
  min_opening_minor?: number;
  min_balance_minor?: number;
  max_balance_minor?: number;
  withdrawals_per_month?: number;
  excess_withdrawal_action?: "block" | "forfeit_interest" | "fee";
  early_forfeit_bps?: number;
  early_penalty_fixed_minor?: number;
  early_penalty_bps?: number;
  default_maturity_instruction?: MaturityInstruction;
  status?: "active" | "inactive";
  clear?: ("max_balance_minor" | "withdrawals_per_month")[];
}
export interface DepositQuoteParams {
  product_id: string;
  amount_minor: number;
  /** Savings: days to project (default 30). */
  days?: number;
  /** Fixed deposits. */
  term_days?: number;
}
export interface DepositQuote {
  product_id: string;
  amount_minor: number;
  days: number;
  rate_bps: number;
  gross_interest_minor: number;
  tax_minor: number;
  net_interest_minor: number;
  maturity_amount_minor: number;
}
export interface AccountInterest {
  account_id: string;
  product_id: string;
  product_name: string;
  payout_frequency: string;
  /** The rate the current balance earns (a fixed deposit's locked rate). */
  rate_bps: number;
  accrued_interest_minor: number;
  accrued_through: string;
  next_payout_day: string;
  forfeit_month: string | null;
  withdrawals_this_month: number;
  withdrawals_per_month: number | null;
  payouts: { transaction_id: string; gross_minor: number; narration: string; game_time: string }[];
}
export interface FixedDeposit {
  id: string;
  bank_id: string;
  account_id: string;
  account_number: string;
  player_id: string;
  product_id: string;
  product_name: string;
  source_account_id: string;
  payout_account_id: string;
  principal_minor: number;
  rate_bps: number;
  term_days: number;
  start_day: string;
  maturity_day: string;
  maturity_instruction: MaturityInstruction;
  status: "active" | "matured" | "broken";
  terms_completed: number;
  interest_paid_minor: number;
  accrued_interest_minor: number;
  balance_minor: number;
  created_at: string;
  closed_at: string | null;
}
export interface OpenFixedDepositParams {
  source_account_id: string;
  product_id: string;
  term_days: number;
  amount_minor: number;
  maturity_instruction?: MaturityInstruction;
  /** Default the source account. */
  payout_account_id?: string;
}
export interface OpenFixedDepositResult {
  fixed_deposit: FixedDeposit;
  transaction: Transaction;
  source_balance: Balance;
}
export interface BreakQuote {
  fixed_deposit_id: string;
  principal_minor: number;
  accrued_interest_minor: number;
  forfeited_interest_minor: number;
  interest_paid_minor: number;
  tax_minor: number;
  penalty_minor: number;
  payout_minor: number;
  payout_account_id: string;
}
export interface BreakFixedDepositResult {
  fixed_deposit: FixedDeposit;
  quote: BreakQuote;
  transaction: Transaction;
}
export interface ListFixedDepositsParams {
  player_id?: string;
  source_account_id?: string;
  status?: FixedDeposit["status"];
  limit?: number;
}
