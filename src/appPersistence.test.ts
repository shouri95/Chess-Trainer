import { describe, expect, it } from "vitest";
import { isPlaceholderUsername, normalizeStoredProfile, readStorageValue, removeStorageValue, shouldAutoSyncProfile, writeStorageValue } from "./appPersistence";

describe("app persistence", () => {
  it("does not persist sample placeholders as real connected accounts", () => {
    expect(isPlaceholderUsername("You")).toBe(true);
    expect(normalizeStoredProfile({ username: "You", months: 99, gameLimit: 9999 })).toEqual({
      username: undefined,
      months: 12,
      gameLimit: 500,
      timeClass: undefined,
    });
  });

  it("auto-syncs only real saved usernames when not already loading", () => {
    expect(shouldAutoSyncProfile("hikaru", false)).toBe(true);
    expect(shouldAutoSyncProfile("hikaru", false, false)).toBe(false);
    expect(shouldAutoSyncProfile("sample", false)).toBe(false);
    expect(shouldAutoSyncProfile("hikaru", true)).toBe(false);
    expect(shouldAutoSyncProfile("", false)).toBe(false);
  });

  it("handles unavailable storage without throwing", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(readStorageValue("pattern-coach-test")).toBe(null);
    expect(writeStorageValue("pattern-coach-test", "value")).toBe(false);
    expect(() => removeStorageValue("pattern-coach-test")).not.toThrow();

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
