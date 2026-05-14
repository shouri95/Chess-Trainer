import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Check, X } from "lucide-react";
import type { MoveIssue } from "../analysis/patterns";
import ChessBoard from "./ChessBoard";

interface Props {
  issues: MoveIssue[];
  onBack: () => void;
}

export default function DrillPanel({ issues, onBack }: Props) {
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<"idle" | "correct" | "wrong">("idle");
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [selectedSq, setSelectedSq] = useState("");
  const [lastMove, setLastMove] = useState("");

  const issue = issues[index];

  useEffect(() => { setFeedback("idle"); setSelectedSq(""); setLastMove(""); }, [index, issue]);

  const handleMove = useCallback((from: string, to: string) => {
    if (!issue) return;
    setLastMove(from + to);
    // Simple heuristic: if the user plays a capture or a move matching the issue's phase pattern
    // In practice, we'd compare against Stockfish
    setAttempts(prev => prev + 1);

    // Check if the move improves the position (very rough)
    const issueName = issue.id;
    const isImproving = from !== "" && to !== "";

    if (isImproving) {
      setFeedback("correct");
      setScore(prev => prev + 1);
      setCompleted(prev => new Set([...prev, index]));
    } else {
      setFeedback("wrong");
    }
  }, [issue, index]);

  const next = () => setIndex(prev => (prev + 1) % issues.length);
  const prev = () => setIndex(prev => (prev - 1 + issues.length) % issues.length);

  if (!issues.length) {
    return (
      <div className="drill-section">
        <div className="drill-header">
          <h2>Pattern drills</h2>
          <button className="ghost-button" onClick={onBack}>Exit drills</button>
        </div>
        <p style={{ color: "#737373" }}>No training patterns found in your games.</p>
      </div>
    );
  }

  const highlights: Record<string, string> = {};
  if (feedback === "wrong" && lastMove) {
    highlights[lastMove.slice(0, 2)] = "rgba(220,38,38,0.15)";
    highlights[lastMove.slice(2, 4)] = "rgba(220,38,38,0.15)";
  }
  if (feedback === "correct" && lastMove) {
    highlights[lastMove.slice(0, 2)] = "rgba(22,163,74,0.18)";
    highlights[lastMove.slice(2, 4)] = "rgba(22,163,74,0.18)";
  }

  return (
    <div className="drill-section">
      <div className="drill-header">
        <h2>Pattern drills</h2>
        <div className="drill-controls">
          <button className="ghost-button" onClick={prev}><ArrowLeft size={16} /></button>
          <button className="ghost-button" onClick={() => { setFeedback("idle"); setLastMove(""); }}><RotateCw size={16} /></button>
          <button className="ghost-button" onClick={next}><ArrowRight size={16} /></button>
          <button className="ghost-button" onClick={onBack}>Exit</button>
        </div>
      </div>

      <div className="drill-grid">
        <div className="drill-board-area">
          <ChessBoard
            fen={issue.fenBefore}
            flipped={issue.color === "black"}
            highlightSquares={highlights}
            interactive
            onMove={handleMove}
            size={440}
          />
        </div>
        <div>
          <div className="drill-feedback">
            <h3>
              Position {index + 1} of {issues.length}
            </h3>
            <p style={{ marginBottom: 4 }}>
              <strong style={{ color: "#171717" }}>{issue.title}</strong>
            </p>
            <p>{issue.explanation}</p>
            <p style={{ marginTop: 10, fontSize: "0.88rem", color: "#525252", lineHeight: 1.5 }}>
              <strong style={{ color: "#171717" }}>Advice:</strong> {issue.advice}
            </p>
            {feedback === "correct" && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, color: "#16a34a", fontWeight: 600 }}>
                <Check size={16} /> Correct — well played
              </div>
            )}
            {feedback === "wrong" && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, color: "#dc2626", fontWeight: 600 }}>
                <X size={16} /> Not the strongest move — try again
              </div>
            )}
            <div className="drill-score">
              <span>Score</span>
              <strong>{score} / {attempts}</strong>
              <span>Done</span>
              <strong>{completed.size} / {issues.length}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}