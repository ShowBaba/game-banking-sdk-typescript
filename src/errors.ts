/** Any failure from the Game Banking Engine or from reaching it. */
export class GameBankError extends Error {
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  /** The engine's stable, machine-readable error code, e.g. "insufficient_funds". */
  readonly code: string;
  /** Extra context from the engine, e.g. { available_balance, requested_amount }. */
  readonly details: Record<string, unknown>;
  /** The engine's correlation ID (X-Request-Id). Quote it when reporting a problem. */
  readonly requestId: string | undefined;
  /** Seconds the engine asked the caller to wait, when it sent Retry-After. */
  readonly retryAfter: number | undefined;

  constructor(init: { status: number; code: string; message: string; details?: Record<string, unknown>; requestId?: string; retryAfter?: number; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
  }
}

/** 401: the API key or credential is missing, wrong, expired or revoked. */
export class AuthenticationError extends GameBankError {}
/** 403: the credential lacks a scope, or the game or developer is suspended. */
export class PermissionDeniedError extends GameBankError {}
/** 404: the resource does not exist in this game and environment. */
export class NotFoundError extends GameBankError {}
/** 409: e.g. idempotency_key_reused, already_reversed, email_taken. */
export class ConflictError extends GameBankError {}
/**
 * 409 fee_changed: the fees now total more than the request's max_fee_minor,
 * e.g. the bank's fee schedule changed after the player saw a quote.
 * details.fees lists the current charges; get a new quote.
 */
export class FeeChangedError extends ConflictError {}
/**
 * 409 penalty_changed: breaking a fixed deposit would cost more than the
 * request's max_penalty_minor. details.quote has the current figures.
 */
export class PenaltyChangedError extends ConflictError {}
/** 400, 413, 415: the request itself is invalid. */
export class InvalidRequestError extends GameBankError {}
/** 422 business rule failure, e.g. account_frozen, hold_not_active. */
export class UnprocessableError extends GameBankError {}
/** 422 insufficient_funds: the source account's available balance is too low. */
export class InsufficientFundsError extends UnprocessableError {}
/** 422 limit_exceeded: a per-transaction or per-game-day cap would be exceeded. */
export class LimitExceededError extends UnprocessableError {}
/** 429: slow down; see retryAfter. */
export class RateLimitError extends GameBankError {}
/** 5xx: the engine failed. Nothing was committed for a 500. */
export class ServerError extends GameBankError {}
/** No response: network failure or timeout. */
export class ConnectionError extends GameBankError {}

/** Builds the right error subtype from a status and engine error code. */
export function errorFor(init: ConstructorParameters<typeof GameBankError>[0]): GameBankError {
  const { status, code } = init;
  if (status === 0) return new ConnectionError(init);
  if (status === 401) return new AuthenticationError(init);
  if (status === 403) return new PermissionDeniedError(init);
  if (status === 404) return new NotFoundError(init);
  if (status === 409) {
    if (code === "fee_changed") return new FeeChangedError(init);
    if (code === "penalty_changed") return new PenaltyChangedError(init);
    return new ConflictError(init);
  }
  if (status === 429) return new RateLimitError(init);
  if (status === 422) {
    if (code === "insufficient_funds") return new InsufficientFundsError(init);
    if (code === "limit_exceeded") return new LimitExceededError(init);
    return new UnprocessableError(init);
  }
  if (status >= 500) return new ServerError(init);
  if (status >= 400) return new InvalidRequestError(init);
  return new GameBankError(init);
}
