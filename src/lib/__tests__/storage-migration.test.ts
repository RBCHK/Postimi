import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Minimal localStorage polyfill for Node test runner.
 * The migration module reads `window` and `localStorage` — we stub both before
 * dynamically importing the module, so the `typeof window === "undefined"`
 * guard inside the module sees our stub.
 */
function createLocalStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  return { store, stub };
}

let stubs: ReturnType<typeof createLocalStorageStub>;
let migrateLocalStorageKeys: () => void;

beforeEach(async () => {
  stubs = createLocalStorageStub();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", stubs.stub);
  // Re-import after stubs are in place so the module captures them.
  vi.resetModules();
  ({ migrateLocalStorageKeys } = await import("../storage-migration"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("migrateLocalStorageKeys", () => {
  it("copies legacy xreba_theme to postimi_theme and removes the old key", () => {
    stubs.stub.setItem("xreba_theme", "dark");

    migrateLocalStorageKeys();

    expect(stubs.stub.getItem("postimi_theme")).toBe("dark");
    expect(stubs.stub.getItem("xreba_theme")).toBeNull();
  });

  it("does not overwrite an existing postimi_* value", () => {
    stubs.stub.setItem("xreba_theme", "dark");
    stubs.stub.setItem("postimi_theme", "light");

    migrateLocalStorageKeys();

    expect(stubs.stub.getItem("postimi_theme")).toBe("light");
    // Old key is still cleaned up even when we did not copy
    expect(stubs.stub.getItem("xreba_theme")).toBeNull();
  });

  it("migrates all known keys in a single pass", () => {
    stubs.stub.setItem("xreba_theme", "dark");
    stubs.stub.setItem("xreba_language", '{"interfaceLanguage":"ru"}');
    stubs.stub.setItem("xreba_model", "claude-sonnet-4-6");
    stubs.stub.setItem("xreba_model_strategist", "claude-haiku-4-5-20251001");
    stubs.stub.setItem("xreba_model_researcher", "claude-sonnet-4-6");
    stubs.stub.setItem("xreba_model_daily_insight", "claude-sonnet-4-6");

    migrateLocalStorageKeys();

    expect(stubs.stub.getItem("postimi_theme")).toBe("dark");
    expect(stubs.stub.getItem("postimi_language")).toBe('{"interfaceLanguage":"ru"}');
    expect(stubs.stub.getItem("postimi_model")).toBe("claude-sonnet-4-6");
    expect(stubs.stub.getItem("postimi_model_strategist")).toBe("claude-haiku-4-5-20251001");
    expect(stubs.stub.getItem("postimi_model_researcher")).toBe("claude-sonnet-4-6");
    expect(stubs.stub.getItem("postimi_model_daily_insight")).toBe("claude-sonnet-4-6");

    expect(stubs.stub.getItem("xreba_theme")).toBeNull();
    expect(stubs.stub.getItem("xreba_language")).toBeNull();
    expect(stubs.stub.getItem("xreba_model")).toBeNull();
    expect(stubs.stub.getItem("xreba_model_strategist")).toBeNull();
    expect(stubs.stub.getItem("xreba_model_researcher")).toBeNull();
    expect(stubs.stub.getItem("xreba_model_daily_insight")).toBeNull();
  });

  it("is a no-op when there are no legacy keys", () => {
    stubs.stub.setItem("postimi_theme", "dark");

    migrateLocalStorageKeys();

    expect(stubs.stub.getItem("postimi_theme")).toBe("dark");
    expect(stubs.stub.length).toBe(1);
  });

  it("is idempotent when called multiple times", () => {
    stubs.stub.setItem("xreba_theme", "dark");

    migrateLocalStorageKeys();
    migrateLocalStorageKeys();
    migrateLocalStorageKeys();

    expect(stubs.stub.getItem("postimi_theme")).toBe("dark");
    expect(stubs.stub.getItem("xreba_theme")).toBeNull();
  });

  it("does not throw when localStorage operations fail (private mode)", () => {
    const throwingStub = {
      ...stubs.stub,
      getItem: () => {
        throw new Error("SecurityError: localStorage is disabled");
      },
    };
    vi.stubGlobal("localStorage", throwingStub);

    expect(() => migrateLocalStorageKeys()).not.toThrow();
  });

  it("is a no-op on the server (window is undefined)", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", stubs.stub);
    // window left undefined
    vi.resetModules();
    const mod = await import("../storage-migration");

    stubs.stub.setItem("xreba_theme", "dark");
    mod.migrateLocalStorageKeys();

    // Since window is undefined, migration should early-return without touching storage
    expect(stubs.stub.getItem("xreba_theme")).toBe("dark");
    expect(stubs.stub.getItem("postimi_theme")).toBeNull();
  });
});
