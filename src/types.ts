/**
 * Context provided to an executed async function on each attempt.
 */
export interface ExecutionContext {
  /**
   * Dedicated AbortSignal for this specific attempt.
   * Will abort if:
   * - The attempt timeout triggers
   * - The total execution timeout triggers
   * - The external AbortSignal aborts
   */
  readonly signal: AbortSignal;

  /**
   * 1-based attempt index (1 for initial attempt, 2 for first retry, etc.).
   */
  readonly attempt: number;

  /**
   * Number of retry attempts remaining after the current attempt.
   */
  readonly remainingAttempts: number;
}

/**
 * An async operation to be executed, accepting an optional ExecutionContext.
 */
export type AsyncOperation<T> = (context: ExecutionContext) => T | Promise<T>;

/**
 * Standard backoff strategy types.
 * - "exponential": Base delay multiplied exponentially per attempt: minDelay * (factor ^ (attempt - 1))
 * - "fixed": Constant delay between attempts: minDelay
 * - custom function: (attempt: number, error: unknown) => delay in ms
 */
export type BackoffStrategy =
  "exponential" | "fixed" | ((attempt: number, error: unknown) => number);

/**
 * Jitter mode to avoid synchronized retries ("thundering herd" problem).
 * - true / "full": Random delay between 0 and calculated backoff delay.
 * - "equal": Half fixed delay, half randomized delay: (delay / 2) + Math.random() * (delay / 2).
 * - false: Deterministic delay without randomization.
 */
export type JitterStrategy = boolean | "full" | "equal";

/**
 * Configuration options for the retry engine.
 */
export interface RetryConfig {
  /**
   * Number of retries to attempt after an initial failure.
   * For example, `retries: 3` allows 1 initial attempt + 3 retries = 4 total attempts.
   * If both `retries` and `attempts` are supplied, `attempts` takes precedence.
   * Default: 0
   */
  retries?: number | undefined;

  /**
   * Maximum total attempts allowed (initial attempt + retries).
   * For example, `attempts: 3` allows 1 initial attempt + 2 retries = 3 total attempts.
   */
  attempts?: number | undefined;

  /**
   * Backoff delay strategy. Default: "exponential"
   */
  backoff?: BackoffStrategy | undefined;

  /**
   * Minimum delay (in milliseconds) before the first retry. Default: 100
   */
  minDelay?: number | undefined;

  /**
   * Maximum delay (in milliseconds) between retries. Default: 30000
   */
  maxDelay?: number | undefined;

  /**
   * Multiplier factor for exponential backoff. Default: 2
   */
  factor?: number | undefined;

  /**
   * Jitter strategy to prevent thundering herds. Default: false
   */
  jitter?: JitterStrategy | undefined;

  /**
   * Predicate to determine if an error should trigger a retry.
   * If returns false (or rejects / resolves to false), execution immediately halts.
   * Note: AbortError and expired total timeout will never be retried.
   *
   * @param error The caught error
   * @param attempt Current attempt number (1-based)
   */
  shouldRetry?: ((error: unknown, attempt: number) => boolean | Promise<boolean>) | undefined;
}

/**
 * Timeout configuration.
 * - A single number: timeout in milliseconds applied to each individual attempt.
 * - An object: explicitly configure per-attempt timeout and/or total execution timeout.
 */
export type TimeoutOption =
  | number
  | {
      /**
       * Timeout in milliseconds for each individual attempt.
       * If an attempt times out, it triggers a TimeoutError which can be retried.
       */
      attempt?: number | undefined;

      /**
       * Timeout in milliseconds across the entire execution (including all retries and delays).
       * If the total timeout triggers, the whole operation is permanently cancelled.
       */
      total?: number | undefined;
    };

/**
 * Information passed to `onStart` observability hook.
 */
export interface ExecutionStartInfo {
  /** Current attempt number (1-based) */
  attempt: number;
}

/**
 * Information passed to `onRetry` observability hook.
 */
export interface ExecutionRetryInfo {
  /** The attempt number that just failed (1-based) */
  attempt: number;
  /** Maximum total attempts configured */
  maxAttempts: number;
  /** The error that triggered this retry */
  error: unknown;
  /** Delay (in milliseconds) before the next attempt will start */
  delay: number;
}

/**
 * Information passed to `onSuccess` observability hook.
 */
export interface ExecutionSuccessInfo<T> {
  /** The attempt number that succeeded (1-based) */
  attempt: number;
  /** The returned result */
  result: T;
  /** Duration of the successful attempt in milliseconds */
  durationMs: number;
  /** Total elapsed time across all attempts and delays in milliseconds */
  totalDurationMs: number;
}

/**
 * Information passed to `onFailure` observability hook.
 */
