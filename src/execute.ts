import { calculateDelay } from "./backoff.js";
import { AbortError, RetryError, TimeoutError } from "./errors.js";
import { createLinkedSignal, throwIfAborted, toAbortError } from "./internal/abort.js";
import { sleep } from "./internal/sleep.js";
import type { AsyncOperation, ExecutionContext, ExecuteOptions, RetryConfig } from "./types.js";

/**
 * Safely calls an observability hook, swallowing any unexpected synchronous or
 * asynchronous error so user hooks cannot break core execution.
 */
async function safeHook(fn: (() => void | Promise<void>) | undefined): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch {
    // Intentionally swallowed to protect core execution flow
  }
}

/**
 * Executes an async operation with comprehensive timeout, retry, backoff,
 * cancellation, and observability controls.
 *
 * @param operation The function to execute. Receives an ExecutionContext with attempt signal and metrics.
 * @param options Execution configuration options.
 */
export async function execute<T>(
  operation: AsyncOperation<T>,
  options: ExecuteOptions<T> = {},
): Promise<T> {
  const {
    timeout: timeoutOpt,
    retry: retryOpt,
    signal: externalSignal,
    wrapError,
    fallback,
    onStart,
    onRetry,
    onSuccess,
    onFailure,
  } = options;

  const startTime = Date.now();

  // 1. Initial cancellation check
  throwIfAborted(externalSignal);

  // 2. Normalize retry options
  let retryConfig: RetryConfig = {};
  let maxAttempts = 1;

  if (typeof retryOpt === "number") {
    maxAttempts = 1 + Math.max(0, Math.floor(retryOpt));
    retryConfig = { retries: Math.max(0, Math.floor(retryOpt)) };
  } else if (typeof retryOpt === "object" && retryOpt !== null) {
    retryConfig = retryOpt;
    if (retryOpt.attempts !== undefined) {
      maxAttempts = Math.max(1, Math.floor(retryOpt.attempts));
    } else if (retryOpt.retries !== undefined) {
      maxAttempts = 1 + Math.max(0, Math.floor(retryOpt.retries));
    } else {
      maxAttempts = 1;
    }
  }

  // 3. Normalize timeout options
  let attemptTimeoutMs: number | undefined;
  let totalTimeoutMs: number | undefined;

  if (typeof timeoutOpt === "number") {
    attemptTimeoutMs = timeoutOpt > 0 ? timeoutOpt : undefined;
  } else if (typeof timeoutOpt === "object" && timeoutOpt !== null) {
    if (timeoutOpt.attempt !== undefined && timeoutOpt.attempt > 0) {
      attemptTimeoutMs = timeoutOpt.attempt;
    }
    if (timeoutOpt.total !== undefined && timeoutOpt.total > 0) {
      totalTimeoutMs = timeoutOpt.total;
    }
  }

  // 4. Setup total timeout if configured
  const totalTimeoutController = new AbortController();
  let totalTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimeoutExpired = false;

  if (totalTimeoutMs !== undefined) {
    totalTimeoutTimer = setTimeout(() => {
      totalTimeoutExpired = true;
      const error = new TimeoutError(`Execution exceeded total timeout of ${totalTimeoutMs}ms`, {
        timeout: totalTimeoutMs,
        scope: "total",
        attempt: 1,
      });
      totalTimeoutController.abort(error);
    }, totalTimeoutMs);
  }

  const cleanupTotalTimeout = () => {
    if (totalTimeoutTimer !== null) {
      clearTimeout(totalTimeoutTimer);
      totalTimeoutTimer = null;
    }
  };

  const defaultShouldRetry = (err: unknown): boolean => {
    if (err instanceof AbortError) return false;
    return true;
  };

  const shouldRetryPredicate = retryConfig.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  let executedAttempts = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      executedAttempts = attempt;
      const attemptStartTime = Date.now();

      // Check external abort or total timeout before launching attempt
      if (externalSignal?.aborted) {
        throw toAbortError(externalSignal);
      }
      if (totalTimeoutExpired) {
        throw new TimeoutError(`Execution exceeded total timeout of ${totalTimeoutMs}ms`, {
          timeout: totalTimeoutMs ?? 0,
          scope: "total",
          attempt,
        });
      }

      await safeHook(() => onStart?.({ attempt }));

      // Setup attempt-level timeout and cancellation
      const attemptController = new AbortController();
      const linked = createLinkedSignal(
        externalSignal,
        totalTimeoutController.signal,
        attemptController.signal,
      );

      let attemptTimer: ReturnType<typeof setTimeout> | null = null;
      let onExternalAbort: (() => void) | null = null;
      let onTotalAbort: (() => void) | null = null;

      const cleanupAttempt = () => {
        if (attemptTimer !== null) {
          clearTimeout(attemptTimer);
          attemptTimer = null;
        }
        if (externalSignal && onExternalAbort) {
          externalSignal.removeEventListener("abort", onExternalAbort);
          onExternalAbort = null;
        }
        if (onTotalAbort) {
          totalTimeoutController.signal.removeEventListener("abort", onTotalAbort);
          onTotalAbort = null;
        }
        linked.cleanup();
      };

      const context: ExecutionContext = {
        signal: linked.signal,
        attempt,
        remainingAttempts: maxAttempts - attempt,
      };

      let attemptResult: T;
      let succeeded = false;

      try {
        const attemptTimeoutOrAbortPromise = new Promise<never>((_, reject) => {
          if (attemptTimeoutMs !== undefined) {
            attemptTimer = setTimeout(() => {
              const err = new TimeoutError(
                `Attempt ${attempt} timed out after ${attemptTimeoutMs}ms`,
                {
                  timeout: attemptTimeoutMs,
                  scope: "attempt",
                  attempt,
                },
              );
              attemptController.abort(err);
              reject(err);
            }, attemptTimeoutMs);
          }

          if (externalSignal) {
            onExternalAbort = () => {
              const err = toAbortError(externalSignal);
              attemptController.abort(err);
              reject(err);
            };
            externalSignal.addEventListener("abort", onExternalAbort, { once: true });
          }

          onTotalAbort = () => {
            const err = new TimeoutError(
              `Execution exceeded total timeout of ${totalTimeoutMs}ms`,
              {
                timeout: totalTimeoutMs ?? 0,
                scope: "total",
                attempt,
              },
            );
            attemptController.abort(err);
            reject(err);
          };
          totalTimeoutController.signal.addEventListener("abort", onTotalAbort, { once: true });
        });

        // Run the operation in race with timeout and abort
        const operationPromise = Promise.resolve().then(() => operation(context));
        attemptResult = await Promise.race([operationPromise, attemptTimeoutOrAbortPromise]);
        succeeded = true;
      } catch (rawError) {
        cleanupAttempt();

        // Normalize caught error
        let currentError = rawError;
        if (
          totalTimeoutExpired &&
          !(rawError instanceof TimeoutError && rawError.scope === "total")
        ) {
          currentError = new TimeoutError(
            `Execution exceeded total timeout of ${totalTimeoutMs}ms`,
            {
              timeout: totalTimeoutMs ?? 0,
              scope: "total",
              attempt,
              cause: rawError,
            },
          );
        } else if (externalSignal?.aborted && !(rawError instanceof AbortError)) {
          currentError = toAbortError(externalSignal);
        }

        lastError = currentError;
        const attemptDurationMs = Date.now() - attemptStartTime;
        const totalDurationMs = Date.now() - startTime;

        // Fatal abortion conditions: external abort or total timeout expired
        if (externalSignal?.aborted) {
          await safeHook(() =>
            onFailure?.({
              attempt,
              error: currentError,
              durationMs: attemptDurationMs,
              totalDurationMs,
              willRetry: false,
            }),
          );
          throw toAbortError(externalSignal);
        }

        if (totalTimeoutExpired) {
          await safeHook(() =>
            onFailure?.({
              attempt,
              error: currentError,
              durationMs: attemptDurationMs,
              totalDurationMs,
              willRetry: false,
            }),
          );
          throw currentError;
        }

        const hasRemainingAttempts = attempt < maxAttempts;
        let shouldRetryAttempt = false;

        if (hasRemainingAttempts) {
          try {
            shouldRetryAttempt = Boolean(await shouldRetryPredicate(currentError, attempt));
          } catch (predicateError) {
            // Predicate failure is fatal
            await safeHook(() =>
              onFailure?.({
                attempt,
                error: currentError,
                durationMs: attemptDurationMs,
                totalDurationMs,
                willRetry: false,
              }),
            );
            throw predicateError;
          }
        }

        if (shouldRetryAttempt) {
          const delay = calculateDelay({
            attempt,
            error: currentError,
            strategy: retryConfig.backoff,
            minDelay: retryConfig.minDelay,
            maxDelay: retryConfig.maxDelay,
            factor: retryConfig.factor,
            jitter: retryConfig.jitter,
          });

          await safeHook(() =>
            onFailure?.({
              attempt,
              error: currentError,
              durationMs: attemptDurationMs,
              totalDurationMs,
              willRetry: true,
            }),
          );

          await safeHook(() =>
            onRetry?.({
              attempt,
              maxAttempts,
              error: currentError,
              delay,
            }),
          );

          // Sleep before next retry, cancelable by external signal or total timeout
          const sleepSignal = createLinkedSignal(externalSignal, totalTimeoutController.signal);
          try {
            await sleep(delay, sleepSignal.signal);
          } finally {
            sleepSignal.cleanup();
          }

          // Continue to next attempt
          continue;
        }

        // Will not retry
        await safeHook(() =>
          onFailure?.({
            attempt,
            error: currentError,
            durationMs: attemptDurationMs,
            totalDurationMs,
            willRetry: false,
          }),
        );
        break;
      } finally {
        cleanupAttempt();
      }

      if (succeeded) {
        cleanupTotalTimeout();
        const attemptDurationMs = Date.now() - attemptStartTime;
        const totalDurationMs = Date.now() - startTime;

        await safeHook(() =>
          onSuccess?.({
            attempt,
            result: attemptResult,
            durationMs: attemptDurationMs,
            totalDurationMs,
          }),
        );

        return attemptResult;
      }
    }
  } finally {
    cleanupTotalTimeout();
  }

  // Execution ended without success
  if (fallback !== undefined) {
    if (typeof fallback === "function") {
      return await (fallback as (err: unknown) => T | Promise<T>)(lastError);
    }
    return fallback;
  }

  const elapsedMs = Date.now() - startTime;
  // If multiple attempts were configured/executed, wrap in RetryError by default.
  // If single attempt without retries, throw the underlying error directly unless explicitly requested.
  const shouldWrap = wrapError !== undefined ? wrapError : maxAttempts > 1;

  if (shouldWrap) {
    throw new RetryError(
      `Operation failed after ${executedAttempts} ${executedAttempts === 1 ? "attempt" : "attempts"}`,
      {
        attempts: executedAttempts,
        maxAttempts,
        lastError,
        elapsedMs,
        cause: lastError,
      },
    );
  }

  throw lastError;
}
