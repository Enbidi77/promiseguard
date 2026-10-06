import { AbortError } from "../errors.js";

/**
 * Sleep for a specified duration in milliseconds, cancelable via AbortSignal.
 * Cleans up all event listeners and timers upon resolution or abortion to prevent leaks.
 *
 * @param ms Delay duration in milliseconds
 * @param signal Optional AbortSignal to cancel the sleep early
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new AbortError("Sleep aborted", {
        reason: signal.reason,
      }),
    );
  }

  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(
        new AbortError("Sleep aborted", {
          reason: signal?.reason,
        }),
      );
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
