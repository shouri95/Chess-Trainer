import { Chess } from "chess.js";
import type { AnalysisReport, GameSummary, MoveReview, MoveReviewQuality, PatternId, Phase } from "./patterns";

export type StrugglePhase = Phase | "all";
export type StruggleRole = "played" | "cure" | "reply";
export type StruggleSource = "engine" | "mixed" | "heuristic";

export type StrugglePatternSummary = {
  id: PatternId | "unclassified";
  count: number;
  totalLossCp: number;
};

export type StruggleSquare = {
  square: string;
  totalLossCp: number;
  count: number;
  blunderCount: number;
  mistakeCount: number;
  inaccuracyCount: number;
  bestCount: number;
  intensity: number;
  dominantPhase: Phase | "none";
  dominantPattern: PatternId | "unclassified" | "none";
  associatedOpenings: string[];
  roles: Record<StruggleRole, number>;
  source: StruggleSource;
};

export type StruggleMap = {
  phase: StrugglePhase;
  squares: StruggleSquare[];
  maxLossCp: number;
  totalLossCp: number;
  reviewedCount: number;
  engineReviewedCount: number;
  summary: string;
  topPatternsPerSquare: Record<string, StrugglePatternSummary[]>;
};

type SquareAccumulator = {
  square: string;
  totalLossCp: number;
  count: number;
  engineCount: number;
  heuristicCount: number;
  blunderCount: number;
  mistakeCount: number;
  inaccuracyCount: number;
  bestCount: number;
  roles: Record<StruggleRole, number>;
  phaseLosses: Record<Phase, number>;
  patternLosses: Map<PatternId | "unclassified", { count: number; totalLossCp: number }>;
  openingLosses: Map<string, number>;
};

type GameTimelineMove = {
  uci: string;
  fenBefore: string;
};

const files = "abcdefgh";
const phases: Phase[] = ["opening", "middlegame", "endgame"];
const boardSquares = Array.from({ length: 64 }, (_, index) => {
  const file = files[index % 8];
  const rank = 8 - Math.floor(index / 8);
  return `${file}${rank}`;
});

