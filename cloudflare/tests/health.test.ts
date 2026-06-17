import { describe, it, expect } from "vitest";

describe("Health Check", () => {
  it("returns status ok", async () => {
    const { handleHealth } = await import("../src/routes/health");
    const res = await handleHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.0.0");
  });
});
