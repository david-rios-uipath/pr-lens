import { describe, expect, it } from "vitest";
import { withRetry } from "../src/retry";

function failTimes(times: number, result = "ok") {
  let calls = 0;
  return {
    fn: () => {
      calls += 1;
      return calls <= times ? Promise.reject(new Error(`fail ${String(calls)}`)) : Promise.resolve(result);
    },
    calls: () => calls,
  };
}

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("returns the result without retrying on success", async () => {
    const { fn, calls } = failTimes(0);
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(calls()).toBe(1);
  });

  it("retries a failing call and succeeds", async () => {
    const { fn, calls } = failTimes(2);
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(calls()).toBe(3);
  });

  it("gives up after the configured number of attempts and rethrows the last error", async () => {
    const { fn, calls } = failTimes(10);
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow("fail 3");
    expect(calls()).toBe(3);
  });

  it("does not retry when isRetryable rejects the error", async () => {
    const { fn, calls } = failTimes(10);
    await expect(withRetry(fn, { isRetryable: () => false, sleep: noSleep })).rejects.toThrow("fail 1");
    expect(calls()).toBe(1);
  });

  it("backs off exponentially between attempts", async () => {
    const delays: number[] = [];
    const { fn } = failTimes(2);
    await withRetry(fn, {
      baseDelayMs: 100,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[0]).toBeLessThan(200);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(delays[1]).toBeLessThan(300);
  });
});
