import { describe, expect, it } from "vitest";
import { execute, limitConcurrency, calculateDelay } from "../src/index.js";

describe("performance and high-load benchmarks", () => {
  it("measures execute overhead vs raw promise", async () => {
    const iterations = 5000;

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      await Promise.resolve(i);
    }
    const rawDuration = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      await execute(() => i);
    }
    const executeDuration = performance.now() - t1;

    // Execute overhead should be modest (< 0.1ms per operation)
    const perOpMs = (executeDuration - rawDuration) / iterations;
    expect(perOpMs).toBeLessThan(0.1);
  });

  it("measures backoff calculation speed (> 500,000 ops/sec)", () => {
    const iterations = 50_000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateDelay({
        attempt: (i % 10) + 1,
        error: null,
        minDelay: 100,
        factor: 2,
        jitter: false,
      });
    }
    const durationMs = performance.now() - t0;
    const opsPerSec = (iterations / durationMs) * 1000;
    expect(opsPerSec).toBeGreaterThan(500_000);
  });

  it("measures high-concurrency throughput with 5,000 tasks", async () => {
    const taskCount = 5000;
    const guarded = limitConcurrency(async (x: number) => x * 2, {
      concurrency: 50,
    });

    const t0 = performance.now();
    const tasks = Array.from({ length: taskCount }, (_, i) => guarded(i));
    const results = await Promise.all(tasks);
    const durationMs = performance.now() - t0;

    expect(results.length).toBe(taskCount);
    expect(durationMs).toBeLessThan(1000); // 5000 tasks scheduled and resolved in under 1 second
  });
});
