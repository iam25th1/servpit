import { describe, expect, it } from "vitest";
import { HANDLE_KEY, TOKEN_KEY, backerHandle, backerToken, memoryStore, setBackerHandle, type StorageLike } from "./backerId";

/** A browser that refuses site data, which throws rather than returning null. */
const refusing = (): StorageLike => ({
  getItem: () => {
    throw new Error("The operation is insecure.");
  },
  setItem: () => {
    throw new Error("The operation is insecure.");
  },
});

describe("this browser's token", () => {
  it("is made once and kept", () => {
    const store = memoryStore();
    const token = backerToken(store);
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(backerToken(store)).toBe(token);
    expect(store.getItem(TOKEN_KEY)).toBe(token);
  });

  it("is replaced when what was stored is too short to be random", () => {
    const store = memoryStore();
    store.setItem(TOKEN_KEY, "abc");
    expect(backerToken(store, () => "a-much-longer-token-value")).toBe("a-much-longer-token-value");
  });

  it("still exists in a browser that refuses to store it", () => {
    expect(backerToken(refusing(), () => "a-much-longer-token-value")).toBe("a-much-longer-token-value");
  });
});

describe("this browser's handle", () => {
  it("is kept in the one form the server stores", () => {
    const store = memoryStore();
    expect(setBackerHandle(store, "  Ash  ")).toBe("ash");
    expect(store.getItem(HANDLE_KEY)).toBe("ash");
    expect(backerHandle(store)).toBe("ash");
  });

  it("refuses one that is not a name, and keeps nothing", () => {
    const store = memoryStore();
    expect(setBackerHandle(store, "<b>ash</b>")).toBeNull();
    expect(store.getItem(HANDLE_KEY)).toBeNull();
  });

  it("is nothing until one is chosen, and nothing in a browser that refuses", () => {
    expect(backerHandle(memoryStore())).toBeNull();
    expect(backerHandle(refusing())).toBeNull();
  });
});
