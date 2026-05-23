import { Chess } from "chess.js";
import type { MoveIssue, MoveReview } from "./patterns";
import type { MoveEngineResult } from "../engine/EngineService";
import { openingVerdictForMove, sanForUciMove } from "../chess/openingBook";

export type MoveExplanation = {
  title: string;
  explanation: string;
  keyIdeas: string[];
  plan: string[];
  nextMoves: string[];
  source: "opening" | "engine" | "pattern" | "mixed";
  bestMove?: string;
  evalBefore?: string;
  evalAfter?: string;
  evalLoss?: string;
  pv?: string;
  confidence?: string;
  opening?: string;
};

export type ExplainMoveInput = {
  fenBefore: string;
  moveSan?: string;
  moveUci?: string;
  review?: MoveReview | null;
  issue?: MoveIssue | null;
};

export type EngineExplainer = (request: {
  fenBefore: string;
  playedUci: string;
}) => Promise<MoveEngineResult>;

export async function explainMove(input: ExplainMoveInput, engine?: EngineExplainer): Promise<MoveExplanation> {
  const playedUci = input.moveUci || uciForMove(input.fenBefore, input.moveSan);
  const playedSan = input.moveSan || (playedUci ? sanForUciMove(input.fenBefore, playedUci) : "") || "that move";
  const book = openingVerdictForMove(input.fenBefore, playedUci || playedSan);
  const pattern = input.issue || issueLikeFromReview(input.review);

  let engineResult: MoveEngineResult | null = null;
  let engineError = "";
  if (engine && playedUci) {
    try {
      engineResult = await engine({ fenBefore: input.fenBefore, playedUci });
    } catch (error) {
      engineError = error instanceof Error ? error.message : "Engine analysis failed.";
    }
  }

  if (book && (!engineResult || engineResult.evalLossCp <= 60)) {
    return {
      title: `${book.name}${book.variation ? `: ${book.variation}` : ""}`,
      explanation: `${playedSan} is protected by opening theory here. ${book.reason}`,
      keyIdeas: ["Known opening purpose", "Do not overrule theory with one engine number", "Check the forcing reply before memorizing"],
      plan: ["Name the purpose of the move", "Check opponent checks, captures, and threats", "Only then compare engine alternatives"],
      nextMoves: [playedSan, "Review the critical reply", engineResult?.bestMove ? formatMove(input.fenBefore, engineResult.bestMove) : ""].filter(Boolean),
      source: engineResult ? "mixed" : "opening",
      bestMove: engineResult?.bestMove ? formatMove(input.fenBefore, engineResult.bestMove) : undefined,
      evalBefore: engineResult ? formatEval(engineResult.evalBefore.cp, engineResult.evalBefore.mate) : undefined,
      evalAfter: engineResult ? formatEval(engineResult.evalAfter.cp, engineResult.evalAfter.mate) : undefined,
      evalLoss: engineResult ? formatCpLoss(engineResult.evalLossCp) : undefined,
      pv: engineResult?.multipv?.[0]?.pv ? formatPv(input.fenBefore, engineResult.multipv[0].pv) : undefined,
      confidence: engineResult?.confidence,
      opening: `${book.eco} · ${book.name}`,
    };
  }

  const bestMove = engineResult?.bestMove || input.review?.engineBestMove || input.issue?.engineBestMove || input.review?.engineLines?.[0]?.bestMove || "";
  const bestSan = bestMove ? formatMove(input.fenBefore, bestMove) : "";
  const loss = engineResult?.evalLossCp ?? input.review?.engineEvalLoss ?? input.issue?.engineEvalLoss;
  const title = titleForMove({ playedSan, patternTitle: pattern?.title, loss });
  const explanation = explanationForMove({
    playedSan,
    bestSan,
    pattern,
    engineResult,
    engineError,
  });

  return {
    title,
    explanation,
    keyIdeas: keyIdeasForMove(pattern?.title, loss, bestSan),
    plan: planForMove(pattern?.title, bestSan),
    nextMoves: [playedSan, replyFromPv(input.fenBefore, engineResult?.multipv?.[0]?.pv || input.review?.engineLines?.[0]?.pv), bestSan].filter(Boolean),
    source: engineResult ? (pattern ? "mixed" : "engine") : "pattern",
    bestMove: bestSan || undefined,
    evalBefore: engineResult ? formatEval(engineResult.evalBefore.cp, engineResult.evalBefore.mate) : formatOptionalCp(input.review?.engineEvalBefore),
    evalAfter: engineResult ? formatEval(engineResult.evalAfter.cp, engineResult.evalAfter.mate) : formatOptionalCp(input.review?.engineEvalAfter),
    evalLoss: typeof loss === "number" ? formatCpLoss(loss) : undefined,
    pv: engineResult?.multipv?.[0]?.pv ? formatPv(input.fenBefore, engineResult.multipv[0].pv) : input.review?.engineLines?.[0]?.pv,
    confidence: engineResult?.confidence || input.review?.engineConfidence,
    opening: input.review?.opening || input.issue?.opening,
  };
}

