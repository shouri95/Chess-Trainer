import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { AnalysisReport, GameSummary, MoveReview } from "./patterns";
import { buildStruggleMap, struggleGradient, topStruggleSquares } from "./struggleMap";

describe("struggle map", () => {
  it("aggregates played, cure, and reply squares from reviewed game positions", () => {
    const start = new Chess();
    const fenBefore = start.fen();
    start.move("e4");
    const fenAfter = start.fen();
    const review = makeReview({
      fenBefore,
      fenAfter,
      uci: "e2e4",
      san: "e4",
      engineBestMove: "g1f3",
      engineEvalLoss: 180,
      engineReviewed: true,
      issueIds: ["openingTempo"],
      opening: "Sicilian Defense",
      quality: "mistake",
      severity: 6,
    });

    const map = buildStruggleMap(makeReport([review], [makeGame()]));
    const e4 = map.squares.find(square => square.square === "e4");
    const f3 = map.squares.find(square => square.square === "f3");
    const c5 = map.squares.find(square => square.square === "c5");

    expect(map.engineReviewedCount).toBe(1);
    expect(map.squares).toHaveLength(64);
    expect(e4?.roles.played).toBeGreaterThan(0);
    expect(f3?.roles.cure).toBeGreaterThan(0);
    expect(c5?.roles.reply).toBeGreaterThan(0);
    expect(e4?.associatedOpenings).toContain("Sicilian Defense");
    expect(topStruggleSquares(map, 1)[0].square).toBe("e4");
    expect(map.summary).toContain("1/1 engine-reviewed");
  });

  it("filters maps by phase without treating missing data as safe proof", () => {
    const opening = makeReview({
      id: "opening",
      phase: "opening",
      uci: "e2e4",
      san: "e4",
      engineEvalLoss: 90,
      issueIds: ["openingTempo"],
    });
    const endgame = makeReview({
      id: "endgame",
      phase: "endgame",
      fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 1",
      fenAfter: "8/8/8/8/8/4K3/8/7k b - - 1 1",
      uci: "e2e3",
      san: "Ke3",
      quality: "blunder",
      severity: 8,
      issueIds: ["endgameKing"],
    });

    const map = buildStruggleMap(makeReport([opening, endgame]), "endgame");
    const e3 = map.squares.find(square => square.square === "e3");
    const e4 = map.squares.find(square => square.square === "e4");

    expect(map.reviewedCount).toBe(1);
    expect(e3?.dominantPhase).toBe("endgame");
    expect(e3?.source).toBe("heuristic");
    expect(e4?.totalLossCp).toBe(0);
    expect(e4?.intensity).toBe(0);
  });

  it("keeps best moves visually neutral when engine loss is unavailable", () => {
    const best = makeReview({
      quality: "best",
      severity: 0,
      issueIds: [],
      uci: "g1f3",
      san: "Nf3",
    });

    const map = buildStruggleMap(makeReport([best]));
    const f3 = map.squares.find(square => square.square === "f3");

    expect(f3?.bestCount).toBeGreaterThan(0);
    expect(f3?.totalLossCp).toBe(0);
    expect(f3?.intensity).toBe(0);
  });

  it("returns transparent for empty gradients and red for severe intensity", () => {
    expect(struggleGradient(0)).toBe("transparent");
    expect(struggleGradient(1)).toContain("231, 76, 60");
  });
});

function makeReport(reviews: MoveReview[], games: GameSummary[] = []): AnalysisReport {
  return {
    username: "Tester",
    games: games.length,
    moves: reviews.length,
    issues: [],
    summaries: [],
    phaseTotals: {
      opening: reviews.filter(review => review.phase === "opening").length,
      middlegame: reviews.filter(review => review.phase === "middlegame").length,
      endgame: reviews.filter(review => review.phase === "endgame").length,
    },
    gameSummaries: games,
    moveReviews: reviews,
    skillProfile: {
      scores: {
        tactical: 50,
        positional: 50,
        opening: 50,
        endgame: 50,
        blunderControl: 50,
        kingSafety: 50,
        coordination: 50,
        conversion: 50,
      },
      estimatedRating: 1500,
      strongest: "tactical",
      weakest: "blunderControl",
      gap: 0,
      descriptions: {
        tactical: "",
        positional: "",
        opening: "",
        endgame: "",
        blunderControl: "",
        kingSafety: "",
        coordination: "",
        conversion: "",
      },
    },
    trainingPlan: [],
    moveQuality: {
      blunders: reviews.filter(review => review.quality === "blunder").length,
      misses: reviews.filter(review => review.quality === "miss").length,
      mistakes: reviews.filter(review => review.quality === "mistake").length,
      inaccuracies: reviews.filter(review => review.quality === "inaccuracy").length,
      good: reviews.filter(review => review.quality === "good").length,
      excellent: reviews.filter(review => review.quality === "best").length,
    },
    peakRating: 1500,
  };
}

function makeGame(): GameSummary {
  return {
    id: 1,
    opponent: "Opponent",
    color: "white",
    result: "loss",
    moveCount: 2,
    issues: 1,
    opening: "Sicilian Defense",
    pgn: `[Event "T"]
[Site "Local"]
[White "Tester"]
[Black "Opponent"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`,
  };
}

function makeReview(overrides: Partial<MoveReview> = {}): MoveReview {
  const fenBefore = overrides.fenBefore || new Chess().fen();
  return {
    id: overrides.id || "review",
    gameId: overrides.gameId ?? 1,
    gameUrl: overrides.gameUrl,
    opponent: overrides.opponent || "Opponent",
    opening: overrides.opening,
    endTime: overrides.endTime,
    timeClass: overrides.timeClass,
    phase: overrides.phase || "opening",
    moveNumber: overrides.moveNumber || 1,
    san: overrides.san || "e4",
    uci: overrides.uci || "e2e4",
    color: overrides.color || "white",
    quality: overrides.quality || "mistake",
    severity: overrides.severity ?? 6,
    engineBestMove: overrides.engineBestMove,
    engineEvalBefore: overrides.engineEvalBefore,
    engineEvalAfter: overrides.engineEvalAfter,
    engineEvalLoss: overrides.engineEvalLoss,
    engineDepth: overrides.engineDepth,
    engineConfidence: overrides.engineConfidence,
    engineReviewed: overrides.engineReviewed,
    engineLines: overrides.engineLines,
    fenBefore,
    fenAfter: overrides.fenAfter || fenBefore,
    issueIds: overrides.issueIds || ["engineMistake"],
    title: overrides.title || "Test pattern",
    explanation: overrides.explanation || "Test explanation",
    materialGain: overrides.materialGain ?? 0,
  };
}
