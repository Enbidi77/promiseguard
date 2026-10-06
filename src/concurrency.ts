import { ConcurrencyError } from "./errors.js";
import { throwIfAborted, toAbortError } from "./internal/abort.js";
import type { ConcurrencyLimiter, ConcurrencyOptions, GuardedFunction } from "./types.js";

interface QueueNode {
  run: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal | undefined;
  abortListener?: (() => void) | undefined;
  prev: QueueNode | null;
  next: QueueNode | null;
}

/**
 * Creates a standalone ConcurrencyLimiter instance.
 *
 * Employs an internal doubly-linked list for O(1) enqueuing, dequeuing,
 * and cancellation, ensuring zero memory leaks and high performance even with
 * tens of thousands of queued tasks.
 *
 * @param options Concurrency configuration options
 */
export function createLimiter(options: ConcurrencyOptions | number): ConcurrencyLimiter {
  const config: ConcurrencyOptions =
    typeof options === "number" ? { concurrency: options } : options;

  const concurrency = Math.max(1, Math.floor(config.concurrency));
  const maxQueueSize = config.queueSize;
  const limiterSignal = config.signal;

  let activeCount = 0;
  let queueLength = 0;
  let head: QueueNode | null = null;
  let tail: QueueNode | null = null;

  const removeNode = (node: QueueNode) => {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      tail = node.prev;
    }

    node.prev = null;
    node.next = null;
    queueLength--;

    if (node.signal && node.abortListener) {
      node.signal.removeEventListener("abort", node.abortListener);
    }
  };

  const dispatchNext = () => {
    if (activeCount >= concurrency || head === null) {
      return;
    }

    const nextNode = head;
    removeNode(nextNode);

    activeCount++;
    nextNode.run();
  };

  const clearQueue = (reason?: unknown) => {
    const error = reason !== undefined ? reason : new ConcurrencyError("Queue cleared by limiter");

    let current = head;
    while (current !== null) {
      const next = current.next;
      if (current.signal && current.abortListener) {
        current.signal.removeEventListener("abort", current.abortListener);
      }
      current.prev = null;
      current.next = null;
      current.reject(error);
      current = next;
    }

    head = null;
    tail = null;
    queueLength = 0;
  };

  if (limiterSignal) {
    if (limiterSignal.aborted) {
      clearQueue(toAbortError(limiterSignal));
    } else {
      limiterSignal.addEventListener(
        "abort",
        () => {
          clearQueue(toAbortError(limiterSignal));
        },
        { once: true },
      );
    }
  }

  const run = <T>(
    task: () => T | Promise<T>,
    runOptions?: { signal?: AbortSignal },
  ): Promise<T> => {
    const taskSignal = runOptions?.signal;

    // Immediate check
    throwIfAborted(limiterSignal);
    throwIfAborted(taskSignal);

    if (maxQueueSize !== undefined && queueLength >= maxQueueSize) {
      return Promise.reject(
        new ConcurrencyError(`Concurrency queue limit of ${maxQueueSize} exceeded`, {
          queueSize: maxQueueSize,
        }),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const executeTask = () => {
        let isDone = false;
        const settle = () => {
          if (!isDone) {
            isDone = true;
            activeCount--;
            dispatchNext();
          }
        };

        try {
          const resultPromise = Promise.resolve().then(() => task());
          resultPromise.then(
            (val) => {
              settle();
              resolve(val);
            },
            (err) => {
              settle();
              reject(err);
            },
          );
        } catch (syncErr) {
          settle();
          reject(syncErr);
        }
      };

      if (activeCount < concurrency) {
        activeCount++;
        executeTask();
        return;
      }

      // Enqueue in doubly-linked list
      const node: QueueNode = {
        run: executeTask,
        reject,
        signal: taskSignal,
        prev: tail,
        next: null,
      };

      if (taskSignal) {
        const onTaskAbort = () => {
          removeNode(node);
          reject(toAbortError(taskSignal));
        };
        node.abortListener = onTaskAbort;
        taskSignal.addEventListener("abort", onTaskAbort, { once: true });
      }

      if (tail) {
        tail.next = node;
        tail = node;
      } else {
        head = node;
        tail = node;
      }
      queueLength++;
    });
  };

  return {
    run,
    get activeCount() {
      return activeCount;
    },
    get pendingCount() {
      return queueLength;
    },
    get concurrency() {
      return concurrency;
    },
    clearQueue,
  };
}

/**
 * Wraps an async or sync function to limit its concurrent executions.
 *
 * Returns a guarded function with identical argument and return types,
 * exposing `.activeCount`, `.pendingCount`, `.concurrency`, and `.clearQueue()`.
 *
 * @param fn The function to guard
 * @param options Concurrency configuration options or a concurrency limit number
 */
export function limitConcurrency<Args extends unknown[], Return>(
  fn: (...args: Args) => Return | Promise<Return>,
  options: ConcurrencyOptions | number,
): GuardedFunction<Args, Return> {
  const limiter = createLimiter(options);

  const guarded = function (...args: Args): Promise<Return> {
    return limiter.run(() => fn(...args));
  };

  Object.defineProperties(guarded, {
    activeCount: {
      get: () => limiter.activeCount,
      enumerable: true,
    },
    pendingCount: {
      get: () => limiter.pendingCount,
      enumerable: true,
    },
    concurrency: {
      get: () => limiter.concurrency,
      enumerable: true,
    },
    clearQueue: {
      value: (reason?: unknown) => limiter.clearQueue(reason),
      enumerable: true,
      writable: false,
    },
  });

  return guarded as GuardedFunction<Args, Return>;
}
