import { Chess, PieceSymbol } from "chess.js";
import { EngineEvaluation } from "../engine/useStockfish";
import { scoreForColor as engineScoreForColor } from "../engine/EngineService";
import { sanForUciMove } from "./openingBook";

export type DrillJudgement = {
  status: "correct" | "wrong" | "theory";
  bestMove: string;
  playedSan: string;
  message: string;
  engineLine: string;
};

export function judgeDrillMove({
  fen,
  uci,
  engine,
  rejectedMove,
  preferredMove,
  problemExplanation,
}: {
  fen: string;
  uci: string;
  engine: EngineEvaluation;
  rejectedMove?: string;
  preferredMove?: string;
  problemExplanation?: string;
}): DrillJudgement {
  const playedSan = sanForUciMove(fen, uci) || uci;
  const materialGain = materialGainForMove(fen, uci);
  const bestMove = chooseBestMove(engine, rejectedMove, preferredMove);

  if (rejectedMove && sameMove(rejectedMove, uci)) {
    return {
      status: "wrong",
      bestMove,
      playedSan,
      message: problemExplanation || `${playedSan} was the move from your game. Find the improvement that avoids the original problem.`,
      engineLine: engine.pv,
    };
  }

  const isEngineChoice = bestMove && sameMove(bestMove, uci);
  const isCloseMaterialAlternative = materialGain >= 3 && isWithinEngineMargin(fen, uci, engine, 50, rejectedMove);
  if (isCloseMaterialAlternative) {
    return {
      status: "correct",
      bestMove: bestMove || uci,
      playedSan,
      message: `${playedSan} wins material and stays close to the engine's preferred line.`,
      engineLine: engine.pv,
    };
  }

  if (isEngineChoice) {
    return {
      status: "correct",
      bestMove,
      playedSan,
      message: "That matches the engine's preferred move from this mistake position.",
      engineLine: engine.pv,
    };
  }

  return {
    status: "wrong",
    bestMove,
    playedSan,
    message: bestMove
      ? "This is playable only if it solves the concrete threat; the engine prefers another move here."
      : "I could not get a reliable engine recommendation for this position.",
    engineLine: engine.pv,
  };
}

function chooseBestMove(engine: EngineEvaluation, rejectedMove?: string, preferredMove?: string) {
  if (preferredMove && (!rejectedMove || !sameMove(preferredMove, rejectedMove))) return preferredMove;
  if (engine.bestMove && (!rejectedMove || !sameMove(engine.bestMove, rejectedMove))) return engine.bestMove;
  const alternate = engine.lines?.find(line => line.bestMove && (!rejectedMove || !sameMove(line.bestMove, rejectedMove)));
  return alternate?.bestMove || engine.bestMove || preferredMove || "";
}

function sameMove(a: string, b: string) {
  const left = normalizeUci(a);
  const right = normalizeUci(b);
  if (!left || !right) return false;
  return left === right;
}

function normalizeUci(move: string) {
  const match = move.trim().toLowerCase().match(/^([a-h][1-8][a-h][1-8][qrbn]?)/);
  return match?.[1] || "";
}

function isWithinEngineMargin(fen: string, uci: string, engine: EngineEvaluation, marginCp: number, rejectedMove?: string) {
  if (!engine.bestMove || sameMove(engine.bestMove, uci)) return true;
  if (rejectedMove && sameMove(rejectedMove, uci)) return false;
  const playedLine = engine.lines?.find(line => sameMove(line.bestMove, uci));
  const bestLine = engine.lines?.find(line => line.bestMove && (!rejectedMove || !sameMove(line.bestMove, rejectedMove))) ??
    engine.lines?.find(line => sameMove(line.bestMove, engine.bestMove)) ??
    engine.lines?.[0];
  if (!playedLine || !bestLine) return false;
  const color = fen.split(" ")[1] === "b" ? "b" : "w";
  const bestScore = scoreForColor(bestLine, color);
  const playedScore = scoreForColor(playedLine, color);
  return bestScore - playedScore <= marginCp;
}

function scoreForColor(evaluation: Pick<EngineEvaluation, "evalCp" | "mate">, color: "w" | "b") {
  return engineScoreForColor({ cp: evaluation.evalCp, mate: evaluation.mate }, color);
}

const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3.15, r: 5, q: 9, k: 0 };

function materialGainForMove(fen: string, uci: string) {
  try {
    const before = new Chess(fen);
    const color = before.turn();
    const beforeScore = materialScore(before, color);
    const played = before.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    if (!played) return 0;
    return materialScore(before, color) - beforeScore;
  } catch {
    return 0;
  }
}

function materialScore(chess: Chess, color: "w" | "b") {
  return chess.board().flat().reduce((score, piece) => {
    if (!piece) return score;
    return score + (piece.color === color ? values[piece.type] : -values[piece.type]);
  }, 0);
}
