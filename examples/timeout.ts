import { timeout, execute, TimeoutError } from "../src/index.js";

async function slowDatabaseQuery(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve("Result from slow query");
    }, 2000);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      console.log("  -> slowDatabaseQuery aborted by signal!");
      reject(signal.reason);
    });
  });
}

async function main() {
  console.log("=== Timeout Handling Examples ===");

  // 1. Simple standalone timeout
  try {
    console.log("Running standalone timeout (500ms limit)...");
    await timeout(({ signal }) => slowDatabaseQuery(signal), 500);
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.log(`Caught expected TimeoutError: ${err.message}`);
      console.log(`  Timeout duration: ${err.timeout}ms, Scope: ${err.scope}`);
    }
  }

  // 2. Standalone timeout with fallback
  console.log("\nRunning timeout with fallback cache...");
  const cached = await timeout(({ signal }) => slowDatabaseQuery(signal), {
    ms: 200,
    fallback: "cached-fallback-response",
  });
  console.log("Received data:", cached);

  // 3. Execution with attempt-level timeout and total timeout
  console.log("\nRunning execute with per-attempt and total timeouts...");
  let attempt = 0;
  try {
    await execute(
      async () => {
        attempt++;
        console.log(`  Attempt ${attempt} starting...`);
        await new Promise((res) => setTimeout(res, 300));
        throw new Error("Temporary failure");
      },
      {
        timeout: {
          attempt: 400, // per attempt
          total: 800, // total across all retries
        },
        retry: {
          retries: 5,
          minDelay: 100,
        },
      },
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.log(`Halted by: ${err.name} - ${err.message} (Scope: ${err.scope})`);
    }
  }
}

main().catch(console.error);
