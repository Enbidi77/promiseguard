import { describe, expect, it } from "vitest";
import { execute, limitConcurrency, TimeoutError, RetryError } from "../src/index.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("composition", () => {
  it("retries an operation when an individual attempt times out", async () => {
    let attempts = 0;

    const result = await execute(
      async () => {
        attempts++;
        if (attempts === 1) {
          // Attempt 1 takes 60ms, but timeout is 25ms
          await delay(60);
          return "slow";
        }
        // Attempt 2 succeeds quickly in 5ms
        await delay(5);
        return "recovered";
      },
      {
        timeout: 25, // per-attempt timeout
        retry: {
          retries: 2,
          minDelay: 1,
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("halts execution when total timeout expires across multiple attempts", async () => {
    let attempts = 0;

    const promise = execute(
      async () => {
        attempts++;
        await delay(40);
        throw new Error("transient");
      },
      {
        timeout: {
          attempt: 50,
          total: 65, // total timeout expires before 2nd attempt can finish
        },
        retry: {
          retries: 5,
          minDelay: 10,
        },
      },
    );

    await expect(promise).rejects.toThrow(TimeoutError);
    try {
      await promise;
    } catch (err) {
      expect((err as TimeoutError).scope).toBe("total");
    }
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  it("frees concurrency slot when a timed out operation fails", async () => {
    const guarded = limitConcurrency(
      (ms: number) =>
        execute(
          async () => {
            await delay(ms);
            return "done";
          },
          { timeout: 25 },
        ),
      { concurrency: 1 },
    );

    const p1 = guarded(100); // will timeout at 25ms
    const p2 = guarded(5); // will execute after p1 times out and succeed

    await expect(p1).rejects.toThrow(TimeoutError);
    const res2 = await p2;
    expect(res2).toBe("done");
  });

  it("composes concurrency, retry, and timeout together seamlessly", async () => {
    const attemptMap = new Map<string, number>();

    const guardedFetch = limitConcurrency(
      async (url: string) => {
        return execute(
          async () => {
            const count = (attemptMap.get(url) ?? 0) + 1;
            attemptMap.set(url, count);

            if (url === "https://bad.com") {
              await delay(5);
              throw new Error("Bad endpoint");
            }

            if (url === "https://flaky.com" && count === 1) {
              await delay(5);
              throw new Error("Temporary 503");
            }

            await delay(10);
            return `Response from ${url}`;
          },
          {
            timeout: 50,
            retry: {
              retries: 2,
              minDelay: 1,
            },
          },
        );
      },
      { concurrency: 2 },
    );

    const urls = ["https://flaky.com", "https://good.com", "https://bad.com"];

    const results = await Promise.allSettled(urls.map((u) => guardedFetch(u)));
    const [r0, r1, r2] = results;

    expect(r0?.status).toBe("fulfilled");
    if (r0 && r0.status === "fulfilled") {
      expect(r0.value).toBe("Response from https://flaky.com");
    }

    expect(r1?.status).toBe("fulfilled");
    if (r1 && r1.status === "fulfilled") {
      expect(r1.value).toBe("Response from https://good.com");
    }

    expect(r2?.status).toBe("rejected");
    if (r2 && r2.status === "rejected") {
      expect(r2.reason).toBeInstanceOf(RetryError);
    }
  });
});
