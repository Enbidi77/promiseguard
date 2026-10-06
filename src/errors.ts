/**
 * Base class for all errors thrown by PromiseGuard.
 */
export class PromiseGuardError extends Error {
  override readonly name: string = "PromiseGuardError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an operation exceeds its configured timeout duration.
 */
export class TimeoutError extends PromiseGuardError {
  override readonly name: string = "TimeoutError";

  /** The configured timeout duration in milliseconds */
  readonly timeout: number;

  /** Scope of timeout: "attempt" (individual try) or "total" (entire execution) */
  readonly scope: "attempt" | "total";

  /** Attempt number during which timeout occurred (1-based) */
  readonly attempt: number;

  constructor(
    message: string,
    options: {
      timeout: number;
      scope?: "attempt" | "total";
      attempt?: number;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.timeout = options.timeout;
    this.scope = options.scope ?? "attempt";
    this.attempt = options.attempt ?? 1;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Thrown when an operation is cancelled via an AbortSignal.
 */
export class AbortError extends PromiseGuardError {
  override readonly name: string = "AbortError";

  /** Cancellation reason provided by AbortSignal */
  readonly reason?: unknown;

  constructor(
    message: string = "Operation was aborted",
    options?: {
      reason?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.reason = options?.reason;
    Object.setPrototypeOf(this, AbortError.prototype);
  }
}

/**
 * Thrown when an operation fails after exhausting all configured retry attempts.
 */
export class RetryError extends PromiseGuardError {
  override readonly name: string = "RetryError";

  /** Total number of attempts executed before failing */
  readonly attempts: number;

  /** Maximum attempts allowed */
  readonly maxAttempts: number;

  /** The final error that triggered the failure */
  readonly lastError: unknown;

  /** Total elapsed time in milliseconds across all attempts and delays */
  readonly elapsedMs: number;

  constructor(
    message: string,
    options: {
      attempts: number;
      maxAttempts: number;
      lastError: unknown;
      elapsedMs: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause ?? options.lastError });
    this.attempts = options.attempts;
    this.maxAttempts = options.maxAttempts;
    this.lastError = options.lastError;
    this.elapsedMs = options.elapsedMs;
    Object.setPrototypeOf(this, RetryError.prototype);
  }
}

/**
 * Thrown when a concurrency limitation is violated, such as queue overflow.
 */
export class ConcurrencyError extends PromiseGuardError {
  override readonly name: string = "ConcurrencyError";

  /** Max queue size if triggered by queue limit */
  readonly queueSize?: number | undefined;

  constructor(
    message: string,
    options?: {
      queueSize?: number | undefined;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.queueSize = options?.queueSize;
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }
}

/**
 * Type guard for PromiseGuardError
 */
export function isPromiseGuardError(error: unknown): error is PromiseGuardError {
  return error instanceof PromiseGuardError;
}

/**
 * Type guard for TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Type guard for AbortError
 */
export function isAbortError(error: unknown): error is AbortError {
  return error instanceof AbortError;
}

/**
 * Type guard for RetryError
 */
export function isRetryError(error: unknown): error is RetryError {
  return error instanceof RetryError;
}

/**
 * Type guard for ConcurrencyError
 */
export function isConcurrencyError(error: unknown): error is ConcurrencyError {
  return error instanceof ConcurrencyError;
}
