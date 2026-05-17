import type { ComponentProps, ReactNode } from "react";
import ChessBoard from "./ChessBoard";
import type { EngineEvaluation } from "../engine/useStockfish";
import { formatEval } from "./EngineReadout";

type ChessBoardProps = ComponentProps<typeof ChessBoard>;

type BoardFrameProps = ChessBoardProps & {
  evaluation?: EngineEvaluation | null;
  evalCp?: number;
  mate?: number;
  evalLabel?: string;
  className?: string;
  children?: ReactNode;
};

export default function BoardFrame({
  evaluation,
  evalCp,
  mate,
  evalLabel,
  className = "",
  children,
  size = 760,
  ...boardProps
}: BoardFrameProps) {
  const scoreCp = evalCp ?? evaluation?.evalCp;
  const scoreMate = mate ?? evaluation?.mate;
  return (
    <div className={`universal-board-frame ${className}`.trim()}>
      <BoardEvalBar evalCp={scoreCp} mate={scoreMate} flipped={boardProps.flipped} label={evalLabel} />
      <ChessBoard {...boardProps} size={size} />
      {children}
    </div>
  );
}

export function BoardEvalBar({ evalCp, mate, flipped = false, label }: { evalCp?: number; mate?: number; flipped?: boolean; label?: string }) {
  const whitePct = evalToWhitePercent(evalCp, mate);
  const displayPct = flipped ? 100 - whitePct : whitePct;
  const display = label || formatEval(evalCp, mate) || "0.0";
  return (
    <div className="universal-eval-bar" aria-label={`Evaluation ${display}`}>
      <div className="universal-eval-track">
        <span style={{ width: `${displayPct}%` }} />
      </div>
      <strong>{display}</strong>
    </div>
  );
}

function evalToWhitePercent(evalCp?: number, mate?: number) {
  if (typeof mate === "number") return mate > 0 ? 96 : 4;
  if (typeof evalCp !== "number") return 50;
  return Math.max(4, Math.min(96, 50 + evalCp / 18));
}
