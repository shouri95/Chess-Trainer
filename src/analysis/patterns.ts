import { Chess, Color, Move, PieceSymbol, Square } from "chess.js";
import { ChessComGame, splitPgnText } from "./chesscom";

type Phase = "opening" | "middlegame" | "endgame";

type PatternId =
  | "loosePiece" | "missedForcingMove" | "twoMoveBlindspot"
  | "kingShelter" | "delayedCastle" | "openingTempo"
  | "queenEarly" | "endgameKing" | "conversion";

type MoveIssue = {
  id: PatternId;
  phase: Phase;
  quality: MoveReviewQuality;
  severity: number;
  title: string;
  explanation: string;
  advice: string;
  moveNumber: number;
  san: string;
  uci: string;
  materialGain: number;
  fenBefore: string;
  fenAfter: string;
  gameUrl?: string;
  opponent?: string;
  color: "white" | "black";
  opening?: string;
  engineBestMove?: string;
  engineEvalLoss?: number;
  engineReviewed?: boolean;
};

type PatternSummary = {
  id: PatternId;
  title: string;
  total: number;
  severity: number;
  phases: Record<Phase, number>;
  advice: string;
  examples: MoveIssue[];
};

type GameSummary = {
  id: number;
  url?: string;
  opponent: string;
  color: "white" | "black";
  result: "win" | "loss" | "draw" | "unknown";
  moveCount: number;
  issues: number;
  opening?: string;
  endTime?: number;
  timeClass?: string;
  pgn: string;
};

export type MoveReviewQuality = "blunder" | "miss" | "mistake" | "inaccuracy" | "good" | "best";

export type MoveReview = {
  id: string;
  gameId: number;
  gameUrl?: string;
  opponent?: string;
  opening?: string;
  endTime?: number;
  timeClass?: string;
  phase: Phase;
  moveNumber: number;
  san: string;
  uci: string;
  color: "white" | "black";
  quality: MoveReviewQuality;
  severity: number;
  engineBestMove?: string;
  engineEvalBefore?: number;
  engineEvalAfter?: number;
  engineEvalLoss?: number;
  engineDepth?: number;
  engineConfidence?: "book" | "high" | "medium" | "low" | "timeout" | "failed";
  engineReviewed?: boolean;
  engineLines?: Array<{
    multipv: number;
    bestMove: string;
    evalCp?: number;
    mate?: number;
    pv: string;
    depth: number;
  }>;
  fenBefore: string;
  fenAfter: string;
  issueIds: PatternId[];
  title: string;
  explanation: string;
  materialGain: number;
};

export type SkillDimension =
  | "tactical"
  | "positional"
  | "opening"
  | "endgame"
  | "blunderControl"
  | "kingSafety"
  | "coordination"
  | "conversion";

export type SkillProfile = {
  scores: Record<SkillDimension, number>;
  estimatedRating: number;
  strongest: SkillDimension;
  weakest: SkillDimension;
  gap: number;
  descriptions: Record<SkillDimension, string>;
};

export type TrainingRecommendation = {
  dimension: SkillDimension;
  focus: string;
  priority: number;
  exercises: string[];
  expectedGain: string;
};

export type MoveQualityDistribution = {
  blunders: number;
  misses: number;
  mistakes: number;
  inaccuracies: number;
  good: number;
  excellent: number;
};

export type AnalysisReport = {
  username: string;
  games: number;
  moves: number;
  issues: MoveIssue[];
  summaries: PatternSummary[];
  phaseTotals: Record<Phase, number>;
  gameSummaries: GameSummary[];
  moveReviews: MoveReview[];
  skillProfile: SkillProfile;
  trainingPlan: TrainingRecommendation[];
  moveQuality: MoveQualityDistribution;
  peakRating: number;
};

export type { Phase, PatternId, MoveIssue, PatternSummary, GameSummary };

type ParsedGame = {
  pgn: string;
  url?: string;
  white?: string;
  black?: string;
  whiteResult?: string;
  blackResult?: string;
  whiteRating?: number;
  blackRating?: number;
  opening?: string;
  endTime?: number;
  timeClass?: string;
};

type VerboseMove = Move;

const pieceValues: Record<PieceSymbol, number> = {
  p: 1, n: 3, b: 3.15, r: 5, q: 9, k: 0
};

const copy: Record<PatternId, { title: string; advice: string }> = {
  loosePiece: { title: "Loose pieces", advice: "Scan every undefended piece before you move. If the opponent can capture it, fix that first." },
  missedForcingMove: { title: "Missed forcing moves", advice: "Run the checklist: checks, captures, threats. Candidate moves must earn their place." },
  twoMoveBlindspot: { title: "Opponent replies ignored", advice: "After choosing a move, pause for their most annoying reply." },
  kingShelter: { title: "King shelter weakened", advice: "The three pawns near your castled king are shelter. Don't move them without a reason." },
  delayedCastle: { title: "King in center too long", advice: "Castle or make castling possible before starting flank attacks." },
  openingTempo: { title: "Opening tempo leaking", advice: "Develop a fresh piece unless there is a tactic. Re-moving developed pieces is suspicious." },
  queenEarly: { title: "Queen out too early", advice: "Delay queen adventures until minors are developed and king is safe." },
  endgameKing: { title: "Passive endgame king", advice: "When queens are off, the king becomes a fighting piece. Move it toward the center." },
  conversion: { title: "Not simplifying wins", advice: "When ahead in material, prefer trades and king safety over complications." },
};

