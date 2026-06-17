import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../src/middleware/rateLimit";

describe("Rate Limiter", () => {
  it("allows first requests", async () => {
    const store = new Map<string, string>();
    const mc: any = {
      get: async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      },
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => false,
    };

    const r1 = await checkRateLimit(mc, "test:1", 5, 60000);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(4);

    const r2 = await checkRateLimit(mc, "test:1", 5, 60000);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(3);
  });

  it("blocks after exceeding limit", async () => {
    const store = new Map<string, string>();
    const mc: any = {
      get: async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      },
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => false,
    };
    store.set("rl:limited", JSON.stringify({ c: 5, r: Date.now() + 60000 }));

    const r = await checkRateLimit(mc, "limited", 5, 60000);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("resets after window expires", async () => {
    const store = new Map<string, string>();
    const mc: any = {
      get: async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      },
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => false,
    };
    store.set("rl:expired", JSON.stringify({ c: 5, r: Date.now() - 70_000 }));

    const r = await checkRateLimit(mc, "expired", 5, 60000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(4);
  });
});
