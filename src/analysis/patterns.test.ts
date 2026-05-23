import { describe, expect, it } from "vitest";
import { analyzeChessComGames, analyzePgnText } from "./patterns";
import { splitPgnText } from "./chesscom";
import { judgeDrillMove } from "../chess/drillEvaluator";
import { openingVerdictForMove } from "../chess/openingBook";
import { classifyMoveQuality, normalizeSearchEval, scoreForColor } from "../engine/EngineService";

describe("analysis profile", () => {
  it("uses available Chess.com ratings for peak rating", async () => {
    const report = await analyzeChessComGames("Tester", [{
      url: "https://example.test/game/1",
      pgn: `[Event "Rated game"]
[Site "Chess.com"]
[White "Tester"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`,
      time_class: "rapid",
      rules: "chess",
      white: { username: "Tester", rating: 1632, result: "win" },
      black: { username: "Opponent", rating: 1580, result: "resigned" },
    }]);

    expect(report.peakRating).toBe(1632);
    expect(report.skillProfile.estimatedRating).toBeGreaterThan(1400);
  });

  it("extracts PGN Elo tags when present", async () => {
    const report = await analyzePgnText("Tester", `[Event "PGN game"]
[Site "Local"]
[White "Tester"]
[Black "Opponent"]
[WhiteElo "1510"]
[BlackElo "1490"]
[Result "1-0"]

1. d4 d5 2. c4 e6 1-0`);

    expect(report.peakRating).toBe(1510);
  });
});

describe("drill evaluator", () => {
  it("does not bless a material grab when the engine line is much worse", () => {
    const judgement = judgeDrillMove({
      fen: "7k/8/8/8/8/8/4q3/4K3 w - - 0 1",
      uci: "e1e2",
      engine: {
        fen: "7k/8/8/8/8/8/4q3/4K3 w - - 0 1",
        bestMove: "e1f2",
        evalCp: 0,
        pv: "e1f2",
        depth: 12,
        confidence: "high",
        lines: [
          { multipv: 1, bestMove: "e1f2", evalCp: 0, pv: "e1f2", depth: 12 },
          { multipv: 2, bestMove: "e1e2", evalCp: -700, pv: "e1e2", depth: 12 },
        ],
      },
    });

    expect(judgement.status).toBe("wrong");
  });

  it("accepts a material alternative only when it is close to the engine line", () => {
    const judgement = judgeDrillMove({
      fen: "7k/8/8/8/8/8/4q3/4K3 w - - 0 1",
      uci: "e1e2",
      engine: {
        fen: "7k/8/8/8/8/8/4q3/4K3 w - - 0 1",
        bestMove: "e1f2",
        evalCp: 0,
        pv: "e1f2",
        depth: 12,
        confidence: "high",
        lines: [
          { multipv: 1, bestMove: "e1f2", evalCp: 0, pv: "e1f2", depth: 12 },
          { multipv: 2, bestMove: "e1e2", evalCp: -20, pv: "e1e2", depth: 12 },
        ],
      },
    });

    expect(judgement.status).toBe("correct");
  });

  it("rejects replaying the original flagged move even when shallow engine output likes it", () => {
    const fen = "r2q1rk1/ppp2p2/2np1n1p/2b1p1p1/2B1P1b1/2NP1NB1/PPP2PPP/R2QK2R w KQ - 0 10";
    const judgement = judgeDrillMove({
      fen,
      uci: "f3g5",
      rejectedMove: "f3g5",
      problemExplanation: "Nxg5 allowed hxg5 and lost a piece.",
      engine: {
        fen,
        bestMove: "f3g5",
        evalCp: 70,
        pv: "f3g5 c6d4 g5f3",
        depth: 12,
        confidence: "high",
        lines: [
          { multipv: 1, bestMove: "f3g5", evalCp: 70, pv: "f3g5 c6d4", depth: 12 },
          { multipv: 2, bestMove: "h2h3", evalCp: 40, pv: "h2h3 g4h5", depth: 12 },
        ],
      },
    });

    expect(judgement.status).toBe("wrong");
    expect(judgement.bestMove).toBe("h2h3");
    expect(judgement.message).toContain("lost a piece");
  });

  it("keeps engine failure states actionable instead of marking moves solved", () => {
    const judgement = judgeDrillMove({
      fen: "8/8/8/8/8/8/4K3/7k w - - 0 1",
      uci: "e2e3",
      engine: {
        fen: "8/8/8/8/8/8/4K3/7k w - - 0 1",
        bestMove: "",
        evalCp: undefined,
        pv: "",
        depth: 0,
        confidence: "failed",
      },
    });

    expect(judgement.status).toBe("wrong");
    expect(judgement.message).toContain("reliable engine recommendation");
  });
});

describe("engine-backed classification", () => {
  it("keeps Stockfish 18 scores in White perspective", () => {
    expect(normalizeSearchEval("8/8/8/8/8/8/8/K6k w - - 0 1", { evalCp: 42 }).cp).toBe(42);
    expect(normalizeSearchEval("8/8/8/8/8/8/8/K6k b - - 0 1", { evalCp: 42 }).cp).toBe(-42);
    expect(normalizeSearchEval("8/8/8/8/8/8/8/K6k b - - 0 1", { mate: 3 }).mate).toBe(-3);
  });

  it("computes centipawn loss from the player perspective", () => {
    const playerBefore = scoreForColor({ cp: -20 }, "b");
    const playerAfter = scoreForColor({ cp: 180 }, "b");
    expect(Math.max(0, playerBefore - playerAfter)).toBe(200);
  });

  it("uses engine loss thresholds as the source of move quality", () => {
    expect(classifyMoveQuality({
      bestMove: "e2e4",
      playedMove: "d2d4",
      evalLossCp: 80,
      evalBefore: { cp: 20 },
      evalAfter: { cp: -60 },
      playerColor: "w",
    })).toBe("inaccuracy");

    expect(classifyMoveQuality({
      bestMove: "e2e4",
      playedMove: "g2g4",
      evalLossCp: 310,
      evalBefore: { cp: 20 },
      evalAfter: { cp: -290 },
      playerColor: "w",
    })).toBe("blunder");
  });

  it("lets mate rules override centipawn thresholds", () => {
    expect(classifyMoveQuality({
      bestMove: "g1f3",
      playedMove: "h2h3",
      evalLossCp: 10,
      evalBefore: { cp: 0 },
      evalAfter: { mate: -2 },
      playerColor: "w",
    })).toBe("blunder");
  });
});

describe("opening book", () => {
  it("protects common Sicilian theory moves", () => {
    expect(openingVerdictForMove("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "Nf3")?.name).toBe("Sicilian Defense");
  });

  it("protects Queen's Gambit replies", () => {
    expect(openingVerdictForMove("rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2", "e6")?.name).toBe("Queen's Gambit");
  });

  it("accepts UCI moves when checking book moves", () => {
    expect(openingVerdictForMove("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "g1f3")?.name).toBe("Sicilian Defense");
  });

  it("normalizes castling-right order in position keys", () => {
    expect(openingVerdictForMove("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w QKkq - 0 2", "Nf3")?.name).toBe("Sicilian Defense");
  });
});

describe("PGN utilities", () => {
  it("splits Windows-line-ending PGN files", () => {
    const text = `[Event "One"]\r\n[White "A"]\r\n[Black "B"]\r\n\r\n1. e4 e5 1-0\r\n[Event "Two"]\r\n[White "A"]\r\n[Black "B"]\r\n\r\n1. d4 d5 1-0`;
    expect(splitPgnText(text)).toHaveLength(2);
  });
});