export function buildStruggleMap(report: AnalysisReport, phase: StrugglePhase = "all"): StruggleMap {
  const squareStats = new Map<string, SquareAccumulator>();
  const timelineCache = new Map<number, GameTimelineMove[]>();
  const gamesById = new Map(report.gameSummaries.map(game => [game.id, game]));
  const reviews = report.moveReviews.filter(review => phase === "all" || review.phase === phase);

  const getSquare = (square: string) => {
    const existing = squareStats.get(square);
    if (existing) return existing;
    const created: SquareAccumulator = {
      square,
      totalLossCp: 0,
      count: 0,
      engineCount: 0,
      heuristicCount: 0,
      blunderCount: 0,
      mistakeCount: 0,
      inaccuracyCount: 0,
      bestCount: 0,
      roles: { played: 0, cure: 0, reply: 0 },
      phaseLosses: { opening: 0, middlegame: 0, endgame: 0 },
      patternLosses: new Map(),
      openingLosses: new Map(),
    };
    squareStats.set(square, created);
    return created;
  };

  const addSquare = (review: MoveReview, square: string | undefined, role: StruggleRole, roleWeight: number) => {
    if (!square || !/^[a-h][1-8]$/.test(square)) return;
    const { lossCp, engineBacked } = reviewLossForMap(review);
    const weightedLoss = lossCp * qualityWeight(review.quality, lossCp) * roleWeight;
    if (weightedLoss <= 0 && review.quality !== "best" && review.quality !== "good") return;

    const stat = getSquare(square);
    stat.count += 1;
    stat.totalLossCp += weightedLoss;
    stat.roles[role] += weightedLoss;
    stat.phaseLosses[review.phase] += weightedLoss;
    if (engineBacked) stat.engineCount += 1;
    else stat.heuristicCount += 1;

    if (review.quality === "best" || review.quality === "good" || lossCp < 50) stat.bestCount += 1;
    else if (lossCp >= 250 || review.quality === "blunder") stat.blunderCount += 1;
    else if (lossCp >= 120 || review.quality === "mistake" || review.quality === "miss") stat.mistakeCount += 1;
    else stat.inaccuracyCount += 1;

    const patternId = review.issueIds[0] ?? "unclassified";
    const pattern = stat.patternLosses.get(patternId) || { count: 0, totalLossCp: 0 };
    pattern.count += 1;
    pattern.totalLossCp += weightedLoss;
    stat.patternLosses.set(patternId, pattern);

    const opening = review.opening?.trim();
    if (opening) stat.openingLosses.set(opening, (stat.openingLosses.get(opening) || 0) + weightedLoss);
  };

  for (const review of reviews) {
    const played = squaresForUci(review.uci);
    const bestMove = review.engineBestMove || review.engineLines?.[0]?.bestMove || "";
    const best = squaresForUci(bestMove);
    const game = gamesById.get(review.gameId);
    const timeline = game ? getTimeline(game, timelineCache) : [];
    const reply = nextMoveAfterReview(review, timeline);
    const replyMove = squaresForUci(reply?.uci);

    addSquare(review, played?.to, "played", 1);
    addSquare(review, played?.from, "played", 0.45);
    if (best && !sameUciMove(review.uci, bestMove)) {
      addSquare(review, best.to, "cure", 0.78);
      addSquare(review, best.from, "cure", 0.32);
    }
    addSquare(review, replyMove?.to, "reply", 0.58);
  }

  const maxLossCp = Math.max(0, ...[...squareStats.values()].map(stat => stat.totalLossCp));
  const topPatternsPerSquare: Record<string, StrugglePatternSummary[]> = {};
  const squares = boardSquares.map(square => {
    const stat = squareStats.get(square) || getSquare(square);
    const dominantPhase = topEntry(stat.phaseLosses)?.[0] ?? "none";
    const dominantPattern = [...stat.patternLosses.entries()]
      .sort((a, b) => b[1].totalLossCp - a[1].totalLossCp)[0]?.[0] ?? "none";
    topPatternsPerSquare[square] = [...stat.patternLosses.entries()]
      .map(([id, value]) => ({ id, count: value.count, totalLossCp: roundLoss(value.totalLossCp) }))
      .sort((a, b) => b.totalLossCp - a.totalLossCp)
      .slice(0, 3);

    return {
      square,
      totalLossCp: roundLoss(stat.totalLossCp),
      count: stat.count,
      blunderCount: stat.blunderCount,
      mistakeCount: stat.mistakeCount,
      inaccuracyCount: stat.inaccuracyCount,
      bestCount: stat.bestCount,
      intensity: maxLossCp > 0 ? clamp(stat.totalLossCp / maxLossCp, 0, 1) : 0,
      dominantPhase,
      dominantPattern,
      associatedOpenings: [...stat.openingLosses.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([opening]) => opening),
      roles: {
        played: roundLoss(stat.roles.played),
        cure: roundLoss(stat.roles.cure),
        reply: roundLoss(stat.roles.reply),
      },
      source: stat.engineCount && stat.heuristicCount ? "mixed" : stat.engineCount ? "engine" : "heuristic",
    } satisfies StruggleSquare;
  });

  const totalLossCp = roundLoss([...squareStats.values()].reduce((sum, stat) => sum + stat.totalLossCp, 0));
  const engineReviewedCount = reviews.filter(review => review.engineReviewed || hasEngineLoss(review)).length;
  return {
    phase,
    squares,
    maxLossCp: roundLoss(maxLossCp),
    totalLossCp,
    reviewedCount: reviews.length,
    engineReviewedCount,
    summary: struggleSummary(phase, squares, totalLossCp, engineReviewedCount, reviews.length),
    topPatternsPerSquare,
  };
}

export function topStruggleSquares(map: StruggleMap, limit = 5) {
  return map.squares
    .filter(square => square.totalLossCp > 0)
    .slice()
    .sort((a, b) => b.totalLossCp - a.totalLossCp || b.count - a.count)
    .slice(0, limit);
}