const skillLabels: Record<SkillDimension, string> = {
  tactical: "Tactical awareness",
  positional: "Positional understanding",
  opening: "Opening knowledge",
  endgame: "Endgame technique",
  blunderControl: "Blunder control",
  kingSafety: "King safety",
  coordination: "Piece coordination",
  conversion: "Conversion rate",
};

const files = "abcdefgh";

export function analyzeChessComGames(username: string, games: ChessComGame[]): AnalysisReport {
  return analyzeParsedGames(username, games.map(game => ({
    pgn: game.pgn, url: game.url,
    white: game.white.username, black: game.black.username,
    whiteResult: game.white.result, blackResult: game.black.result,
    whiteRating: game.white.rating, blackRating: game.black.rating,
    opening: openingFromGame(game.eco, game.pgn),
    endTime: game.end_time,
    timeClass: game.time_class
  })));
}

export function analyzePgnText(username: string, pgnText: string): AnalysisReport {
  return analyzeParsedGames(username, splitPgnText(pgnText).map(pgn => ({
    pgn, ...headersFromPgn(pgn),
    opening: openingFromGame(undefined, pgn)
  })));
}

function analyzeParsedGames(username: string, games: ParsedGame[]): AnalysisReport {
  const normalizedUser = username.trim().toLowerCase();
  const issues: MoveIssue[] = [];
  const moveReviews: MoveReview[] = [];
  const gameSummaries: GameSummary[] = [];
  let playerMoves = 0;

  // Track per-dimension counts and totals for skill profiling
  const dimCounts: Record<SkillDimension, number> = {
    tactical: 0, positional: 0, opening: 0, endgame: 0,
    blunderControl: 0, kingSafety: 0, coordination: 0, conversion: 0,
  };
  const dimTotals: Record<SkillDimension, number> = {
    tactical: 0, positional: 0, opening: 0, endgame: 0,
    blunderControl: 0, kingSafety: 0, coordination: 0, conversion: 0,
  };
  let totalGoodMoves = 0;
  let totalBlunders = 0;
  let totalMistakes = 0;
  let totalInaccuracies = 0;
  let totalExcellent = 0;
  let wins = 0;
  let losses = 0;
  let peakRating = 0;
  let ratingSamples = 0;

  for (const [gameId, game] of games.entries()) {
    const chess = new Chess();
    try { chess.loadPgn(game.pgn, { strict: false }); } catch { continue; }

    const history = chess.history({ verbose: true });
    const headers = chess.getHeaders();
    const white = game.white ?? headers.White ?? "";
    const black = game.black ?? headers.Black ?? "";
    const playerIsWhite = white.toLowerCase() === normalizedUser;
    const playerIsBlack = black.toLowerCase() === normalizedUser;
    if (!playerIsWhite && !playerIsBlack && normalizedUser) continue;

    const color: Color = playerIsBlack ? "b" : "w";
    const colorName: "white" | "black" = color === "w" ? "white" : "black";
    const opponent = color === "w" ? black : white;
    const gameIssueMoveKeys = new Set<string>();

    const rating = playerIsWhite ? game.whiteRating : game.blackRating;
    if (typeof rating === "number" && Number.isFinite(rating) && rating > 0) {
      peakRating = Math.max(peakRating, rating);
      ratingSamples += 1;
    }

    history.forEach((move, index) => {
      if (move.color !== color) return;
      playerMoves += 1;

      const result = analyzeMove({
        move, nextMove: history[index + 1], ply: index + 1,
        phase: getPhase(move.after, index + 1), color, game, opponent, mode: "deep"
      });
      const reviewQuality: MoveReviewQuality = result.quality === "excellent" ? "best" : result.quality;
      result.issues.forEach(issue => { issue.quality = reviewQuality; });

      issues.push(...result.issues);
      if (result.issues.length) {
        gameIssueMoveKeys.add(`${move.before}|${move.from}${move.to}${move.promotion || ""}`);
      }
      moveReviews.push(reviewFromMove({
        move,
        result,
        gameId,
        game,
        opponent,
        colorName,
        phase: getPhase(move.after, index + 1),
      }));

      // Accumulate dimension scores against relevant opportunity sets instead
      // of crediting every quiet move as a success in every chess skill.
      new Set(result.dimensions).forEach(d => { dimCounts[d]++; });
      const phase = getPhase(move.after, index + 1);
      const beforePosition = new Chess(move.before);
      const afterPosition = new Chess(move.after);
      const tacticalOpportunity = hasForcingOpportunity(beforePosition, color) || Boolean(move.captured) || move.san.includes("+") || move.san.includes("#");
      const positionalOpportunity = !tacticalOpportunity && phase !== "opening";
      const kingSafetyOpportunity = phase === "opening" || isKingSafetyMove(move, beforePosition, afterPosition, color);
      const coordinationOpportunity = piecesOf(beforePosition, color).filter(piece => piece.type !== "k" && piece.type !== "p").length >= 3;
      const conversionOpportunity = materialScore(beforePosition, color) >= 2 && phase !== "opening";

      if (phase === "opening") dimTotals.opening++;
      if (phase === "endgame") dimTotals.endgame++;
      if (tacticalOpportunity) dimTotals.tactical++;
      if (positionalOpportunity) dimTotals.positional++;
      dimTotals.blunderControl++;
      if (kingSafetyOpportunity) dimTotals.kingSafety++;
      if (coordinationOpportunity) dimTotals.coordination++;
      if (conversionOpportunity) dimTotals.conversion++;

      // Move quality tracking
      if (result.quality === "blunder") totalBlunders++;
      else if (result.quality === "miss") totalMistakes++;
      else if (result.quality === "mistake") totalMistakes++;
      else if (result.quality === "inaccuracy") totalInaccuracies++;
      else if (result.quality === "excellent") totalExcellent++;
      else totalGoodMoves++;
    });

    const result = resultForColor(color, game, headers.Result);
    if (result === "win") wins++; else if (result === "loss") losses++;

    gameSummaries.push({
      id: gameId,
      url: game.url, opponent, color: colorName, result,
      moveCount: history.filter(m => m.color === color).length,
      issues: gameIssueMoveKeys.size,
      opening: game.opening,
      endTime: game.endTime,
      timeClass: game.timeClass,
      pgn: game.pgn
    });
  }

  const totalGameMoves = playerMoves || 1;

  // Compute skill profile (0-100 scale, normalized by moves analyzed)
  const computeScore = (good: number, total: number, invert = false): number => {
    if (total === 0) return 50;
    const ratio = good / total;
    const score = invert ? Math.round((1 - ratio) * 100) : Math.round(ratio * 100);
    return Math.max(5, Math.min(95, score));
  };

  const skillScores: Record<SkillDimension, number> = {
    tactical: computeScore(dimTotals.tactical - dimCounts.tactical, dimTotals.tactical),
    positional: computeScore(dimTotals.positional - dimCounts.positional, dimTotals.positional),
    opening: computeScore(dimTotals.opening - dimCounts.opening, dimTotals.opening),
    endgame: computeScore(dimTotals.endgame - dimCounts.endgame, dimTotals.endgame),
    blunderControl: computeScore(totalGameMoves - totalBlunders - totalMistakes, totalGameMoves),
    kingSafety: computeScore(dimTotals.kingSafety - dimCounts.kingSafety, dimTotals.kingSafety),
    coordination: computeScore(totalGoodMoves + totalExcellent, totalGameMoves),
    conversion: computeScore(dimTotals.conversion - dimCounts.conversion, dimTotals.conversion),
  };

  // Estimate rating (very rough heuristic based on move quality)
  const blunderRate = totalBlunders / totalGameMoves;
  const mistakeRate = totalMistakes / totalGameMoves;
  const errorRate = blunderRate * 3 + mistakeRate * 1.5;

  let estRating = 1800;
  if (errorRate < 0.02) estRating = 2400;
  else if (errorRate < 0.05) estRating = 2200;
  else if (errorRate < 0.08) estRating = 2000;
  else if (errorRate < 0.12) estRating = 1800;
  else if (errorRate < 0.18) estRating = 1600;
  else if (errorRate < 0.25) estRating = 1400;
  else estRating = 1200;

  // Adjust by win rate
  const winRate = wins / (wins + losses || 1);
  if (winRate > 0.7) estRating += 150;
  else if (winRate > 0.55) estRating += 50;
  else if (winRate < 0.35) estRating -= 100;
  else if (winRate < 0.45) estRating -= 30;
  if (ratingSamples) {
    estRating = Math.round(peakRating * 0.7 + estRating * 0.3);
  }

  // Find strongest and weakest dimensions
  let strongest: SkillDimension = "tactical";
  let weakest: SkillDimension = "blunderControl";
  let maxScore = 0;
  let minScore = 100;
  for (const dim of Object.keys(skillScores) as SkillDimension[]) {
    if (skillScores[dim] > maxScore) { maxScore = skillScores[dim]; strongest = dim; }
    if (skillScores[dim] < minScore) { minScore = skillScores[dim]; weakest = dim; }
  }

  const skillDescriptions: Record<SkillDimension, string> = {
    tactical: generateDimensionDescription("tactical", skillScores.tactical, totalBlunders),
    positional: generateDimensionDescription("positional", skillScores.positional, totalMistakes),
    opening: generateDimensionDescription("opening", skillScores.opening, 0),
    endgame: generateDimensionDescription("endgame", skillScores.endgame, 0),
    blunderControl: generateDimensionDescription("blunderControl", skillScores.blunderControl, totalBlunders),
    kingSafety: generateDimensionDescription("kingSafety", skillScores.kingSafety, totalInaccuracies),
    coordination: generateDimensionDescription("coordination", skillScores.coordination, totalGoodMoves),
    conversion: generateDimensionDescription("conversion", skillScores.conversion, wins),
  };

  // Generate training plan
  const trainingPlan: TrainingRecommendation[] = generateTrainingPlan(skillScores, issues);

  return {
    username,
    games: gameSummaries.length,
    moves: playerMoves,
    issues,
    summaries: summarizeIssues(issues),
    phaseTotals: {
      opening: issues.filter(i => i.phase === "opening").length,
      middlegame: issues.filter(i => i.phase === "middlegame").length,
      endgame: issues.filter(i => i.phase === "endgame").length,
    },
    gameSummaries,
    moveReviews,
    skillProfile: {
      scores: skillScores,
      estimatedRating: estRating,
      strongest,
      weakest,
      gap: maxScore - minScore,
      descriptions: skillDescriptions,
    },
    trainingPlan,
    moveQuality: {
      blunders: totalBlunders,
      misses: moveReviews.filter(move => move.quality === "miss").length,
      mistakes: totalMistakes,
      inaccuracies: totalInaccuracies,
      good: totalGoodMoves,
      excellent: totalExcellent,
    },
    peakRating: peakRating || estRating,
  };
}

