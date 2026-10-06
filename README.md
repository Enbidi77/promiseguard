# PromiseGuard 🛡️

[![CI](https://github.com/promiseguard/promiseguard/actions/workflows/ci.yml/badge.svg)](https://github.com/promiseguard/promiseguard/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/promiseguard.svg)](https://www.npmjs.com/package/promiseguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)]()

> A lightweight, strongly typed async execution-control library for modern JavaScript and TypeScript with retries, timeouts, cancellation, concurrency limiting, and observability.

---

## Table of Contents

- [The Problem](#the-problem)
- [Why Use PromiseGuard?](#why-use-promiseguard)
- [How Does It Compare to Existing Utilities?](#how-does-it-compare-to-existing-utilities)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts & Semantics](#core-concepts--semantics)
  - [1. Timeout Semantics: Attempt vs. Total](#1-timeout-semantics-attempt-vs-total)
  - [2. Retry Semantics: Attempts vs. Retries](#2-retry-semantics-attempts-vs-retries)
  - [3. Cancellation & AbortSignal](#3-cancellation--abortsignal)
  - [4. High-Performance Concurrency Limiter](#4-high-performance-concurrency-limiter)
  - [5. Observability Hooks](#5-observability-hooks)
- [API Reference](#api-reference)
  - [`execute(operation, options)`](#executeoperation-options)
  - [`retry(operation, options)`](#retryoperation-options)
  - [`timeout(operation, optionsOrMs)`](#timeoutoperation-optionsorms)
  - [`limitConcurrency(fn, options)`](#limitconcurrencyfn-options)
  - [`createLimiter(options)`](#createlimiteroptions)
  - [`calculateDelay(options)`](#calculatedelayoptions)
- [Error Classes & Type Guards](#error-classes--type-guards)
- [Composition Recipes](#composition-recipes)
- [Runtime Compatibility](#runtime-compatibility)
- [License](#license)

---

## The Problem

Executing asynchronous operations reliably in production is surprisingly error-prone. In real-world software, network requests, database transactions, and background jobs fail in unpredictable ways:
- Remote endpoints drop connections or respond with transient 502/503 errors.
- Unresponsive servers cause requests to hang indefinitely, depleting socket pools.
- Concurrent workers overwhelm backend services or hit external rate limits.
- Tasks cancelled by users leave orphaned timers and memory-leaking event listeners.

When developers attempt to solve these issues by stitching together separate one-off libraries (like `p-limit`, `p-retry`, and `p-timeout`), they frequently encounter awkward edge cases:
- *Does the timeout abort each retry attempt, or the entire operation?*
- *When an external `AbortSignal` fires, does the sleep timer between retries wake up immediately, or does it hang until the delay expires?*
- *When a queued concurrency task is aborted, is it removed immediately in $O(1)$ time, or does it stay queued and cause memory leaks?*
- *When retries are exhausted, is the original error's stack trace preserved?*

---

## Why Use PromiseGuard?

**PromiseGuard** provides a cohesive, unified async execution engine that treats timeouts, retries, backoff, cancellation, concurrency, and observability as first-class composable primitives:

1. **Zero Runtime Dependencies**: Built entirely on standard JavaScript / Web platform APIs (`AbortController`, `AbortSignal`, `Promise`, `setTimeout`). Tiny footprint in your bundle.
2. **TypeScript-First**: Precise generic inference. Return types of sync and async functions are preserved without requiring redundant generic type parameters.
3. **No Timer or Listener Leaks**: Every timer and signal listener is strictly cleaned up upon promise settlement, even during mid-flight cancellation.
4. **Predictable Semantics**: Clearly defined behavior for per-attempt timeouts, total deadlines, jittered backoff, and queued cancellations.
5. **$O(1)$ Concurrency Limiter**: Backed by an internal doubly-linked queue capable of handling thousands of queued operations without $O(N^2)$ array shifts or memory retention.

---

## How Does It Compare to Existing Utilities?

| Feature | `p-limit` + `p-retry` + `p-timeout` | Polly.js / Cockatiel | **PromiseGuard** |
| :--- | :---: | :---: | :---: |
| **Dependencies** | Multiple disjoint packages | Heavy policy builder | **Zero dependencies** |
| **Per-attempt vs. Total Timeout** | Manual coordination required | Verbose policy wrapping | **Built-in (`timeout.attempt`, `timeout.total`)** |
| **Cancel Backoff Sleep** | Often hangs until timer expires | Complex | **Immediate cancellation via AbortSignal** |
| **Concurrency Queue Performance** | $O(N)$ `Array.shift()` | Varies | **Strict $O(1)$ Doubly-Linked Queue** |
| **TypeScript Inference** | Fragmented types | Complex policy types | **Direct, transparent type inference** |
| **Error Metadata** | Strings or generic Error | Custom policy errors | **Typed `RetryError`, `TimeoutError`, `AbortError` with causes** |

---

## Installation

```bash
# Using npm
npm install promiseguard

# Using pnpm
pnpm add promiseguard

# Using yarn
yarn add promiseguard

# Using bun
bun add promiseguard
```

> **Note on Package Name**: The package is published on npm as **`promiseguard`** (as the dormant 2015 `promise-guard` package name was previously taken on npm).

---

## Quick Start

```ts
import { execute, retry, timeout, limitConcurrency } from "promiseguard";

// 1. Unified execution with timeout and exponential retry
const user = await execute(
  async ({ signal }) => {
    const res = await fetch("https://api.example.com/users/42", { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  {
    timeout: 5000, // 5s per attempt
    retry: {
      retries: 3,
      backoff: "exponential",
      jitter: true,
    },
  }
);

// 2. Focused retry with custom predicate
const data = await retry(
  () => fetchUnstableData(),
  {
    retries: 3,
    shouldRetry: (err) => err instanceof NetworkError,
  }
);

// 3. Standalone timeout with fallback
const cached = await timeout(
  () => fetchSlowReport(),
  {
    ms: 3000,
    fallback: "default-report-cache",
  }
);

// 4. Concurrency-limited function
const guardedFetch = limitConcurrency(
  async (id: string) => fetch(`/items/${id}`),
  { concurrency: 5 }
);

const items = await Promise.all(ids.map((id) => guardedFetch(id)));
```

---

## Core Concepts & Semantics

### 1. Timeout Semantics: Attempt vs. Total

A common pitfall with timeouts is ambiguity: Does a 5-second timeout limit an individual network request, or does it limit the entire 3-retry sequence?

In PromiseGuard, the semantics are explicit and unambiguous:
- **`timeout: 5000` (number)**: Applied **per attempt**. If attempt 1 hangs for 5 seconds, it times out with a `TimeoutError (scope: "attempt")`. If retries remain, attempt 2 will begin with a fresh 5-second window.
- **`timeout: { attempt: 3000, total: 10000 }` (object)**:
  - Each attempt is capped at 3 seconds.
  - The overall execution (including all attempts and backoff sleep delays) has a hard deadline of 10 seconds.
  - If the `total` deadline expires, execution halts immediately and throws `TimeoutError (scope: "total")`. It will **never** retry after a total timeout.

### 2. Retry Semantics: Attempts vs. Retries

- **`retries: 3`**: Allows 1 initial attempt + 3 retries = **up to 4 total attempts**.
- **`attempts: 3`**: Caps the execution at **3 total attempts** (1 initial attempt + 2 retries).
- If both are provided, `attempts` takes precedence.

#### Backoff Strategies
- `"exponential"` (default): `minDelay * (factor ^ (attempt - 1))`. Default `factor: 2`, `minDelay: 100ms`, `maxDelay: 30000ms`.
- `"fixed"`: Constant delay equal to `minDelay`.
- Custom function: `(attempt: number, error: unknown) => number`.

#### Jitter
Synchronized retries can cause downstream servers to crash in a "thundering herd." PromiseGuard provides built-in jitter:
- `jitter: false` (default): 100% deterministic backoff delay.
- `jitter: true` (or `"full"`): Full jitter randomized uniformly between `0` and calculated backoff delay.
- `jitter: "equal"`: Half fixed, half randomized: `(delay / 2) + Math.random() * (delay / 2)`.

### 3. Cancellation & AbortSignal

Cancellation in PromiseGuard conforms to standard Web platform `AbortSignal` semantics:
- **Immediate Rejection**: If `signal.aborted === true` when an operation is invoked, it rejects immediately with an `AbortError` without running any code.
- **Mid-Flight Abortion**: When an external signal aborts while an operation is in progress, the attempt context's `signal` aborts, triggering cancellation in underlying libraries (such as `fetch`).
- **Sleep Interruption**: If an abort occurs while PromiseGuard is sleeping during a backoff delay, the sleep timer is cleared immediately, waking up and rejecting without lingering in the event loop.
- **No Retries on Abort**: An aborted operation is **never** retried.

### 4. High-Performance Concurrency Limiter

The `limitConcurrency` and `createLimiter` functions provide concurrency regulation with:
- **$O(1)$ Queue**: Uses an internal doubly-linked queue so adding, removing, and dequeuing tasks takes strictly $O(1)$ operations regardless of queue size.
- **Queue Bounds**: Configure `queueSize` to prevent memory exhaustion. If the waiting queue exceeds this limit, calling the guarded function rejects immediately with a `ConcurrencyError`.
- **Live Metrics**: Inspect `.activeCount`, `.pendingCount`, and `.concurrency` at any time.
- **Cancellation**: Queued tasks can be cancelled individually via their own `AbortSignal` or collectively via `limiter.clearQueue()`.

### 5. Observability Hooks

Inspect the execution lifecycle without adding heavy APM or logging dependencies:
- `onStart({ attempt })`
- `onRetry({ attempt, maxAttempts, error, delay })`
- `onSuccess({ attempt, result, durationMs, totalDurationMs })`
- `onFailure({ attempt, error, durationMs, totalDurationMs, willRetry })`

All hooks are executed safely. If a user-provided hook throws an error, the exception is swallowed so your application's core workflow is never interrupted.

---

## API Reference

### `execute(operation, options)`

Executes an asynchronous or synchronous function with retries, timeouts, cancellation, and lifecycle hooks.

```ts
function execute<T>(
  operation: (context: ExecutionContext) => T | Promise<T>,
  options?: ExecuteOptions<T>
): Promise<T>
```

#### Parameters:
- `operation`: Function to execute. Receives `context: ExecutionContext`:
  - `context.signal`: Dedicated `AbortSignal` for this attempt.
  - `context.attempt`: Current attempt number (1-based).
  - `context.remainingAttempts`: Number of retries remaining.
- `options`:
  - `timeout?: number | { attempt?: number; total?: number }`
  - `retry?: number | RetryConfig`
  - `signal?: AbortSignal`
  - `wrapError?: boolean` (default: `true` when multiple attempts configured)
  - `fallback?: T | ((error: unknown) => T | Promise<T>)`
  - `onStart?, onRetry?, onSuccess?, onFailure?`

---

### `retry(operation, options)`

Convenience wrapper around `execute` focused on retry logic.

```ts
function retry<T>(
  operation: (context: ExecutionContext) => T | Promise<T>,
  options?: RetryOptions<T>
): Promise<T>
```

---

### `timeout(operation, optionsOrMs)`

Guards an operation with a timeout limit.

```ts
function timeout<T>(
  operation: (context: { signal: AbortSignal }) => T | Promise<T>,
  optionsOrMs: number | TimeoutOptions<T>
): Promise<T>
```

#### Parameters:
- `operation`: Function to execute. Receives `{ signal }`.
- `optionsOrMs`: Duration in milliseconds, or `TimeoutOptions`:
  - `ms?: number`: Timeout in milliseconds.
  - `signal?: AbortSignal`: External signal to combine with the timeout.
  - `message?: string`: Custom message for `TimeoutError`.
  - `fallback?: T | (() => T | Promise<T>)`: Value or function returned if timeout occurs.

---

### `limitConcurrency(fn, options)`

Wraps an async or sync function to restrict concurrent invocations.

```ts
function limitConcurrency<Args extends unknown[], Return>(
  fn: (...args: Args) => Return | Promise<Return>,
  options: ConcurrencyOptions | number
): GuardedFunction<Args, Return>
```

#### Returned Guarded Function Properties:
- `(...args): Promise<Return>`: Invoke guarded function.
- `.activeCount`: Number of currently running executions.
- `.pendingCount`: Number of queued executions waiting in line.
- `.concurrency`: The configured concurrency limit.
- `.clearQueue(reason?)`: Cancel and reject all queued tasks.

---

### `createLimiter(options)`

Creates a standalone concurrency limiter instance.

```ts
const limiter = createLimiter({ concurrency: 5, queueSize: 100 });
const result = await limiter.run(() => task(), { signal });
```

---

### `calculateDelay(options)`

Calculates deterministic or jittered backoff delay for an attempt.

```ts
const delayMs = calculateDelay({
  attempt: 2,
  error: lastError,
  strategy: "exponential",
  minDelay: 100,
  maxDelay: 5000,
  factor: 2,
  jitter: false,
});
```

---

## Error Classes & Type Guards

PromiseGuard provides dedicated error classes that preserve error causes and metadata:

### `TimeoutError`
- `.timeout`: Configured timeout duration (ms).
- `.scope`: `"attempt"` or `"total"`.
- `.attempt`: Attempt number when timeout fired.

### `AbortError`
- `.reason`: The abort reason passed to `controller.abort(reason)`.

### `RetryError`
- `.attempts`: Total attempts executed.
- `.maxAttempts`: Maximum allowed attempts.
- `.lastError`: The final error encountered.
- `.elapsedMs`: Total elapsed time across all attempts.
- `.cause`: Same as `lastError` for standard `Error.cause` traversal.

### `ConcurrencyError`
- `.queueSize`: Max queue size if triggered by queue overflow.

### Type Guards
```ts
import {
  isPromiseGuardError,
  isTimeoutError,
  isAbortError,
  isRetryError,
  isConcurrencyError,
} from "promiseguard";

try {
  await execute(...);
} catch (err) {
  if (isTimeoutError(err)) {
    console.log(`Timed out after ${err.timeout}ms in ${err.scope} scope`);
  } else if (isRetryError(err)) {
    console.log(`Exhausted all ${err.attempts} attempts. Last error:`, err.lastError);
  }
}
```

---

## Composition Recipes

### Rate-Limited Outbound HTTP Requests with Exponential Retries

```ts
import { limitConcurrency, execute } from "promiseguard";

const fetchWithGuards = limitConcurrency(
  async (url: string) => {
    return execute(
      ({ signal }) => fetch(url, { signal }),
      {
        timeout: {
          attempt: 5_000,  // 5s per request attempt
          total: 20_000,   // 20s total deadline
        },
        retry: {
          retries: 3,
          backoff: "exponential",
          minDelay: 200,
          maxDelay: 5_000,
          jitter: true,
          shouldRetry: (err) => {
            // Do not retry 4xx client errors
            return !(err instanceof ResponseError && err.status < 500);
          },
        },
      }
    );
  },
  {
    concurrency: 10,
    queueSize: 500,
  }
);
```

---

## Runtime Compatibility

PromiseGuard relies exclusively on standard ECMAScript and Web Platform specifications:
- **Node.js**: `>= 18.0.0`
- **Browsers**: Chrome, Edge, Firefox, Safari (Evergreen)
- **Edge Runtimes**: Bun, Deno, Cloudflare Workers

Supports both **ES Modules (`import`)** and **CommonJS (`require`)**.

---

## License

[MIT](LICENSE) © 2026 PromiseGuard Contributors