export function struggleGradient(intensity: number) {
  const value = clamp(intensity, 0, 1);
  if (value <= 0) return "transparent";
  if (value < 0.2) return `rgba(46, 204, 113, ${0.05 + value * 0.25})`;
  if (value < 0.5) return `rgba(241, 196, 15, ${0.2 + (value - 0.2) * 0.5})`;
  if (value < 0.8) return `rgba(230, 126, 34, ${0.3 + (value - 0.5) * 0.6})`;
  return `rgba(231, 76, 60, ${0.45 + (value - 0.8) * 0.55})`;
}

function reviewLossForMap(review: MoveReview) {
  if (typeof review.engineEvalLoss === "number") {
    return { lossCp: Math.max(0, review.engineEvalLoss), engineBacked: true };
  }
  if (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number") {
    const playerSign = review.color === "white" ? 1 : -1;
    return {
      lossCp: Math.max(0, (review.engineEvalBefore - review.engineEvalAfter) * playerSign),
      engineBacked: true,
    };
  }
  if (review.quality === "best") return { lossCp: 0, engineBacked: false };
  if (review.quality === "good") return { lossCp: 10, engineBacked: false };
  return { lossCp: Math.max(0, review.severity * 45), engineBacked: false };
}

function hasEngineLoss(review: MoveReview) {
  return typeof review.engineEvalLoss === "number" ||
    (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number");
}

function qualityWeight(quality: MoveReviewQuality, lossCp: number) {
  if (lossCp >= 250 || quality === "blunder") return 1;
  if (lossCp >= 120 || quality === "mistake" || quality === "miss") return 0.65;
  if (lossCp >= 50 || quality === "inaccuracy") return 0.35;
  if (quality === "best") return 0.02;
  return 0.08;
}

function getTimeline(game: GameSummary, cache: Map<number, GameTimelineMove[]>) {
  const cached = cache.get(game.id);
  if (cached) return cached;
  const timeline = buildGameTimeline(game);
  cache.set(game.id, timeline);
  return timeline;
}

function buildGameTimeline(game: GameSummary): GameTimelineMove[] {
  try {
    const source = new Chess();
    source.loadPgn(game.pgn, { strict: false });
    const replay = new Chess();
    return source.history({ verbose: true }).flatMap(move => {
      const fenBefore = replay.fen();
      const uci = `${move.from}${move.to}${move.promotion || ""}`;
      const played = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      return played ? [{ uci, fenBefore }] : [];
    });
  } catch {
    return [];
  }
}

function nextMoveAfterReview(review: MoveReview, timeline: GameTimelineMove[]) {
  const index = timeline.findIndex(move =>
    comparableFen(move.fenBefore) === comparableFen(review.fenBefore) &&
    move.uci === review.uci
  );
  return index >= 0 ? timeline[index + 1] : undefined;
}

function squaresForUci(uci?: string) {
  if (!uci || !/^[a-h][1-8][a-h][1-8]/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function sameUciMove(left?: string, right?: string) {
  if (!left || !right) return false;
  return left.slice(0, 5).toLowerCase() === right.slice(0, 5).toLowerCase();
}

function comparableFen(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function topEntry(values: Record<Phase, number>): [Phase, number] | null {
  const entry = phases
    .map(phase => [phase, values[phase]] as [Phase, number])
    .sort((a, b) => b[1] - a[1])[0];
  return entry && entry[1] > 0 ? entry : null;
}

function struggleSummary(phase: StrugglePhase, squares: StruggleSquare[], totalLossCp: number, engineReviewedCount: number, reviewedCount: number) {
  const top = squares
    .filter(square => square.totalLossCp > 0)
    .slice()
    .sort((a, b) => b.totalLossCp - a.totalLossCp)
    .slice(0, 3)
    .map(square => square.square);
  const phaseLabel = phase === "all" ? "all phases" : `the ${phase}`;
  const coverage = reviewedCount
    ? `${engineReviewedCount}/${reviewedCount} engine-reviewed`
    : "no reviewed moves";
  if (!top.length) return phase === "all"
    ? "No recurring struggle squares yet across all phases."
    : `No recurring struggle squares yet in ${phaseLabel}.`;
  return `${phase === "all" ? "Across" : "In"} ${phaseLabel}, the heaviest loss clusters on ${top.join(", ")} (${coverage}).`;
}

function roundLoss(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
