import { execute } from "./execute.js";
import type { AsyncOperation, RetryOptions } from "./types.js";

/**
 * Retries an asynchronous operation upon failure according to configured backoff,
 * jitter, and retry predicates.
 *
 * @param operation The function to execute and retry upon failure.
 * @param options Retry and execution options.
 */
export async function retry<T>(
  operation: AsyncOperation<T>,
  options: RetryOptions<T> = {},
): Promise<T> {
  const {
    timeout,
    signal,
    wrapError,
    fallback,
    onStart,
    onRetry,
    onSuccess,
    onFailure,
    ...retryConfig
  } = options;

  return await execute(operation, {
    retry: retryConfig,
    timeout,
    signal,
    wrapError,
    fallback,
    onStart,
    onRetry,
    onSuccess,
    onFailure,
  });
}
