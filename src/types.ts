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
  player_id: string;
  account_type?: "current" | "savings";
  account_name?: string;
  currency?: string;
  metadata?: Metadata;
}
export interface ListAccountsParams {
  bank_id?: string;
  player_id?: string;
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

export type FeeEvent = "transfer" | "hold_capture" | "account_maintenance";
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
  event?: "transfer" | "hold_capture";
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
  | "transfer:create" | "funding:create" | "transaction:reverse" | "limits:write";
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
