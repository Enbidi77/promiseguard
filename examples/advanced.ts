import { execute, limitConcurrency, isRetryError, isTimeoutError } from "../src/index.js";

interface ApiResponse<T> {
  data: T;
  source: string;
}

// Simulated unreliable remote microservices
async function fetchFromMicroservice(endpoint: string, signal: AbortSignal): Promise<string> {
  // Check if aborted
  if (signal.aborted) {
    throw new Error("Aborted");
  }

  // Simulate latency
  await new Promise((res) => setTimeout(res, 80));

  if (endpoint.includes("flaky")) {
    if (Math.random() > 0.4) {
      throw new Error(`502 Bad Gateway from ${endpoint}`);
    }
  }

  return `Payload from ${endpoint}`;
}

async function main() {
  console.log("=== Advanced Full Pipeline Composition ===");

  // Compose concurrency limiter with per-request execute (timeout + retry + backoff + jitter)
  const guardedRequest = limitConcurrency(
    async (endpoint: string): Promise<ApiResponse<string>> => {
      const data = await execute(({ signal }) => fetchFromMicroservice(endpoint, signal), {
        // 150ms per attempt, 500ms total execution deadline
        timeout: {
          attempt: 150,
          total: 500,
        },
        retry: {
          attempts: 3,
          backoff: "exponential",
          minDelay: 30,
          maxDelay: 200,
          jitter: true,
          shouldRetry: (err) => {
            // Retry 502 Bad Gateway errors
            return err instanceof Error && err.message.includes("502");
          },
        },
        // Observability metrics for this operation
        onRetry: (info) => {
          console.log(
            `  [Retry] ${endpoint} attempt ${info.attempt} failed. Backing off ${info.delay}ms`,
          );
        },
        onSuccess: (info) => {
          console.log(
            `  [Success] ${endpoint} completed on attempt ${info.attempt} in ${info.durationMs}ms`,
          );
        },
        onFailure: (info) => {
          if (!info.willRetry) {
            console.log(
              `  [Fatal Failure] ${endpoint} exhausted retries or hit non-retryable error`,
            );
          }
        },
        // Fallback if all attempts fail
        fallback: (err) => {
          console.log(
            `  [Fallback] Serving stale cache for ${endpoint} due to error: ${(err as Error).message}`,
          );
          return "cached-fallback-content";
        },
      });

      return {
        data,
        source: endpoint,
      };
    },
    {
      concurrency: 3, // At most 3 concurrent outbound requests
      queueSize: 100, // Maximum queued requests before rejecting
    },
  );

  const endpoints = [
    "service://users/flaky",
    "service://orders/flaky",
    "service://inventory/stable",
    "service://billing/flaky",
    "service://notifications/stable",
  ];

  console.log(
    `Dispatching ${endpoints.length} requests across pool of ${guardedRequest.concurrency}...`,
  );

  const results = await Promise.allSettled(endpoints.map((ep) => guardedRequest(ep)));

  console.log("\nExecution Summary:");
  results.forEach((res, idx) => {
    const ep = endpoints[idx];
    if (res.status === "fulfilled") {
      console.log(`  ✓ ${ep}: ${res.value.data}`);
    } else {
      if (isRetryError(res.reason)) {
        console.log(`  ✗ ${ep}: RetryError after ${res.reason.attempts} attempts`);
      } else if (isTimeoutError(res.reason)) {
        console.log(`  ✗ ${ep}: TimeoutError (${res.reason.scope})`);
      } else {
        console.log(`  ✗ ${ep}: Failed with ${res.reason}`);
      }
    }
  });
}

main().catch(console.error);
