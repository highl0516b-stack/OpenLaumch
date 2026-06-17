// Mock KVNamespace for testing
export class MockKV {
  private store = new Map<string, string>();

  get(key: string, options?: { type: "json" | "text" }): Promise<any> {
    const v = this.store.get(key);
    if (!v) return Promise.resolve(null);
    if (options?.type === "json") return Promise.resolve(JSON.parse(v));
    return Promise.resolve(v);
  }

  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
    if (opts?.expirationTtl) {
      setTimeout(() => this.store.delete(key), opts.expirationTtl * 1000);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    const ok = this.store.has(key);
    this.store.delete(key);
    return Promise.resolve(ok);
  }

  list(): Promise<{ keys: { name: string }[] }> {
    return Promise.resolve({ keys: [] });
  }
}

export const mockEnv: Env = {
  CACHE: new MockKV() as unknown as KVNamespace,
  AI: {} as Fetcher,
  SESSIONS: {} as DurableObjectNamespace,
  ENVIRONMENT: "test",
};
