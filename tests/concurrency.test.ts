import { describe, expect, it } from "vitest";
import { limitConcurrency, createLimiter, ConcurrencyError, AbortError } from "../src/index.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("concurrency control", () => {
  it("strictly serializes operations when concurrency = 1", async () => {
    let active = 0;
    let maxObservedActive = 0;
    const executionOrder: number[] = [];

    const guarded = limitConcurrency(
      async (id: number) => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
        await delay(10);
        executionOrder.push(id);
        active--;
        return id * 2;
      },
      { concurrency: 1 },
    );

    const results = await Promise.all([guarded(1), guarded(2), guarded(3)]);

    expect(results).toEqual([2, 4, 6]);
    expect(maxObservedActive).toBe(1);
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it("limits parallel operations to configured concurrency N", async () => {
    let active = 0;
    let maxObservedActive = 0;

    const guarded = limitConcurrency(
      async () => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
        await delay(20);
        active--;
        return "ok";
      },
      { concurrency: 3 },
    );

    const promises = Array.from({ length: 10 }, () => guarded());
    await Promise.all(promises);

    expect(maxObservedActive).toBe(3);
  });

  it("exposes activeCount, pendingCount, and concurrency metrics", async () => {
    const guarded = limitConcurrency(
      async () => {
        await delay(50);
        return "val";
      },
      { concurrency: 2 },
    );

    expect(guarded.concurrency).toBe(2);
    expect(guarded.activeCount).toBe(0);
    expect(guarded.pendingCount).toBe(0);

    const p1 = guarded();
    const p2 = guarded();
    const p3 = guarded();
    const p4 = guarded();

    expect(guarded.activeCount).toBe(2);
    expect(guarded.pendingCount).toBe(2);

    await Promise.all([p1, p2, p3, p4]);

    expect(guarded.activeCount).toBe(0);
    expect(guarded.pendingCount).toBe(0);
  });

  it("continues processing queue even when tasks throw synchronously", async () => {
    const guarded = limitConcurrency(
      (shouldThrow: boolean) => {
        if (shouldThrow) {
          throw new Error("Sync explosion");
        }
        return "success";
      },
      { concurrency: 1 },
    );

    const p1 = guarded(true);
    const p2 = guarded(false);

    await expect(p1).rejects.toThrow("Sync explosion");
    const res2 = await p2;
    expect(res2).toBe("success");
    expect(guarded.activeCount).toBe(0);
  });

  it("continues processing queue when tasks reject asynchronously", async () => {
    const guarded = limitConcurrency(
      async (shouldReject: boolean) => {
        await delay(10);
        if (shouldReject) {
          throw new Error("Async explosion");
        }
        return "success";
      },
      { concurrency: 1 },
    );

    const p1 = guarded(true);
    const p2 = guarded(false);

    await expect(p1).rejects.toThrow("Async explosion");
    const res2 = await p2;
    expect(res2).toBe("success");
    expect(guarded.activeCount).toBe(0);
  });

  it("enforces max queueSize and throws ConcurrencyError on overflow", async () => {
    const guarded = limitConcurrency(
      async () => {
        await delay(50);
      },
      { concurrency: 1, queueSize: 2 },
    );

    const p1 = guarded(); // active (1)
    const p2 = guarded(); // queued (1)
    const p3 = guarded(); // queued (2)

    // 4th call should exceed queueSize of 2
    await expect(guarded()).rejects.toThrow(ConcurrencyError);

    await Promise.all([p1, p2, p3]);
  });

  it("cancels an individual task while queued using AbortSignal", async () => {
    const limiter = createLimiter({ concurrency: 1 });
    const controller = new AbortController();

    const p1 = limiter.run(() => delay(30));
    const p2 = limiter.run(() => "task 2", { signal: controller.signal });
    const p3 = limiter.run(() => "task 3");

    expect(limiter.pendingCount).toBe(2);

    // Cancel task 2 while waiting in queue
    controller.abort("Task 2 aborted");

    await expect(p2).rejects.toThrow(AbortError);
    expect(limiter.pendingCount).toBe(1);

    const res3 = await p3;
    expect(res3).toBe("task 3");
    await p1;
  });

  it("clears all queued tasks when clearQueue is invoked", async () => {
    const guarded = limitConcurrency(
      async () => {
        await delay(50);
      },
      { concurrency: 1 },
    );

    const p1 = guarded(); // running
    const p2 = guarded(); // queued
    const p3 = guarded(); // queued

    expect(guarded.pendingCount).toBe(2);
    guarded.clearQueue(new Error("Queue wiped"));

    await expect(p2).rejects.toThrow("Queue wiped");
    await expect(p3).rejects.toThrow("Queue wiped");
    expect(guarded.pendingCount).toBe(0);

    await p1; // p1 finishes normally
  });

  it("processes thousands of operations efficiently (O(1) queue benchmark test)", async () => {
    const count = 3000;
    const guarded = limitConcurrency(
      async (n: number) => {
        return n + 1;
      },
      { concurrency: 50 },
    );

    const promises: Promise<number>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(guarded(i));
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(count);
    expect(results[0]).toBe(1);
    expect(results[count - 1]).toBe(count);
    expect(guarded.activeCount).toBe(0);
    expect(guarded.pendingCount).toBe(0);
  });
});
