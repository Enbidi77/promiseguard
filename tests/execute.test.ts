import { describe, expect, it } from "vitest";
import { execute, RetryError } from "../src/index.js";

describe("execute", () => {
  it("executes a synchronous function returning a value", async () => {
    const result = await execute(() => 42);
    expect(result).toBe(42);
  });

  it("executes an asynchronous function resolving a value", async () => {
    const result = await execute(async () => {
      return { id: "user_123", name: "Alice" };
    });
    expect(result).toEqual({ id: "user_123", name: "Alice" });
  });

  it("propagates synchronous errors directly when no retries configured", async () => {
    const error = new Error("Sync boom");
    await expect(
      execute(() => {
        throw error;
      }),
    ).rejects.toThrow(error);
  });

  it("propagates asynchronous rejections directly when no retries configured", async () => {
    const error = new Error("Async boom");
    await expect(
      execute(async () => {
        throw error;
      }),
    ).rejects.toThrow(error);
  });

  it("passes ExecutionContext with attempt info and signal", async () => {
    let capturedAttempt = 0;
    let capturedRemaining = -1;
    let hasSignal = false;

    await execute((context) => {
      capturedAttempt = context.attempt;
      capturedRemaining = context.remainingAttempts;
      hasSignal = context.signal instanceof AbortSignal;
      return "ok";
    });

    expect(capturedAttempt).toBe(1);
    expect(capturedRemaining).toBe(0);
    expect(hasSignal).toBe(true);
  });

  it("uses fallback static value if operation fails", async () => {
    const result = await execute(
      () => {
        throw new Error("Failed");
      },
      { fallback: "fallback-value" },
    );
    expect(result).toBe("fallback-value");
  });

  it("uses fallback function with error argument if operation fails", async () => {
    const result = await execute(
      () => {
        throw new Error("Disk read failed");
      },
      {
        fallback: (err) => {
          return `Recovered from: ${(err as Error).message}`;
        },
      },
    );
    expect(result).toBe("Recovered from: Disk read failed");
  });

  it("throws RetryError with full metadata when wrapError is true and retries fail", async () => {
    let calls = 0;
    try {
      await execute(
        () => {
          calls++;
          throw new Error("Network drop");
        },
        { retry: { retries: 2, minDelay: 0 } },
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      const retryErr = err as RetryError;
      expect(retryErr.attempts).toBe(3); // 1 initial + 2 retries
      expect(retryErr.maxAttempts).toBe(3);
      expect((retryErr.lastError as Error).message).toBe("Network drop");
      expect(retryErr.cause).toBe(retryErr.lastError);
      expect(retryErr.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(calls).toBe(3);
  });

  it("throws raw error when wrapError is false even after multiple retries", async () => {
    const originalError = new Error("Raw error");
    await expect(
      execute(
        () => {
          throw originalError;
        },
        { retry: 2, wrapError: false },
      ),
    ).rejects.toThrow(originalError);
  });
});