function uciForMove(fen: string, san?: string) {
  if (!san) return "";
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(san)) return san;
  try {
    const board = new Chess(fen);
    const move = board.move(san, { strict: false });
    return move ? `${move.from}${move.to}${move.promotion || ""}` : "";
  } catch {
    return "";
  }
}

function issueLikeFromReview(review?: MoveReview | null) {
  if (!review) return null;
  return {
    title: review.title,
    explanation: review.explanation,
    advice: "Compare the played move with the forcing reply, then drill the pattern until the reply is automatic.",
    engineBestMove: review.engineBestMove,
    engineEvalLoss: review.engineEvalLoss,
    opening: review.opening,
  };
}

function titleForMove({ playedSan, patternTitle, loss }: { playedSan: string; patternTitle?: string; loss?: number }) {
  if (patternTitle) return patternTitle;
  if (typeof loss === "number" && loss >= 250) return `${playedSan} allows a forcing punishment`;
  if (typeof loss === "number" && loss >= 120) return `${playedSan} gives away the initiative`;
  if (typeof loss === "number" && loss >= 50) return `${playedSan} is slightly imprecise`;
  return `${playedSan} keeps the position playable`;
}

function explanationForMove({
  playedSan,
  bestSan,
  pattern,
  engineResult,
  engineError,
}: {
  playedSan: string;
  bestSan: string;
  pattern: ReturnType<typeof issueLikeFromReview> | MoveIssue | null;
  engineResult: MoveEngineResult | null;
  engineError: string;
}) {
  if (pattern?.explanation) {
    const better = bestSan ? ` The cleaner idea is ${bestSan}.` : "";
    return `${pattern.explanation.replace(/\.$/, "")}.${better}`;
  }
  if (engineResult) {
    const lossText = formatCpLoss(engineResult.evalLossCp);
    const bestText = bestSan ? `${bestSan} is preferred` : "The engine prefers another move";
    return `${playedSan} changes the evaluation by ${lossText}. ${bestText}, because it keeps the forcing reply under control.`;
  }
  if (engineError) {
    return `I could not complete the engine pass, so this explanation is based on the saved pattern data. ${engineError}`;
  }
  return `${playedSan} should be checked against the opponent's most forcing reply before committing.`;
}

function keyIdeasForMove(patternTitle?: string, loss?: number, bestSan?: string) {
  const ideas = new Set<string>();
  if (patternTitle) ideas.add(patternTitle);
  if (typeof loss === "number") ideas.add(loss >= 250 ? "Large evaluation swing" : loss >= 80 ? "Concrete reply matters" : "Small precision edge");
  if (bestSan) ideas.add(`Better idea: ${bestSan}`);
  ideas.add("Checks, captures, threats");
  return [...ideas].slice(0, 4);
}

function planForMove(patternTitle?: string, bestSan?: string) {
  if (patternTitle?.toLowerCase().includes("reply")) {
    return ["Pause after choosing your move", "Ask what their forcing reply is", bestSan ? `Prefer ${bestSan} if it removes the reply` : "Only commit when the reply is handled"];
  }
  if (patternTitle?.toLowerCase().includes("queen")) {
    return ["Check whether the queen is defended", "Look for tempo-gaining attacks", bestSan ? `Use ${bestSan} if it develops and defends` : "Develop before attacking"];
  }
  return ["Identify the threat", "Compare your move with the engine's safer idea", "Replay the position until the cue is automatic"];
}

function replyFromPv(fen: string, pv?: string) {
  if (!pv) return "";
  const moves = pv.split(/\s+/).filter(Boolean);
  if (moves.length < 2) return "";
  try {
    const board = new Chess(fen);
    board.move({ from: moves[0].slice(0, 2), to: moves[0].slice(2, 4), promotion: moves[0][4] });
    return sanForUciMove(board.fen(), moves[1]) || moves[1];
  } catch {
    return moves[1];
  }
}

function formatMove(fen: string, uci: string) {
  return sanForUciMove(fen, uci) || (uci ? `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ""}` : "");
}

function formatPv(fen: string, pv: string) {
  const board = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.split(/\s+/).filter(Boolean).slice(0, 8)) {
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!move) break;
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}

function formatOptionalCp(cp?: number) {
  return typeof cp === "number" ? formatEval(cp) : undefined;
}

function formatEval(cp?: number, mate?: number) {
  if (typeof mate === "number") return `M${mate}`;
  if (typeof cp !== "number") return "...";
  return `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
}

function formatCpLoss(cp: number) {
  if (cp >= 100_000) return "mate";
  return `${Math.max(0, cp / 100).toFixed(cp >= 1000 ? 0 : 1)} pawns`;
}
