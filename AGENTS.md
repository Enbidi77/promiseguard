# AI Agent & Contributor Guidelines for PromiseGuard

This document establishes the architecture principles, API design boundaries, and engineering requirements for AI coding agents and human contributors working on `promiseguard`.

> **Guiding Principle**: Do not add functionality simply because it is technically possible. Every new public API must solve a demonstrated developer problem.
>
> **Stability Principle**: Maintain backwards compatibility unless the change intentionally introduces a major version.

---

## 1. Project Purpose

`promiseguard` is a lightweight, strongly typed async execution-control library for modern JavaScript and TypeScript.

Developers frequently struggle to coordinate retries, timeouts, cancellation, concurrency limitations, backoff delays, and observability hooks across async operations. Combining disparate libraries (e.g. `p-limit`, `p-retry`, `p-timeout`) often introduces subtle edge-case bugs:
- Timers leaking upon promise rejection or cancellation.
- Inability to distinguish between a per-attempt timeout and an overall operation deadline.
- Unhandled cancellation while asleep in a backoff delay.
- Memory leaks in unbounded task queues.
- Lost error context and stack traces.

`promiseguard` solves these problems by providing a unified, cohesive abstraction with zero runtime dependencies.

---

## 2. Architecture & Directory Layout

```text
src/
├── index.ts               # Public exports (functions, error classes, types)
├── execute.ts             # Core execution engine (unifies retries, timeouts, cancellation, hooks)
├── retry.ts               # Convenience wrapper for retry-centric operations
├── timeout.ts             # Standalone timeout execution helper
├── concurrency.ts         # High-performance O(1) doubly-linked concurrency limiter
├── backoff.ts             # Deterministic and jittered backoff delay calculations
├── errors.ts              # Custom Error classes and TypeScript type guards
├── types.ts               # Public interface and type definitions
└── internal/
    ├── abort.ts           # Leak-free AbortSignal linking and error transformations
    └── sleep.ts           # Cancelable timer cleanup utility
```

### Key Architectural Invariants:
1. **Core Engine**: `execute.ts` is the single source of truth for execution flow. `retry()` delegates directly to `execute()`.
2. **Internal Decoupling**: Code in `src/internal/` is strictly internal and never exposed in `src/index.ts`.
3. **Zero Runtime Dependencies**: The `dependencies` object in `package.json` must remain empty `{}`. Standard Web/JavaScript APIs (`Promise`, `AbortController`, `AbortSignal`, `setTimeout`, `clearTimeout`, `performance.now`) must be utilized.

---

## 3. Public API Rules

1. **Explicit Exports**: Only export intentional public primitives from `src/index.ts`.
2. **Type Inference**: Never force users into awkward explicit generic type parameters. `execute(async () => ({ id: 1 }))` must naturally infer `{ id: number }`.
3. **Synchronous & Asynchronous Support**: Execution functions must support synchronous return values as well as promises without unhandled promise rejections.
4. **Error Classes**: Never throw raw strings or generic untyped errors. Use:
   - `TimeoutError` (with `.timeout`, `.scope`, `.attempt`)
   - `AbortError` (with `.reason`)
   - `RetryError` (with `.attempts`, `.maxAttempts`, `.lastError`, `.elapsedMs`, `.cause`)
   - `ConcurrencyError` (with `.queueSize`)
5. **Semantic Integrity**:
   - `timeout: number` defaults to per-attempt timeout.
   - `timeout: { attempt?: number, total?: number }` allows setting per-attempt and total execution limits simultaneously.
   - `retries: 3` means up to 1 initial attempt + 3 retries = 4 total attempts.
   - `attempts: 3` means at most 3 total attempts (1 initial + 2 retries).
   - `signal.aborted === true` on entry must fail immediately without initiating the operation.
   - Cancellation during backoff delay must wake up immediately and reject with `AbortError`.

---

## 4. Coding Standards

- **Strict TypeScript**: `noImplicitAny: true`, `strictNullChecks: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
- **No `any`**: Use `unknown`, generic parameters, or explicit structural types.
- **Leak-Free Event Listeners**: Always pair `addEventListener("abort", ...)` with corresponding `removeEventListener` or `{ once: true }`. Timers created via `setTimeout` must always be cleared upon promise settlement.
- **NodeNext / ESM**: All relative internal imports must include `.js` extensions (e.g. `import { sleep } from "./internal/sleep.js"`).

---

## 5. Testing Requirements

- **Framework**: Vitest.
- **Coverage**:
  - Every public API and error class must be thoroughly tested.
  - Test edge cases: synchronous throws, asynchronous rejections, already-aborted signals, aborted delays, queue overflow, `concurrency: 1`, high volume ($N > 3000$).
  - Time-dependent tests must utilize `vi.useFakeTimers()` to execute deterministically in milliseconds without real-world latency.
- **Quality Gate**: `pnpm check` must pass cleanly before any code can be committed or released.

---

## 6. Compatibility & Platform Targets

`promiseguard` targets modern ECMAScript environments:
- **Node.js**: `>= 18.0.0`
- **Browsers**: Modern evergreen browsers (Chrome, Edge, Firefox, Safari)
- **Runtimes**: Bun, Deno, Cloudflare Workers

Do not introduce Node-specific modules (e.g. `node:fs`, `node:stream`, `node:child_process`) into runtime code.

---

## 7. Performance Considerations

- **Queue Complexity**: Concurrency queue operations (enqueue, dequeue, cancel) must remain strictly $O(1)$. Do not use `Array.shift()` or `Array.splice()` on large task arrays.
- **Allocation Efficiency**: Avoid creating unnecessary promise wrappers or closures within tight loops.
- **Deterministic Delays**: When `jitter: false`, backoff calculations must be 100% deterministic and mathematically predictable.

---

## 8. Release Process

1. Every user-facing change must include a changeset generated via `pnpm changeset`.
2. Versioning follows Semantic Versioning (SemVer).
3. Releases are managed through Changesets and published using GitHub Actions with npm Trusted Publishing / OIDC provenance.
