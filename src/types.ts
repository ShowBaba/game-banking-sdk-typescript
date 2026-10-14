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
}

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
}
export interface CaptureHoldParams {
  /** Omit to capture the whole hold. */
  amount_minor?: number;
  destination_account_id?: string;
  destination_account_number?: string;
  narration?: string;
  reference?: string;
  metadata?: Metadata;
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
export interface IssueApiKeyParams {
  environment: Environment;
  label?: string;
  /** Defaults to bank:read, account:read, account:write, transfer:create. */
  scopes?: Scope[];
  expires_at?: string;
}
