import { TimeoutError } from "./errors.js";
import { createLinkedSignal, throwIfAborted } from "./internal/abort.js";
import type { TimeoutOptions } from "./types.js";

/**
 * Executes an operation with a timeout guard.
 * If the operation does not complete within the specified milliseconds,
 * a TimeoutError is thrown and the operation's AbortSignal is triggered.
 *
 * @param operation The function to execute
 * @param optionsOrMs Timeout duration in milliseconds or a TimeoutOptions object
 */
export async function timeout<T>(
  operation: (context: { signal: AbortSignal }) => T | Promise<T>,
  optionsOrMs: number | TimeoutOptions<T>,
): Promise<T> {
  const options: TimeoutOptions<T> =
    typeof optionsOrMs === "number" ? { ms: optionsOrMs } : optionsOrMs;

  const ms = options.ms;
  const externalSignal = options.signal;

  // Immediate abort check
  throwIfAborted(externalSignal);

  // If no timeout or non-positive timeout specified, run directly
  if (ms === undefined || ms === null || ms <= 0) {
    return await operation({ signal: externalSignal ?? new AbortController().signal });
  }

  const timeoutController = new AbortController();
  const linked = createLinkedSignal(timeoutController.signal, externalSignal);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    linked.cleanup();
  };

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      const error = new TimeoutError(options.message ?? `Operation timed out after ${ms}ms`, {
        timeout: ms,
        scope: "attempt",
        attempt: 1,
      });
      // Abort the ongoing operation
      timeoutController.abort(error);
      reject(error);
    }, ms);
  });

  try {
    const operationPromise = Promise.resolve().then(() => operation({ signal: linked.signal }));

    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (didTimeout && options.fallback !== undefined) {
      if (typeof options.fallback === "function") {
        return await (options.fallback as () => T | Promise<T>)();
      }
      return options.fallback;
    }
    throw error;
  } finally {
    cleanup();
  }
}
