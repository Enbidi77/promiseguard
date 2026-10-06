import { AbortError } from "../errors.js";

/**
 * Throws an AbortError if the provided signal is already aborted.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AbortError("Operation was aborted", {
      reason: signal.reason,
    });
  }
}

/**
 * Creates an AbortError from an AbortSignal reason.
 */
export function toAbortError(signal?: AbortSignal, message?: string): AbortError {
  return new AbortError(message ?? "Operation was aborted", {
    reason: signal?.reason,
  });
}

/**
 * Combines multiple AbortSignals into a single internal controller.
 * If any input signal aborts, the combined controller aborts.
 * Provides a `cleanup()` method to detach all event listeners when done,
 * ensuring no memory leaks occur.
 */
export function createLinkedSignal(...signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const activeSignals = signals.filter((s): s is AbortSignal => s !== undefined && s !== null);

  // Check if any is already aborted
  for (const s of activeSignals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return {
        signal: controller.signal,
        abort: (reason?: unknown) => controller.abort(reason),
        cleanup: () => {},
      };
    }
  }

  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  const cleanup = () => {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.length = 0;
  };

  for (const s of activeSignals) {
    const onAbort = () => {
      controller.abort(s.reason);
      cleanup();
    };
    s.addEventListener("abort", onAbort, { once: true });
    listeners.push({ signal: s, listener: onAbort });
  }

  return {
    signal: controller.signal,
    abort: (reason?: unknown) => {
      controller.abort(reason);
      cleanup();
    },
    cleanup,
  };
}
