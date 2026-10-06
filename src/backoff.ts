import type { BackoffStrategy, JitterStrategy } from "./types.js";

export interface CalculateDelayOptions {
  /**
   * 1-based retry attempt index.
   * Attempt 1 represents the first retry (after the initial failure).
   */
  attempt: number;

  /**
   * The error that caused the failure, passed to custom backoff functions.
   */
  error: unknown;

  /**
   * Backoff strategy: "exponential", "fixed", or a custom function.
   * Default: "exponential"
   */
  strategy?: BackoffStrategy | undefined;

  /**
   * Minimum delay in milliseconds. Default: 100
   */
  minDelay?: number | undefined;

  /**
   * Maximum delay in milliseconds. Default: 30000
   */
  maxDelay?: number | undefined;

  /**
   * Multiplier factor for exponential backoff. Default: 2
   */
  factor?: number | undefined;

  /**
   * Jitter strategy to avoid thundering herds. Default: false
   */
  jitter?: JitterStrategy | undefined;
}

/**
 * Calculates backoff delay based on configuration, attempt count, and jitter.
 *
 * Deterministic when jitter is disabled.
 */
export function calculateDelay(options: CalculateDelayOptions): number {
  const {
    attempt,
    error,
    strategy = "exponential",
    minDelay = 100,
    maxDelay = 30000,
    factor = 2,
    jitter = false,
  } = options;

  let baseDelay: number;

  if (typeof strategy === "function") {
    baseDelay = strategy(attempt, error);
  } else if (strategy === "fixed") {
    baseDelay = minDelay;
  } else {
    // "exponential"
    // For attempt = 1 (1st retry): minDelay * (factor ^ 0) = minDelay
    // For attempt = 2 (2nd retry): minDelay * (factor ^ 1) = minDelay * factor, etc.
    const exponent = Math.max(0, attempt - 1);
    baseDelay = minDelay * Math.pow(factor, exponent);
  }

  // Ensure non-negative and bounded by minDelay and maxDelay
  const clampedDelay = Math.max(0, Math.min(baseDelay, maxDelay));

  if (!jitter) {
    return Math.round(clampedDelay);
  }

  if (jitter === "equal") {
    // Half fixed, half randomized
    const half = clampedDelay / 2;
    return Math.round(half + Math.random() * half);
  }

  // Full jitter: random between 0 and clampedDelay
  return Math.round(Math.random() * clampedDelay);
}