function generateDimensionDescription(dim: SkillDimension, score: number, context: number): string {
  if (score >= 85) return `Excellent. You're performing well above average in ${skillLabels[dim].toLowerCase()}.`;
  if (score >= 70) return `Solid. Above average in ${skillLabels[dim].toLowerCase()}. Room for refinement.`;
  if (score >= 55) return `Average. Your ${skillLabels[dim].toLowerCase()} is at typical club level. Focused practice will help.`;
  if (score >= 40) return `Below average. This is an area where targeted training will yield significant improvement.`;
  return `Needs work. ${skillLabels[dim].toLowerCase()} is your weakest area. Prioritize this in training.`;
}

function generateTrainingPlan(scores: Record<SkillDimension, number>, issues: MoveIssue[]): TrainingRecommendation[] {
  const sorted = (Object.entries(scores) as [SkillDimension, number][])
    .sort(([, a], [, b]) => a - b);

  const exercises: Record<SkillDimension, string[]> = {
    tactical: ["Solve 10 tactical puzzles daily", "Play 15+10 games and analyze each tactical shot", "Study forcing move patterns: pins, forks, discovered attacks"],
    positional: ["Study pawn structure fundamentals", "Analyze classic positional games (Capablanca, Karpov)", "Practice identifying weak squares and outposts"],
    opening: ["Build a 3-opening repertoire and study the plans", "Review opening traps in your chosen lines", "Focus on piece development principles, not memorization"],
    endgame: ["Practice king and pawn endgames", "Study rook endgame fundamentals (Lucena, Philidor)", "Drill basic checkmates: KQ vs K, KR vs K, KBB vs K"],
    blunderControl: ["Before each move, scan for opponent checks, captures, and threats", "Play slower time controls (30+0 or 45+45)", "Review every blunder and write down why it happened"],
    kingSafety: ["Practice castled-king defense patterns", "Study pawn storm and fianchetto attacks", "Learn when to open lines near your king vs when to keep them closed"],
    coordination: ["Focus on piece activity — every piece should have a purpose", "Study games with strong piece harmony (Fischer, Carlsen)", "Practice coordinating rooks on open files"],
    conversion: ["Practice converting winning endgames", "Study technique: simplification, prophylaxis, the principle of two weaknesses", "Play out winning positions against engine from move 20"],
  };

  return sorted.slice(0, 4).map(([dim, score], i) => ({
    dimension: dim,
    focus: skillLabels[dim],
    priority: i + 1,
    exercises: exercises[dim] || [],
    expectedGain: score < 40 ? "Major improvement expected (100-200 rating points)" :
                 score < 60 ? "Significant improvement expected (50-100 rating points)" :
                 "Moderate improvement expected (25-50 rating points)",
  }));
}

