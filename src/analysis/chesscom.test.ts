import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChessComGames, fetchChessComProfile } from "./chesscom";

describe("Chess.com sync failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid usernames before calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchChessComProfile("bad name!")).rejects.toThrow("valid Chess.com username");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces missing public profiles clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));

    await expect(fetchChessComGames("missing-user", 1, "all")).rejects.toThrow("No public Chess.com profile");
  });

  it("surfaces rate limits during archive import", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ archives: ["https://api.chess.com/pub/player/tester/games/2026/05"] }),
      })
      .mockResolvedValueOnce({ status: 429, ok: false }));

    await expect(fetchChessComGames("tester", 1, "all")).rejects.toThrow("rate-limited");
  });
});
