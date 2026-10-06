---
"promiseguard": major
---

Initial release of PromiseGuard: A lightweight, strongly typed async execution-control library for JavaScript and TypeScript.

Features:
- `execute`: unified async execution with retry, timeout, cancellation, fallback, and observability.
- `retry`: configurable retries with exponential/fixed backoff, jitter, and custom predicates.
- `timeout`: individual attempt timeouts and total execution timeouts with dedicated `TimeoutError`.
- `limitConcurrency`: high-performance concurrency limiter with $O(1)$ queue management, queue size limit, and live metrics.
- First-class `AbortSignal` cancellation support with zero memory leaks.
- Zero runtime dependencies, targeting modern Node.js, browsers, Bun, and Deno.
- Dual ESM and CommonJS exports with full TypeScript declaration maps.
