import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Chess } from "chess.js";
import { ArrowLeft, ArrowRight, RotateCw, Check, X, Cpu, Search, Lightbulb } from "lucide-react";
import type { MoveIssue, MoveReviewQuality, PatternSummary } from "../analysis/patterns";
import ChessBoard from "./ChessBoard";
import { EngineEvaluation, useStockfish } from "../engine/useStockfish";
import { DEFAULT_ENGINE_DEPTH } from "../engine/EngineService";
import { judgeDrillMove } from "../chess/drillEvaluator";

type TrainableQuality = "blunder" | "miss" | "mistake";

interface Props {
  issues: MoveIssue[];
  summaries?: PatternSummary[];
  initialIssue?: MoveIssue | null;
  qualityFilter?: MoveReviewQuality | "all";
  patternId?: string;
  onQualityFilterChange?: (quality: MoveReviewQuality | "all") => void;
  onPatternChange?: (patternId: string) => void;
  onAnalyze?: (fen: string, flipped?: boolean, title?: string) => void;
  startInPuzzle?: boolean;
  launchKey?: number;
  returnToSourceOnPuzzleBack?: boolean;
  onBack: () => void;
}

export default function DrillPanel({ issues, summaries = [], initialIssue, qualityFilter = "blunder", patternId = "all", onQualityFilterChange, onPatternChange, onAnalyze, startInPuzzle = false, launchKey = 0, returnToSourceOnPuzzleBack = false, onBack }: Props) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"categories" | "puzzle">(startInPuzzle ? "puzzle" : "categories");
  const [feedback, setFeedback] = useState<"idle" | "thinking" | "correct" | "wrong" | "theory" | "engine">("idle");
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [currentFen, setCurrentFen] = useState("");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [bestMove, setBestMove] = useState("");
  const [engineLine, setEngineLine] = useState("");
  const [engineEval, setEngineEval] = useState<EngineEvaluation | null>(null);
  const [judgementText, setJudgementText] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const movePendingRef = useRef(false);
  const mountedRef = useRef(true);
  const actionTokenRef = useRef(0);
  const { ready, error, evaluatePosition } = useStockfish();
  const effectiveQuality: TrainableQuality | "all" =
    qualityFilter === "miss" || qualityFilter === "mistake" || qualityFilter === "all" ? qualityFilter : "blunder";

  const trainingIssues = useMemo(() => {
    const seen = new Set<string>();
    return issues
      .filter(issue => patternId === "all" || issue.id === patternId)
      .filter(issue => effectiveQuality === "all" || issueQualityBucket(issue) === effectiveQuality)
      .sort((a, b) => b.severity - a.severity)
      .filter(issue => {
        const key = `${issue.fenBefore}|${issue.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [issues, patternId, effectiveQuality]);

  const issue = trainingIssues[index] || trainingIssues[0];
  const categoryCards = useMemo(() => {
    const unique = (source: MoveIssue[]) => {
      const seen = new Set<string>();
      return source.filter(issue => {
        if (effectiveQuality !== "all" && issueQualityBucket(issue) !== effectiveQuality) return false;
        const key = `${issue.fenBefore}|${issue.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    return [
      {
        id: "all",
        title: "All Puzzles",
        advice: "A mixed queue from every recurring mistake pattern.",
        total: unique(issues).length,
        severity: Math.max(...unique(issues).map(issue => issue.severity), 0),
      },
      ...summaries.map(summary => {
        const matches = unique(issues.filter(issue => issue.id === summary.id));
        return {
          id: summary.id,
          title: summary.title,
          advice: summary.advice,
          total: matches.length,
          severity: Math.max(summary.severity, ...matches.map(issue => issue.severity), 0),
        };
      }),
    ].filter(card => card.total > 0);
  }, [issues, summaries, effectiveQuality]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!initialIssue) return;
    const nextIndex = trainingIssues.findIndex(issue => issue.fenBefore === initialIssue.fenBefore && issue.san === initialIssue.san);
    if (nextIndex >= 0) setIndex(nextIndex);
  }, [initialIssue, trainingIssues]);

  useEffect(() => {
    setMode(startInPuzzle ? "puzzle" : "categories");
  }, [launchKey, startInPuzzle]);

  useEffect(() => {
    actionTokenRef.current += 1;
    setFeedback("idle");
    setLastMove(undefined);
    setBestMove("");
    setEngineLine("");
    setEngineEval(null);
    setJudgementText("");
    setHintLevel(0);
    setHintSquare(null);
    setCurrentFen(issue?.fenBefore || "");
    movePendingRef.current = false;
  }, [index, issue]);

  useEffect(() => {
    if (index >= trainingIssues.length) setIndex(0);
  }, [index, trainingIssues.length]);

  useEffect(() => {
    setIndex(0);
    setScore(0);
    setAttempts(0);
    setCompleted(new Set());
  }, [effectiveQuality, patternId]);

  const handleMove = useCallback(async (from: string, to: string, promotion?: string) => {
    if (!issue || movePendingRef.current || feedback === "thinking" || feedback === "correct" || feedback === "theory") return;
    movePendingRef.current = true;
    const actionToken = ++actionTokenRef.current;
    const userMove = `${from}${to}${promotion || ""}`;
    setLastMove({ from, to });
    setFeedback("thinking");
    setAttempts(prev => prev + 1);

    try {
      const engine = await evaluatePosition(currentFen, DEFAULT_ENGINE_DEPTH);
      if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
      setEngineEval(engine);
      const judgement = judgeDrillMove({ fen: currentFen, uci: userMove, engine });
      setBestMove(judgement.bestMove);
      setEngineLine(judgement.engineLine);
      setJudgementText(judgement.message);

      const board = new Chess(currentFen);
      const played = board.move({ from, to, promotion: promotion || "q" });
      if (!played) {
        if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
        setFeedback("wrong");
        movePendingRef.current = false;
        return;
      }

      if (judgement.status === "correct" || judgement.status === "theory") {
        if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
        setFeedback(judgement.status);
        setScore(prev => prev + 1);
        setCompleted(prev => new Set([...prev, index]));
        setCurrentFen(board.fen());
      } else {
        if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
        setFeedback("wrong");
        setCurrentFen(issue.fenBefore);
        movePendingRef.current = false;
      }
    } catch {
      if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
      setJudgementText("The engine could not evaluate that move. Reset and try again.");
      setFeedback("wrong");
      movePendingRef.current = false;
    }
  }, [issue, index, currentFen, evaluatePosition, feedback]);

  const resetPosition = () => {
    actionTokenRef.current += 1;
    setFeedback("idle");
    movePendingRef.current = false;
    setLastMove(undefined);
    setJudgementText("");
    setHintLevel(0);
    setHintSquare(null);
    setBestMove("");
    setEngineLine("");
    setEngineEval(null);
    setCurrentFen(issue?.fenBefore || "");
  };

  const showHint = async () => {
    if (!issue) return;
    if (hintSquare) {
      setHintSquare(null);
      setHintLevel(0);
      return;
    }
    const actionToken = ++actionTokenRef.current;
    const engine = await evaluatePosition(currentFen, DEFAULT_ENGINE_DEPTH);
    if (!mountedRef.current || actionToken !== actionTokenRef.current) return;
    setEngineEval(engine);
    setBestMove(engine.bestMove);
    setHintSquare(engine.bestMove ? engine.bestMove.slice(0, 2) : null);
    setHintLevel(engine.bestMove ? 1 : 0);
  };

  const next = () => {
    actionTokenRef.current += 1;
    setIndex(prev => (prev + 1) % trainingIssues.length);
  };
  const prev = () => {
    actionTokenRef.current += 1;
    setIndex(prev => (prev - 1 + trainingIssues.length) % trainingIssues.length);
  };
  const openCategory = (nextPatternId: string) => {
    onPatternChange?.(nextPatternId);
    onQualityFilterChange?.(effectiveQuality);
    setIndex(0);
    setCompleted(new Set());
    setScore(0);
    setAttempts(0);
    setMode("puzzle");
  };

  if (mode === "categories") {
    return (
      <section className="drill-category-screen mobile-screen">
        <div className="screen-intro">
          <span className="eyebrow">Drill Mode</span>
          <h2>Choose a pattern</h2>
          <p>Train one recurring weakness, or mix everything into one puzzle queue.</p>
        </div>
        <div className="drill-category-grid">
          {categoryCards.map(card => (
            <button key={card.id} className={card.id === "all" ? "drill-category-card all" : "drill-category-card"} onClick={() => openCategory(card.id)}>
              <span>{card.id === "all" ? "Mixed queue" : "Pattern"}</span>
              <strong>{card.title}</strong>
              <p>{card.advice}</p>
              <b>{card.total} {card.total === 1 ? "puzzle" : "puzzles"}</b>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (!trainingIssues.length) {
    return (
      <div className="drill-section">
        <div className="drill-header">
          <h2>Personal trainer</h2>
          <button className="ghost-button" onClick={onBack}>Exit drills</button>
        </div>
        <div className="drill-tabs">
          {(["all", "blunder", "miss", "mistake"] as Array<TrainableQuality | "all">).map(quality => (
            <button
              key={quality}
              className={effectiveQuality === quality ? "active" : ""}
              onClick={() => onQualityFilterChange?.(quality)}
            >
              {quality === "all" ? "All" : quality === "blunder" ? "Blunders" : quality === "miss" ? "Misses" : "Mistakes"}
            </button>
          ))}
        </div>
        <label className="drill-category-select">
          <span>Training Category</span>
          <select value={patternId} onChange={event => onPatternChange?.(event.target.value)}>
            <option value="all">All mistake categories</option>
            {summaries.map(summary => (
              <option key={summary.id} value={summary.id}>{summary.title} ({summary.total})</option>
            ))}
          </select>
        </label>
        <div className="empty-drill-state">
          <h3>No {effectiveQuality === "all" ? "mistakes" : effectiveQuality === "blunder" ? "blunders" : effectiveQuality === "miss" ? "misses" : "mistakes"} in this category</h3>
          <p>Choose another mistake type or return to Mistake Lab to pick a different training theme.</p>
        </div>
      </div>
    );
  }

  const highlights: Record<string, string> = {};
  if (feedback === "wrong" && lastMove) {
    highlights[lastMove.from] = "rgba(220,38,38,0.22)";
    highlights[lastMove.to] = "rgba(220,38,38,0.22)";
  }
  if ((feedback === "correct" || feedback === "theory" || feedback === "engine") && lastMove) {
    highlights[lastMove.from] = "rgba(22,163,74,0.2)";
    highlights[lastMove.to] = "rgba(22,163,74,0.2)";
  }
  if (hintSquare) {
    highlights[hintSquare] = "rgba(183,226,107,0.32)";
  }

  return (
    <div className="drill-section mobile-screen">
      <div className="drill-header hero-drill-header">
        <button className="icon-button bordered" onClick={() => returnToSourceOnPuzzleBack ? onBack() : setMode("categories")} aria-label={returnToSourceOnPuzzleBack ? "Back to Mistake Lab" : "Back to drill categories"}><ArrowLeft size={18} /></button>
        <div>
          <span className="eyebrow">Position {index + 1} / {trainingIssues.length}</span>
          <h2>{issue.title}</h2>
        </div>
        <button className="icon-button bordered" onClick={() => onAnalyze?.(currentFen || issue.fenBefore, issue.color === "black", issue.title)} aria-label="Analyze position"><Search size={18} /></button>
      </div>

      <div className="drill-board-area">
        <ChessBoard
          fen={currentFen || issue.fenBefore}
          flipped={issue.color === "black"}
          highlightSquares={highlights}
          lastMove={lastMove}
          arrows={(feedback === "wrong" || feedback === "correct" || feedback === "theory") && bestMove ? [{ from: bestMove.slice(0, 2), to: bestMove.slice(2, 4), color: feedback === "wrong" ? "rgba(230,79,79,0.72)" : "rgba(22,163,74,0.72)" }] : undefined}
          interactive
          onMove={handleMove}
          size={620}
        />
      </div>

      <div className="drill-feedback compact">
        <div>
          <strong>
            {feedback === "thinking" ? "Checking" :
              feedback === "correct" || feedback === "theory" ? "Solved" :
                feedback === "wrong" ? "Try again" :
                  `${issue.color} to move`}
          </strong>
          <span>{issue.opening || issue.phase}</span>
        </div>
        {feedback === "thinking" && <Cpu size={18} className="engine-icon" />}
        {(feedback === "correct" || feedback === "theory") && <Check size={18} className="correct-icon" />}
        {feedback === "wrong" && <X size={18} className="wrong-icon" />}
        {engineLine && (feedback === "correct" || feedback === "wrong") && <small>{engineLine.split(" ").slice(0, 5).map(formatUci).join(" ")}</small>}
        <div className="status-segments" aria-label={`${completed.size} of ${trainingIssues.length} completed`}>
          {trainingIssues.slice(0, 12).map((_, segmentIndex) => (
            <i key={segmentIndex} className={completed.has(segmentIndex) ? "done" : segmentIndex === index ? "current" : ""} />
          ))}
        </div>
      </div>

      <div className="drill-action-bar" aria-label="Drill controls">
        <button className="ghost-button" onClick={prev} aria-label="Previous puzzle"><ArrowLeft size={17} /></button>
        <button className="ghost-button" onClick={resetPosition} aria-label="Reset position"><RotateCw size={17} /></button>
        <button className={hintSquare ? "primary-button active" : "primary-button"} onClick={showHint} aria-label={hintSquare ? "Hide hint" : "Get hint"}><Lightbulb size={17} /></button>
        <button className="ghost-button" onClick={next} aria-label="Next puzzle"><ArrowRight size={17} /></button>
      </div>

      <details className="drill-filter-drawer">
        <summary>Training set</summary>
      <div className="drill-tabs">
          {(["all", "blunder", "miss", "mistake"] as Array<TrainableQuality | "all">).map(quality => (
            <button
              key={quality}
              className={effectiveQuality === quality ? "active" : ""}
            onClick={() => onQualityFilterChange?.(quality)}
          >
              {quality === "all" ? "All" : quality === "blunder" ? "Blunders" : quality === "miss" ? "Misses" : "Mistakes"}
          </button>
        ))}
      </div>
      <label className="drill-category-select drill-category-after">
        <span>Training Category</span>
        <select value={patternId} onChange={event => onPatternChange?.(event.target.value)}>
          <option value="all">All mistake categories</option>
          {summaries.map(summary => (
            <option key={summary.id} value={summary.id}>{summary.title} ({summary.total})</option>
          ))}
        </select>
      </label>
      </details>
    </div>
  );
}

function issueQuality(issue: MoveIssue): MoveReviewQuality {
  return issue.quality ?? severityToQuality(issue.severity);
}

function issueQualityBucket(issue: MoveIssue): TrainableQuality {
  const quality = issueQuality(issue);
  if (quality === "blunder" || quality === "miss") return quality;
  return "mistake";
}

function severityToQuality(severity: number): MoveReviewQuality {
  if (severity >= 7) return "blunder";
  if (severity >= 5) return "mistake";
  return "inaccuracy";
}

function trainingPrompt(issue: MoveIssue) {
  if (issue.id === "twoMoveBlindspot") return "Before moving, ask: what is the opponent's most forcing reply if I play my first idea?";
  if (issue.id === "missedForcingMove") return "There is a forcing candidate here. Look for checks, captures, and threats before quiet moves.";
  if (issue.id === "loosePiece") return "One of your pieces can become tactically vulnerable. Find the move that keeps material safe.";
  if (issue.id === "kingShelter") return "Your king safety is the theme. Find the move that avoids opening lines around your king.";
  if (issue.id === "conversion") return "You have something to convert. Prefer moves that reduce counterplay or simplify cleanly.";
  if (issue.id === "delayedCastle") return "Your king is still a long-term target. Find the move that improves king safety.";
  return "Solve this like a real game position. Choose the move you wish you had played.";
}

function formatUci(uci: string) {
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ""}`;
}
