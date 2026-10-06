import { execute } from "../src/index.js";

async function main() {
  console.log("=== Basic Execution Example ===");

  // 1. Strongly typed async execution
  const user = await execute(async () => {
    return { id: "user_42", name: "Alice", role: "admin" };
  });
  console.log("Fetched user:", user);

  // 2. Synchronous function execution
  const calculation = await execute(() => {
    return 10 * 42;
  });
  console.log("Calculation:", calculation);

  // 3. Fallback on error
  const safeData = await execute(
    () => {
      throw new Error("Service temporarily offline");
    },
    {
      fallback: { id: "guest", name: "Guest User", role: "viewer" },
    },
  );
  console.log("Safe data with fallback:", safeData);

  // 4. Execution context with attempt info
  await execute((ctx) => {
    console.log(`Current attempt: ${ctx.attempt}, remaining: ${ctx.remainingAttempts}`);
    return "done";
  });
}

main().catch(console.error);
