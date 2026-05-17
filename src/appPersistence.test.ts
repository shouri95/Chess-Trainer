import { describe, expect, it } from "vitest";
import { isPlaceholderUsername, normalizeStoredProfile, shouldAutoSyncProfile } from "./appPersistence";

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
    expect(shouldAutoSyncProfile("sample", false)).toBe(false);
    expect(shouldAutoSyncProfile("hikaru", true)).toBe(false);
    expect(shouldAutoSyncProfile("", false)).toBe(false);
  });
});