export interface ExecutionFailureInfo {
  /** The attempt number that failed (1-based) */
  attempt: number;
  /** The error encountered */
  error: unknown;
  /** Duration of this attempt in milliseconds */
  durationMs: number;
  /** Total elapsed time across all attempts and delays so far in milliseconds */
  totalDurationMs: number;
  /** Whether the operation will attempt another retry */
  willRetry: boolean;
}

/**
 * Lifecycle observability hooks.
 */
export interface ObservabilityHooks<T = unknown> {
  /** Invoked when an attempt begins */
  onStart?: ((info: ExecutionStartInfo) => void | Promise<void>) | undefined;

  /** Invoked before sleeping and retrying after an attempt fails */
  onRetry?: ((info: ExecutionRetryInfo) => void | Promise<void>) | undefined;

  /** Invoked when an attempt successfully completes */
  onSuccess?: ((info: ExecutionSuccessInfo<T>) => void | Promise<void>) | undefined;

  /** Invoked whenever an attempt fails (whether retrying or fatal) */
  onFailure?: ((info: ExecutionFailureInfo) => void | Promise<void>) | undefined;
}

/**
 * Options for the main `execute` function.
 */
export interface ExecuteOptions<T = unknown> extends ObservabilityHooks<T> {
  /**
   * Timeout configuration.
   * If a number is passed, it is applied per-attempt.
   */
  timeout?: TimeoutOption | undefined;

  /**
   * Retry configuration or simple number of retries.
   */
  retry?: number | RetryConfig | undefined;

  /**
   * External AbortSignal to cancel the operation.
   */
  signal?: AbortSignal | undefined;

  /**
   * If true (default), throws a `RetryError` containing full metadata and the cause when all attempts fail.
   * If false, re-throws the underlying raw error directly.
   * Default: true
   */
  wrapError?: boolean | undefined;

  /**
   * Fallback value or fallback function to resolve with if all attempts fail.
   */
  fallback?: T | ((error: unknown) => T | Promise<T>) | undefined;
}

/**
 * Options for the standalone `retry` helper function.
 */
export interface RetryOptions<T = unknown> extends RetryConfig, ObservabilityHooks<T> {
  /**
   * Optional timeout configuration (per attempt or total).
   */
  timeout?: TimeoutOption | undefined;

  /**
   * External AbortSignal.
   */
  signal?: AbortSignal | undefined;

  /**
   * If true (default), throws RetryError on exhaustion. If false, throws original error.
   */
  wrapError?: boolean | undefined;

  /**
   * Fallback value or function on failure.
   */
  fallback?: T | ((error: unknown) => T | Promise<T>) | undefined;
}

/**
 * Options for the standalone `timeout` helper function.
 */
export interface TimeoutOptions<T = unknown> {
  /** Timeout duration in milliseconds */
  ms?: number | undefined;

  /** External AbortSignal to observe */
  signal?: AbortSignal | undefined;

  /** Custom message for the TimeoutError */
  message?: string | undefined;

  /** Optional fallback value or function if timeout occurs */
  fallback?: T | (() => T | Promise<T>) | undefined;
}

/**
 * Options for concurrency limiting.
 */
export interface ConcurrencyOptions {
  /**
   * Maximum number of concurrently executing operations.
   * Must be an integer >= 1.
   */
  concurrency: number;

  /**
   * Maximum allowed waiting tasks in queue.
   * If queue exceeds this limit, calling the guarded function throws ConcurrencyError immediately.
   */
  queueSize?: number | undefined;

  /**
   * External AbortSignal to cancel all queued tasks.
   */
  signal?: AbortSignal | undefined;
}

/**
 * A concurrency limiter instance that can schedule tasks and manage queue state.
 */
export interface ConcurrencyLimiter {
  /**
   * Run a task within the concurrency limit.
   */
  run<T>(task: () => T | Promise<T>, options?: { signal?: AbortSignal | undefined }): Promise<T>;

  /**
   * Number of actively executing operations.
   */
  readonly activeCount: number;

  /**
   * Number of queued operations waiting for execution.
   */
  readonly pendingCount: number;

  /**
   * The configured concurrency limit.
   */
  readonly concurrency: number;

  /**
   * Clear all pending queued tasks, rejecting each with an AbortError or custom reason.
   */
  clearQueue(reason?: unknown): void;
}

/**
 * A function wrapped with concurrency control, exposing live queue metrics.
 */
export interface GuardedFunction<Args extends unknown[], Return> {
  (...args: Args): Promise<Return>;

  /** Number of currently active executions of this function */
  readonly activeCount: number;

  /** Number of queued calls waiting to execute */
  readonly pendingCount: number;

  /** The concurrency limit */
  readonly concurrency: number;

  /** Clear all queued calls waiting in line */
  clearQueue(reason?: unknown): void;
}
