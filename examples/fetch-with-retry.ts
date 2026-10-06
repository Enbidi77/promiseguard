import { retry } from "../src/index.js";

// Simulated HTTP Error with status code
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Simulated network request that fails twice with 503 before succeeding
let attemptCounter = 0;
async function mockFetch(
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; data: string }> {
  attemptCounter++;
  console.log(`[HTTP GET] ${url} (attempt ${attemptCounter})`);

  // Check cancellation
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  // Simulate network latency
  await new Promise((res) => setTimeout(res, 50));

  if (attemptCounter < 3) {
    throw new HttpError(503, "Service Unavailable (transient gateway error)");
  }

  return { status: 200, data: `Payload from ${url}` };
}

async function main() {
  console.log("=== Fetch with Retry Example ===");

  const response = await retry(
    ({ signal }) => mockFetch("https://api.example.com/orders", signal),
    {
      retries: 4,
      backoff: "exponential",
      minDelay: 50,
      maxDelay: 1000,
      jitter: true,
      shouldRetry(error, attempt) {
        // Only retry on network errors or 5xx server errors
        if (error instanceof HttpError) {
          const isServerErr = error.status >= 500 && error.status < 600;
          console.log(
            `  -> Attempt ${attempt} failed with ${error.status}. Retryable: ${isServerErr}`,
          );
          return isServerErr;
        }
        return false;
      },
      onRetry(info) {
        console.log(
          `  [Hook: onRetry] Attempt ${info.attempt} failed. Retrying in ${info.delay}ms...`,
        );
      },
      onSuccess(info) {
        console.log(
          `  [Hook: onSuccess] Succeeded on attempt ${info.attempt} in ${info.durationMs}ms`,
        );
      },
    },
  );

  console.log("Final Response:", response);
}

main().catch(console.error);
