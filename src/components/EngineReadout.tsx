import { Activity } from "lucide-react";
import type { EngineEvaluation } from "../engine/useStockfish";

interface Props {
  evaluation?: EngineEvaluation | null;
  ready?: boolean;
  error?: string;
  flipped?: boolean;
  compact?: boolean;
}

export default function EngineReadout({ evaluation, ready, error, flipped = false, compact = false }: Props) {
  const lines = evaluation?.lines?.length
    ? evaluation.lines
    : evaluation?.pv
      ? [{ multipv: 1, bestMove: evaluation.bestMove || evaluation.pv.split(" ")[0], evalCp: evaluation.evalCp, mate: evaluation.mate, pv: evaluation.pv, depth: evaluation.depth }]
      : [];

  return (
    <div className={`engine-readout ${compact ? "compact" : ""}`}>
      <EvalBar evaluation={evaluation} flipped={flipped} />
      <div className="engine-lines">
        <div className="engine-readout-header">
          <Activity size={15} />
          <span>{error ? "Engine unavailable" : evaluation ? `Depth ${evaluation.depth || "..."} ${evaluation.confidence ? `- ${evaluation.confidence}` : ""}` : ready ? "Calculating" : "Starting engine"}</span>
          <strong>{formatEval(evaluation?.evalCp, evaluation?.mate) || "..."}</strong>
        </div>
        <div className="candidate-lines">
          {lines.length ? lines.slice(0, 3).map(line => (
            <div className="candidate-line" key={`${line.multipv}-${line.pv}`}>
              <span>#{line.multipv}</span>
              <strong>{formatUci(line.bestMove)}</strong>
              <b>{formatEval(line.evalCp, line.mate) || "..."}</b>
              <small>{line.pv.split(" ").slice(1, compact ? 4 : 6).map(formatUci).join(" ")}</small>
            </div>
          )) : (
            <div className="candidate-line muted">
              <span>...</span>
              <strong>{error ? "Offline" : ready ? "Thinking" : "Booting"}</strong>
              <b>...</b>
              <small>{error || "Engine lines will appear here."}</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EvalBar({ evaluation, flipped = false }: { evaluation?: EngineEvaluation | null; flipped?: boolean }) {
  const whitePct = evalToWhitePercent(evaluation?.evalCp, evaluation?.mate);
  const displayPct = flipped ? 100 - whitePct : whitePct;
  return (
    <div className="visual-eval-bar" aria-label={`Evaluation ${formatEval(evaluation?.evalCp, evaluation?.mate) || "calculating"}`}>
      <span className="eval-black" />
      <span className="eval-white" style={{ height: `${displayPct}%` }} />
      <b>{formatEval(evaluation?.evalCp, evaluation?.mate) || "..."}</b>
    </div>
  );
}

export function formatEval(evalCp?: number, mate?: number) {
  if (typeof mate === "number") return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (typeof evalCp !== "number") return "";
  if (Math.abs(evalCp) >= 90_000) return evalCp > 0 ? "+M" : "-M";
  const pawns = evalCp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export function formatUci(uci?: string) {
  if (!uci) return "";
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ""}`;
}

function evalToWhitePercent(evalCp?: number, mate?: number) {
  if (typeof mate === "number") return mate > 0 ? 96 : 4;
  if (typeof evalCp !== "number") return 50;
  return Math.max(4, Math.min(96, 50 + evalCp / 18));
}