type MoveAnalysisResult = {
  issues: MoveIssue[];
  dimensions: SkillDimension[];
  quality: "blunder" | "miss" | "mistake" | "inaccuracy" | "good" | "excellent";
};

function reviewFromMove({
  move,
  result,
  gameId,
  game,
  opponent,
  colorName,
  phase,
}: {
  move: VerboseMove;
  result: MoveAnalysisResult;
  gameId: number;
  game: ParsedGame;
  opponent: string;
  colorName: "white" | "black";
  phase: Phase;
}): MoveReview {
  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const materialGain = materialScore(after, move.color) - materialScore(before, move.color);
  const primaryIssue = result.issues.slice().sort((a, b) => b.severity - a.severity)[0];
  const quality: MoveReviewQuality =
    result.quality === "excellent" ? "best" :
    result.quality;

  return {
    id: `${gameId}-${move.before.split(" ")[5]}-${move.from}${move.to}${move.promotion || ""}`,
    gameId,
    gameUrl: game.url,
    opponent,
    opening: game.opening,
    endTime: game.endTime,
    timeClass: game.timeClass,
    phase,
    moveNumber: getMoveNumber(move.before),
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ""}`,
    color: colorName,
    quality,
    severity: primaryIssue?.severity ?? (quality === "best" ? 0 : 1),
    fenBefore: move.before,
    fenAfter: move.after,
    issueIds: result.issues.map(issue => issue.id),
    title: primaryIssue?.title ?? (quality === "best" ? "Best move" : "Good move"),
    explanation: primaryIssue?.explanation ?? (
      quality === "best"
        ? `${move.san} was a forcing or high-value move.`
        : `${move.san} did not trigger a recurring mistake pattern.`
    ),
    materialGain,
  };
}

function analyzeMove({
  move, nextMove, ply, phase, color, game, opponent, mode
}: {
  move: VerboseMove;
  nextMove?: VerboseMove;
  ply: number;
  phase: Phase;
  color: Color;
  game: ParsedGame;
  opponent: string;
  mode: "deep" | "fast";
}): MoveAnalysisResult {
  const issues: MoveIssue[] = [];
  const dimensions: SkillDimension[] = [];
  let quality: MoveAnalysisResult["quality"] = "good";

  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const moveNumber = getMoveNumber(move.before);
  const colorName: "white" | "black" = color === "w" ? "white" : "black";
  const materialGain = materialScore(after, color) - materialScore(before, color);
  const moveValue = pieceValues[move.piece] ?? 0;
  const capturedValue = move.captured ? pieceValues[move.captured] ?? 0 : 0;
  const uci = `${move.from}${move.to}${move.promotion || ""}`;

  const addIssue = (id: PatternId, severity: number, explanation: string, fenAfter = move.after) => {
    issues.push({
      id,
      phase,
      quality: "inaccuracy",
      severity,
      title: copy[id].title,
      explanation,
      advice: copy[id].advice,
      moveNumber,
      san: move.san,
      uci,
      materialGain,
      fenBefore: move.before,
      fenAfter,
      gameUrl: game.url,
      opponent,
      color: colorName,
      opening: game.opening
    });
  };

  // Map pattern IDs to skill dimensions
  const dimMap: Partial<Record<PatternId, SkillDimension>> = {
    loosePiece: "tactical",
    missedForcingMove: "tactical",
    twoMoveBlindspot: "tactical",
    kingShelter: "kingSafety",
    delayedCastle: "kingSafety",
    openingTempo: "positional",
    queenEarly: "positional",
    endgameKing: "endgame",
    conversion: "conversion",
  };

  // Detect loose pieces. Do not punish a forcing capture that wins substantial
  // material: Bxd8 winning a queen is a success even if the bishop can later be
  // recaptured.
  const loose = newLoosePiece(before, after, color);
  const wonMeaningfulMaterial = capturedValue >= moveValue + 1.5 || materialGain >= 3;
  if (!wonMeaningfulMaterial && loose && loose.value >= 3) {
    addIssue("loosePiece", loose.value >= 5 ? 9 : 6,
      `${move.san} left a ${pieceName(loose.piece)} on ${loose.square} loose.`);
    dimensions.push("tactical");
    quality = loose.value >= 5 ? "blunder" : "mistake";
  }

  // Detect opponent reply threats (two-move blindspot). This is only an initial
  // candidate generator; Stockfish refinement is the source of truth for labels.
  if (nextMove && nextMove.color !== color) {
    const replyPos = new Chess(nextMove.after);
    const swing = materialScore(after, color) - materialScore(replyPos, color);
    const sequenceGain = materialScore(replyPos, color) - materialScore(before, color);
    const replyHitPiece = nextMove.captured && pieceValues[nextMove.captured] >= 3;
    const replyForcing = Boolean(nextMove.captured) || nextMove.san.includes("+") || nextMove.san.includes("#");
    const lineStillWinsMaterial = sequenceGain >= 2;

    if (!lineStillWinsMaterial && replyForcing && (swing >= 2.7 || replyHitPiece)) {
      addIssue("twoMoveBlindspot", Math.min(10, 5 + Math.floor(swing)),
        `Reply ${nextMove.san} was forcing and swung eval by ~${Math.max(0, swing).toFixed(1)}.`);
      dimensions.push("tactical");
      quality = swing >= 3 ? "blunder" : "mistake";
    }
  }

  // Check missed forcing moves (deep mode only)
  if (mode === "deep" && !issues.some(issue => issue.id === "twoMoveBlindspot" || issue.id === "loosePiece")) {
    const bestForcing = bestForcingMove(before, color);
    const moveWasForcing = Boolean(move.captured) || move.san.includes("+") || move.san.includes("#");
    if (bestForcing && !moveWasForcing && bestForcing.score >= 4.8) {
      addIssue("missedForcingMove", Math.min(9, bestForcing.score),
        `${bestForcing.san} was a strong forcing option, but ${move.san} was played.`);
      dimensions.push("tactical");
      quality = "miss";
    }
  }

  // Opening principles
  if (phase === "opening") {
    const oIssue = openingPrincipleIssue(move, before, after, color, ply);
    if (oIssue) {
      addIssue(oIssue.id, oIssue.severity, oIssue.explanation);
      dimensions.push(dimMap[oIssue.id] || "positional");
      if (quality === "good") quality = "inaccuracy";
    }
  }

  // King shelter analysis
  const shelterLoss = castledKingShelterLoss(before, after, color);
  if (shelterLoss) {
    addIssue("kingShelter", shelterLoss.severity,
      `${move.san} loosened pawn cover near your castled king on the ${shelterLoss.side}.`);
    dimensions.push("kingSafety");
    if (quality === "good") quality = "inaccuracy";
  }

  // Endgame king activity
  if (mode === "deep" && phase === "endgame") {
    const eIssue = endgameKingIssue(move, before, after, color);
    if (eIssue) {
      addIssue("endgameKing", eIssue.severity, eIssue.explanation);
      dimensions.push("endgame");
      if (quality === "good") quality = "inaccuracy";
    }
  }

  // Conversion analysis
  if (mode === "deep") {
    const conv = conversionIssue(move, before, after, color, phase);
    if (conv) {
      addIssue("conversion", conv.severity, conv.explanation);
      dimensions.push("conversion");
      if (quality === "good") quality = "inaccuracy";
    }
  }

  // Detect excellent moves conservatively. A routine minor-piece capture is
  // not automatically "best" unless it wins material without leaving the
  // moved piece immediately loose.
  if (issues.length === 0) {
    const movedPieceLoose = loosePieces(after, color).some(piece => piece.square === move.to && piece.value >= capturedValue);
    if (move.captured && !movedPieceLoose && (move.captured === "q" || materialGain >= 3)) quality = "excellent";
    if (move.san.includes("#")) quality = "excellent";
  }

  return { issues, dimensions, quality };
}

// ---- Phase detection ----
function getPhase(fen: string, ply: number): Phase {
  const chess = new Chess(fen);
  const material = totalMaterial(chess);
  const queens = countPieces(chess, "q");
  const minors = countPieces(chess, "n") + countPieces(chess, "b");
  const rooks = countPieces(chess, "r");
  if (ply >= 70 || material <= 20 || (queens === 0 && (material <= 30 || minors <= 2 || rooks <= 2))) return "endgame";
  if (ply <= 20) return "opening";
  return "middlegame";
}

// ---- Loose piece detection ----
function newLoosePiece(before: Chess, after: Chess, color: Color) {
  const prev = loosePieces(before, color);
  return loosePieces(after, color)
    .filter(p => !prev.some(op => op.square === p.square))
    .sort((a, b) => b.value - a.value)[0];
}

function loosePieces(chess: Chess, color: Color) {
  const opp = opposite(color);
  return piecesOf(chess, color)
    .filter(({ type }) => type !== "k" && type !== "p")
    .map(({ square, type }) => ({
      square, piece: type, value: pieceValues[type],
      attackers: chess.attackers(square, opp).length,
      defenders: chess.attackers(square, color).length
    }))
    .filter(p => p.attackers > 0 && p.defenders < p.attackers);
}

// ---- Forcing move detection ----
function bestForcingMove(chess: Chess, color: Color) {
  return chess.moves({ verbose: true })
    .filter(m => m.color === color)
    .map(m => {
      const next = new Chess(chess.fen());
      next.move(m);
      const recaptureRisk = next.attackers(m.to, opposite(color)).length ? pieceValues[m.piece] * 0.75 : 0;
      const netCapture = m.captured ? pieceValues[m.captured] - recaptureRisk : 0;
      return {
        san: m.san,
        score: netCapture +
          (m.san.includes("+") ? 0.8 : 0) +
          (m.san.includes("#") ? 100 : 0) +
          (m.captured === "q" || m.captured === "r" ? 1 : 0)
      };
    })
    .sort((a, b) => b.score - a.score)[0];
}

function hasForcingOpportunity(chess: Chess, color: Color) {
  const forcing = bestForcingMove(chess, color);
  return Boolean(forcing && forcing.score >= 2.5);
}

function isKingSafetyMove(move: VerboseMove, before: Chess, after: Chess, color: Color) {
  return move.piece === "k" ||
    castledKingShelterLoss(before, after, color) !== null ||
    openingPrincipleIssue(move, before, after, color, getMoveNumber(move.before))?.id === "delayedCastle";
}

// ---- Opening principles ----
function openingPrincipleIssue(move: VerboseMove, before: Chess, after: Chess, color: Color, ply: number) {
  const kingHome: Square = color === "w" ? "e1" : "e8";
  const hasCastled = !after.get(kingHome) || after.get(kingHome)?.type !== "k";
  const developed = developedMinorPieces(after, color);
  const patternId = (id: PatternId) => id;

  if (!hasCastled && ply >= 14 && !before.inCheck() && move.piece !== "k" && !canCastleSoon(after, color)) {
    return { id: patternId("delayedCastle"), severity: 7, explanation: `${move.san} left king in center after opening.` };
  }
  if ((move.piece === "n" || move.piece === "b") && ply <= 18) {
    const starts = color === "w" ? ["b1","g1","c1","f1"] : ["b8","g8","c8","f8"];
    if (!starts.includes(move.from) && developed < 3) {
      return { id: patternId("openingTempo"), severity: 5, explanation: `${move.san} re-moved a minor piece before developing others.` };
    }
  }
  if (move.piece === "q" && ply <= 14 && developed < 2) {
    return { id: patternId("queenEarly"), severity: 5, explanation: `${move.san} brought queen out before piece development.` };
  }
  if (move.piece === "p" && isFlankPawnMove(move.from, color) && ply <= 20 && !isKnownOpeningPawnBreak(move)) {
    return { id: patternId("kingShelter"), severity: 5, explanation: `${move.san} weakened future castled king squares.` };
  }
  return null;
}

// ---- King shelter ----
function castledKingShelterLoss(before: Chess, after: Chess, color: Color) {
  const bk = kingSquare(before, color), ak = kingSquare(after, color);
  if (!bk || !ak || bk !== ak) return null;
  const side = castledSide(ak, color);
  if (!side) return null;
  const loss = kingShelterScore(before, color) - kingShelterScore(after, color);
  const pressure = kingPressure(after, color) - kingPressure(before, color);
  if (loss + pressure >= 2) return { side, severity: Math.min(9, 4 + loss + pressure) };
  return null;
}

// ---- Endgame king ----
function endgameKingIssue(move: VerboseMove, before: Chess, after: Chess, color: Color) {
  if (totalMaterial(after) > 18 || move.piece === "k") return null;
  const bk = kingSquare(before, color), ak = kingSquare(after, color);
  if (!bk || !ak) return null;
  const canAdvance = before.moves({ verbose: true }).some(m => m.color === color && m.piece === "k");
  if (canAdvance && distanceToCenter(ak) >= distanceToCenter(bk)) {
    return { severity: 4, explanation: `${move.san} kept king passive in simplified position.` };
  }
  return null;
}

// ---- Conversion ----
function conversionIssue(move: VerboseMove, before: Chess, after: Chess, color: Color, phase: Phase) {
  if (phase === "opening" || materialScore(before, color) < 3) return null;
  const oppChecks = after.moves({ verbose: true }).filter(m => m.san.includes("+")).length;
  const qPresent = countPieces(after, "q") > 0;
  if (!move.captured && qPresent && oppChecks >= 2) {
    return { severity: 5, explanation: `${move.san} kept complications while ahead in material.` };
  }
  return null;
}

// ---- Utility functions ----
function materialScore(chess: Chess, color: Color): number {
  let score = 0;
  for (const row of chess.board()) for (const piece of row) {
    if (piece) score += piece.color === color ? pieceValues[piece.type] : -pieceValues[piece.type];
  }
  return score;
}

function totalMaterial(chess: Chess): number {
  return chess.board().flat().reduce((s, p) => s + (p && p.type !== "k" ? pieceValues[p.type] : 0), 0);
}

function countPieces(chess: Chess, pieceType: PieceSymbol): number {
  return chess.board().flat().filter(p => p?.type === pieceType).length;
}

function piecesOf(chess: Chess, color: Color): Array<{ square: Square; type: PieceSymbol }> {
  const result: Array<{ square: Square; type: PieceSymbol }> = [];
  chess.board().forEach((row, ri) => {
    row.forEach((piece, fi) => {
      if (piece?.color === color) result.push({ square: `${files[fi]}${8 - ri}` as Square, type: piece.type });
    });
  });
  return result;
}

function developedMinorPieces(chess: Chess, color: Color): number {
  const home = new Set(color === "w" ? ["b1","g1","c1","f1"] : ["b8","g8","c8","f8"]);
  return piecesOf(chess, color).filter(({ square, type }) => (type === "n" || type === "b") && !home.has(square)).length;
}

function canCastleSoon(chess: Chess, color: Color): boolean {
  const rights = chess.fen().split(" ")[2] ?? "-";
  return color === "w" ? rights.includes("K") || rights.includes("Q") : rights.includes("k") || rights.includes("q");
}

function kingSquare(chess: Chess, color: Color): Square | undefined {
  return piecesOf(chess, color).find(p => p.type === "k")?.square;
}

function castledSide(square: Square, color: Color): string | null {
  if (color === "w" && square === "g1") return "kingside";
  if (color === "w" && square === "c1") return "queenside";
  if (color === "b" && square === "g8") return "kingside";
  if (color === "b" && square === "c8") return "queenside";
  return null;
}

function kingShelterScore(chess: Chess, color: Color): number {
  const sq = kingSquare(chess, color);
  if (!sq) return 0;
  const file = files.indexOf(sq[0]), rank = Number(sq[1]);
  const pr = color === "w" ? rank + 1 : rank - 1;
  let score = 0;
  [-1, 0, 1].forEach(fo => {
    const tf = file + fo;
    if (tf < 0 || tf > 7 || pr < 1 || pr > 8) return;
    const p = chess.get(`${files[tf]}${pr}` as Square);
    if (p?.type === "p" && p.color === color) score++;
  });
  return score;
}

function kingPressure(chess: Chess, color: Color): number {
  const sq = kingSquare(chess, color);
  if (!sq) return 0;
  const opp = opposite(color);
  const file = files.indexOf(sq[0]), rank = Number(sq[1]);
  let pressure = 0;
  [-1, 0, 1].forEach(fo => {
    [-1, 0, 1].forEach(ro => {
      const tf = file + fo, tr = rank + ro;
      if (tf < 0 || tf > 7 || tr < 1 || tr > 8) return;
      pressure += chess.attackers(`${files[tf]}${tr}` as Square, opp).length;
    });
  });
  return pressure;
}

function distanceToCenter(square: Square): number {
  const f = files.indexOf(square[0]), r = Number(square[1]) - 1;
  return Math.min(Math.abs(f - 3), Math.abs(f - 4)) + Math.min(Math.abs(r - 3), Math.abs(r - 4));
}

function opposite(color: Color): Color { return color === "w" ? "b" : "w"; }
function pieceName(p: PieceSymbol): string { return { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[p] || ""; }
function getMoveNumber(fen: string): number {
  const parts = fen.trim().split(/\s+/);
  const moveNumber = Number(parts.length >= 6 ? parts[5] : 1);
  return Number.isFinite(moveNumber) && moveNumber > 0 ? moveNumber : 1;
}

function isFlankPawnMove(square: Square, color: Color): boolean {
  return color === "w" ? square[1] === "2" && "abgh".includes(square[0]) : square[1] === "7" && "abgh".includes(square[0]);
}

function isKnownOpeningPawnBreak(move: VerboseMove): boolean {
  return ["c4", "c5", "f4", "f5", "g3", "g6", "b3", "b6"].includes(move.san.replace(/[+#?!]/g, ""));
}

// ---- Summarize ----
function summarizeIssues(issues: MoveIssue[]): PatternSummary[] {
  const map = new Map<PatternId, PatternSummary>();
  for (const issue of issues) {
    const s = map.get(issue.id);
    if (!s) {
      map.set(issue.id, {
        id: issue.id, title: issue.title, total: 1, severity: issue.severity,
        phases: { opening: issue.phase === "opening" ? 1 : 0, middlegame: issue.phase === "middlegame" ? 1 : 0, endgame: issue.phase === "endgame" ? 1 : 0 },
        advice: issue.advice, examples: [issue],
      });
    } else {
      s.total++; s.severity += issue.severity;
      s.phases[issue.phase]++; s.examples = [...s.examples, issue].sort((a, b) => b.severity - a.severity).slice(0, 5);
    }
  }
  return Array.from(map.values())
    .map(s => ({ ...s, severity: s.severity / s.total }))
    .sort((a, b) => b.total * b.severity - a.total * a.severity);
}

// ---- PGN helpers ----
function headersFromPgn(pgn: string) {
  const read = (name: string) => pgn.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`))?.[1];
  const rating = (name: string) => {
    const value = Number(read(name));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    white: read("White"),
    black: read("Black"),
    whiteRating: rating("WhiteElo"),
    blackRating: rating("BlackElo"),
    url: read("Link") ?? read("Site")
  };
}

function resultForColor(color: Color, game: ParsedGame, pgnResult?: string): GameSummary["result"] {
  const code = color === "w" ? game.whiteResult : game.blackResult;
  if (code === "win") return "win";
  if (code && ["checkmated","timeout","resigned","lose","abandoned"].includes(code)) return "loss";
  if (code && ["agreed","repetition","stalemate","insufficient","50move","timevsinsufficient"].includes(code)) return "draw";
  if (pgnResult === "1-0") return color === "w" ? "win" : "loss";
  if (pgnResult === "0-1") return color === "b" ? "win" : "loss";
  if (pgnResult === "1/2-1/2") return "draw";
  return "unknown";
}

function openingFromGame(ecoUrl?: string, pgn?: string): string | undefined {
  const fromPgn = pgn?.match(/\[Opening\s+"([^"]+)"\]/)?.[1];
  if (fromPgn) return fromPgn;
  const slug = ecoUrl?.split("/openings/")[1];
  if (!slug) return undefined;
  return decodeURIComponent(slug).replace(/-\d+$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
