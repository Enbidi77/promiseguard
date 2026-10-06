import { describe, expect, it, vi } from "vitest";
import { execute } from "../src/index.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("observability hooks", () => {
  it("invokes onStart, onSuccess, and receives valid metrics", async () => {
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const onRetry = vi.fn();

    const result = await execute(
      async () => {
        await delay(10);
        return { data: 123 };
      },
      {
        onStart,
        onSuccess,
        onFailure,
        onRetry,
      },
    );

    expect(result).toEqual({ data: 123 });
    expect(onStart).toHaveBeenCalledWith({ attempt: 1 });
    expect(onSuccess).toHaveBeenCalledWith({
      attempt: 1,
      result: { data: 123 },
      durationMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("invokes onRetry and onFailure with accurate attempt and delay info", async () => {
    const onStart = vi.fn();
    const onRetry = vi.fn();
    const onFailure = vi.fn();
    const onSuccess = vi.fn();

    let attempts = 0;
    await execute(
      () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("First fail");
        }
        return "ok";
      },
      {
        retry: {
          retries: 2,
          minDelay: 5,
        },
        onStart,
        onRetry,
        onFailure,
        onSuccess,
      },
    );

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      attempt: 1,
      error: expect.any(Error),
      durationMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
      willRetry: true,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      maxAttempts: 3,
      error: expect.any(Error),
      delay: expect.any(Number),
    });
    expect(onSuccess).toHaveBeenCalledWith({
      attempt: 2,
      result: "ok",
      durationMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
    });
  });

  it("safely swallows errors thrown inside observability hooks", async () => {
    const brokenOnStart = () => {
      throw new Error("Observer crashed!");
    };
    const brokenOnSuccess = () => {
      throw new Error("Observer crashed on success!");
    };

    const result = await execute(() => "resilient", {
      onStart: brokenOnStart,
      onSuccess: brokenOnSuccess,
    });

    expect(result).toBe("resilient");
  });
});
