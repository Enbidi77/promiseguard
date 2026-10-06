import { describe, expect, it, vi } from "vitest";
import { retry, RetryError, calculateDelay } from "../src/index.js";

describe("retry", () => {
  it("resolves immediately on initial attempt success", async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls++;
        return "immediate";
      },
      { retries: 3 },
    );

    expect(result).toBe("immediate");
    expect(calls).toBe(1);
  });

  it("eventually succeeds after transient failures", async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls++;
        if (calls < 3) {
          throw new Error(`Attempt ${calls} failed`);
        }
        return `success on ${calls}`;
      },
      { retries: 3, minDelay: 1 },
    );

    expect(result).toBe("success on 3");
    expect(calls).toBe(3);
  });

  it("fails after exhausting configured retries", async () => {
    let calls = 0;
    const testError = new Error("Permanent server error");

    await expect(
      retry(
        () => {
          calls++;
          throw testError;
        },
        { retries: 2, minDelay: 1 },
      ),
    ).rejects.toThrow(RetryError);

    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("respects attempts parameter over retries if provided", async () => {
    let calls = 0;
    await expect(
      retry(
        () => {
          calls++;
          throw new Error("fail");
        },
        { attempts: 2, retries: 10, minDelay: 1 },
      ),
    ).rejects.toThrow(RetryError);

    expect(calls).toBe(2);
  });

  it("respects shouldRetry predicate returning false", async () => {
    let calls = 0;
    class FatalError extends Error {}
    class RetryableError extends Error {}

    await expect(
      retry(
        () => {
          calls++;
          if (calls === 1) {
            throw new RetryableError("transient");
          }
          throw new FatalError("fatal");
        },
        {
          retries: 5,
          minDelay: 1,
          shouldRetry: (err) => err instanceof RetryableError,
        },
      ),
    ).rejects.toThrow(RetryError);

    expect(calls).toBe(2); // Retried once on RetryableError, stopped on FatalError
  });

  it("supports asynchronous shouldRetry predicates", async () => {
    let calls = 0;

    await expect(
      retry(
        () => {
          calls++;
          throw new Error("err");
        },
        {
          retries: 3,
          minDelay: 1,
          shouldRetry: async (_err, attempt) => {
            return attempt < 2; // only retry attempt 1
          },
        },
      ),
    ).rejects.toThrow(RetryError);

    expect(calls).toBe(2);
  });

  it("supports custom backoff strategy function", async () => {
    const delaySpy = vi.fn().mockReturnValue(1);
    let calls = 0;

    await expect(
      retry(
        () => {
          calls++;
          throw new Error("error");
        },
        {
          retries: 2,
          backoff: delaySpy,
        },
      ),
    ).rejects.toThrow(RetryError);

    expect(calls).toBe(3);
    expect(delaySpy).toHaveBeenCalledWith(1, expect.any(Error));
    expect(delaySpy).toHaveBeenCalledWith(2, expect.any(Error));
  });
});

describe("calculateDelay", () => {
  it("calculates exponential backoff deterministically when jitter is false", () => {
    // attempt 1 (1st retry): minDelay * (2 ^ 0) = 100
    expect(calculateDelay({ attempt: 1, error: null, minDelay: 100, factor: 2 })).toBe(100);
    // attempt 2 (2nd retry): 100 * (2 ^ 1) = 200
    expect(calculateDelay({ attempt: 2, error: null, minDelay: 100, factor: 2 })).toBe(200);
    // attempt 3: 100 * (2 ^ 2) = 400
    expect(calculateDelay({ attempt: 3, error: null, minDelay: 100, factor: 2 })).toBe(400);
    // attempt 4: 100 * (2 ^ 3) = 800
    expect(calculateDelay({ attempt: 4, error: null, minDelay: 100, factor: 2 })).toBe(800);
  });

  it("clamps delay to maxDelay", () => {
    const delay = calculateDelay({
      attempt: 10,
      error: null,
      minDelay: 1000,
      factor: 2,
      maxDelay: 5000,
    });
    expect(delay).toBe(5000);
  });

  it("calculates fixed backoff", () => {
    expect(calculateDelay({ attempt: 1, error: null, strategy: "fixed", minDelay: 500 })).toBe(500);
    expect(calculateDelay({ attempt: 5, error: null, strategy: "fixed", minDelay: 500 })).toBe(500);
  });

  it("applies full jitter within [0, delay] bounds", () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateDelay({
        attempt: 3,
        error: null,
        minDelay: 100,
        factor: 2,
        jitter: true,
      });
      // max is 400
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });

  it("applies equal jitter within [delay/2, delay] bounds", () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateDelay({
        attempt: 3,
        error: null,
        minDelay: 100,
        factor: 2,
        jitter: "equal",
      });
      // 400: half is 200, jittered between 200 and 400
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });
});
