import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeout, TimeoutError, AbortError } from "../src/index.js";

describe("timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves normally when operation finishes before timeout", async () => {
    const promise = timeout(async () => {
      await vi.advanceTimersByTimeAsync(50);
      return "success";
    }, 100);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("throws TimeoutError when operation exceeds timeout limit", async () => {
    const promise = timeout(async () => {
      await vi.advanceTimersByTimeAsync(200);
      return "never";
    }, 100);

    await expect(promise).rejects.toThrow(TimeoutError);
  });

  it("populates TimeoutError with accurate metadata", async () => {
    const promise = timeout(
      async () => {
        await vi.advanceTimersByTimeAsync(500);
      },
      { ms: 100, message: "Custom timeout msg" },
    );

    try {
      await promise;
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const timeoutErr = err as TimeoutError;
      expect(timeoutErr.timeout).toBe(100);
      expect(timeoutErr.message).toBe("Custom timeout msg");
      expect(timeoutErr.scope).toBe("attempt");
      expect(timeoutErr.attempt).toBe(1);
    }
  });

  it("aborts the context AbortSignal when timeout triggers", async () => {
    let wasAborted = false;
    let abortReason: unknown;

    const promise = timeout(async ({ signal }) => {
      signal.addEventListener("abort", () => {
        wasAborted = true;
        abortReason = signal.reason;
      });
      await vi.advanceTimersByTimeAsync(200);
      return "late";
    }, 50);

    await expect(promise).rejects.toThrow(TimeoutError);
    expect(wasAborted).toBe(true);
    expect(abortReason).toBeInstanceOf(TimeoutError);
  });

  it("throws AbortError immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("already done");

    let executed = false;
    const promise = timeout(
      () => {
        executed = true;
        return "val";
      },
      { ms: 100, signal: controller.signal },
    );

    await expect(promise).rejects.toThrow(AbortError);
    expect(executed).toBe(false);
  });

  it("supports fallback value on timeout", async () => {
    const promise = timeout(
      async () => {
        await vi.advanceTimersByTimeAsync(300);
        return "slow";
      },
      { ms: 100, fallback: "cached-data" },
    );

    const result = await promise;
    expect(result).toBe("cached-data");
  });

  it("supports fallback function on timeout", async () => {
    const promise = timeout(
      async () => {
        await vi.advanceTimersByTimeAsync(300);
        return "slow";
      },
      { ms: 100, fallback: () => "fallback-from-function" },
    );

    const result = await promise;
    expect(result).toBe("fallback-from-function");
  });

  it("executes without timeout restriction if ms <= 0", async () => {
    const result = await timeout(async () => {
      await vi.advanceTimersByTimeAsync(50);
      return "unconstrained";
    }, 0);

    expect(result).toBe("unconstrained");
  });
});
