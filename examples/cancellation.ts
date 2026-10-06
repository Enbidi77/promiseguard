import { execute, limitConcurrency, isAbortError } from "../src/index.js";

async function main() {
  console.log("=== Cancellation with AbortSignal Example ===");

  // 1. Cancelling an active execution mid-flight
  const controller = new AbortController();

  setTimeout(() => {
    console.log("  -> User clicked 'Cancel' button!");
    controller.abort("User cancelled export job");
  }, 150);

  try {
    await execute(
      async ({ signal }) => {
        console.log("Starting long export task...");
        for (let step = 1; step <= 5; step++) {
          if (signal.aborted) {
            throw new Error("Aborted early");
          }
          console.log(`  Processing step ${step}/5...`);
          await new Promise((res) => setTimeout(res, 100));
        }
        return "Export complete";
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (isAbortError(err)) {
      console.log(`Task halted cleanly with AbortError: ${err.message}`);
      console.log(`Reason: ${err.reason}`);
    }
  }

  // 2. Cancelling pending items waiting in a concurrency queue
  console.log("\n=== Cancelling tasks waiting in queue ===");
  const guarded = limitConcurrency(
    async (name: string) => {
      await new Promise((res) => setTimeout(res, 100));
      return `Done ${name}`;
    },
    { concurrency: 1 },
  );

  const t1 = guarded("Job 1"); // executes immediately
  const t2 = guarded("Job 2"); // queued

  console.log(`Active: ${guarded.activeCount}, Pending: ${guarded.pendingCount}`);
  guarded.clearQueue("Cancelled all remaining jobs");

  try {
    await t2;
  } catch (err) {
    console.log("Job 2 rejected as expected because queue was cleared:", (err as Error).message);
  }

  const res1 = await t1;
  console.log("Job 1 finished:", res1);
}

main().catch(console.error);
