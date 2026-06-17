import { describe, it, expect } from "vitest";
import { verifyAuth, AuthMethod } from "../src/middleware/auth";
import { corsHeaders } from "../src/middleware/cors";

describe("API Gateway Core", () => {
  it("dev mode allows all requests", async () => {
    const env = { CACHE: {} as any };
    const r = await verifyAuth(new Request("http://x/"), env);
    expect(r.ok).toBe(true);
    expect(r.method).toBe(AuthMethod.NONE);
  });

  it("rejects wrong API key", async () => {
    const env = { API_KEY: "secret123" } as any;
    const r = await verifyAuth(
      new Request("http://x/", { headers: { "X-API-Key": "wrong" } }),
      env,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts correct API key", async () => {
    const env = { API_KEY: "secret123" } as any;
    const r = await verifyAuth(
      new Request("http://x/", { headers: { "X-API-Key": "secret123" } }),
      env,
    );
    expect(r.ok).toBe(true);
    expect(r.method).toBe(AuthMethod.API_KEY);
  });

  it("accepts correct Bearer token", async () => {
    const env = { BEARER_TOKEN: "tok_abc" } as any;
    const r = await verifyAuth(
      new Request("http://x/", {
        headers: { Authorization: "Bearer tok_abc" },
      }),
      env,
    );
    expect(r.ok).toBe(true);
    expect(r.method).toBe(AuthMethod.BEARER);
  });

  it("has MCP routes defined", async () => {
    const { MCP_ROUTES } = await import("../src/config");
    expect(MCP_ROUTES.length).toBe(3);
    expect(MCP_ROUTES[0].name).toBe("cursor-app-control");
  });

  it("has 4 AI providers", async () => {
    const { AI_PROVIDERS } = await import("../src/config");
    expect(Object.keys(AI_PROVIDERS).length).toBe(4);
    expect(AI_PROVIDERS.openai.model).toBe("gpt-4o");
    expect(AI_PROVIDERS.ollama.model).toBe("llama3.1");
  });

  it("CORS headers present", () => {
    const h = corsHeaders();
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
    expect(h["Access-Control-Allow-Methods"]).toContain("GET");
  });
});
