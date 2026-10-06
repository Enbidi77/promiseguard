import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute, AbortError, retry } from "../src/index.js";

describe("cancellation and AbortSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects immediately with AbortError if signal is already aborted on entry", async () => {
    const controller = new AbortController();
    controller.abort("User cancelled before start");

    let executed = false;
    const promise = execute(
      () => {
        executed = true;
        return "not reached";
      },
      { signal: controller.signal },
    );

    await expect(promise).rejects.toThrow(AbortError);
    expect(executed).toBe(false);
  });

  it("aborts active execution when signal triggers mid-flight", async () => {
    const controller = new AbortController();
    let wasAbortedInContext = false;

    const promise = execute(
      async ({ signal }) => {
        signal.addEventListener("abort", () => {
          wasAbortedInContext = true;
        });
        await vi.advanceTimersByTimeAsync(500);
        return "done";
      },
      { signal: controller.signal },
    );

    // Abort midway through execution
    await vi.advanceTimersByTimeAsync(100);
    controller.abort("Stop now");

    await expect(promise).rejects.toThrow(AbortError);
    expect(wasAbortedInContext).toBe(true);
  });

  it("aborts immediately during retry backoff delay without waiting", async () => {
    const controller = new AbortController();
    let attempts = 0;

    const promise = retry(
      () => {
        attempts++;
        throw new Error("fail");
      },
      {
        retries: 5,
        minDelay: 10_000, // 10s backoff sleep
        signal: controller.signal,
      },
    );

    // Initial attempt runs and fails, now sleeping
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);

    // Abort while sleeping
    controller.abort("cancel while sleeping");

    await expect(promise).rejects.toThrow(AbortError);
    // Did not wait 10s and did not execute attempt 2
    expect(attempts).toBe(1);
  });

  it("never retries an AbortError", async () => {
    let attempts = 0;
    const controller = new AbortController();

    const promise = retry(
      () => {
        attempts++;
        controller.abort();
        throw new AbortError("explicit abort");
      },
      {
        retries: 5,
        minDelay: 1,
        signal: controller.signal,
      },
    );

    await expect(promise).rejects.toThrow(AbortError);
    expect(attempts).toBe(1);
  });
});
