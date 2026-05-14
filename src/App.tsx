import { ReactNode, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, BarChart3, Brain, ChevronRight,
  Crown, Dumbbell, FileUp, LoaderCircle, Search, Shield,
  Swords, Target, TrendingUp, Zap
} from "lucide-react";
import { fetchChessComGames, ImportProgress } from "./analysis/chesscom";
import type { AnalysisReport, MoveIssue, PatternSummary, Phase, SkillDimension, TrainingRecommendation } from "./analysis/patterns";
import ChessBoard from "./components/ChessBoard";
import DrillPanel from "./components/DrillPanel";

const samplePgn = `[Event "Training sample"]
[Site "https://www.chess.com/game/live/sample"]
[Date "2026.05.13"]
[White "You"]
[Black "CoachBot"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nc3 Nf6 5. d3 O-O 6. Bg5 h6 7. Bh4 g5
8. Bg3 d6 9. Qd2 Bg4 10. Nxg5 hxg5 11. Qxg5+ Kh7 12. Bh4 Rg8 13. Qd2 Nd4 14. O-O Nf3+ 0-1`;

const phaseLabels: Record<Phase, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
const phases: Phase[] = ["opening", "middlegame", "endgame"];

const dimensionLabels: Record<SkillDimension, string> = {
  tactical: "Tactical",
  positional: "Positional",
  opening: "Opening",
  endgame: "Endgame",
  blunderControl: "Blunders",
  kingSafety: "King safety",
  coordination: "Pieces",
  conversion: "Conversion",
};

export default function App() {
  const [username, setUsername] = useState("");
  const [months, setMonths] = useState(3);
  const [gameLimit, setGameLimit] = useState(150);
  const [timeClass, setTimeClass] = useState<"all" | "rapid" | "blitz" | "bullet" | "daily">("rapid");
  const [pgnText, setPgnText] = useState("");
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<MoveIssue | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showDrills, setShowDrills] = useState(false);

  const topPhase = useMemo<Phase>(() => {
    if (!report) return "opening";
    return ((Object.entries(report.phaseTotals) as [Phase, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "opening") as Phase;
  }, [report]);

  const boardHighlights = useMemo(() => {
    const h: Record<string, string> = {};
    if (!selectedIssue) return h;
    const san = selectedIssue.san;
    let sq = san.includes("x") ? san.replace(/.*x/, "").replace(/[+#]/g, "") : san.replace(/[+#]/g, "");
    if (sq.length >= 2) h[sq.slice(-2)] = "rgba(220,38,38,0.18)";
    return h;
  }, [selectedIssue]);

  async function runChessComImport() {
    setError(""); setLoading(true); setProgress(null);
    try {
      const games = await fetchChessComGames(username, months, timeClass, setProgress);
      const gamesForAnalysis = games.slice(-gameLimit);
      setProgress({ label: `Analyzing ${gamesForAnalysis.length} games`, done: 1, total: 1 });
      const nextReport = await analyzeGamesInWorker({ kind: "chesscom", username, games: gamesForAnalysis });
      setReport(nextReport);
      setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
      if (!nextReport.games) setError("No standard chess games matched that username and filter.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import failed.");
    } finally { setLoading(false); }
  }

  async function runPgnAnalysis(nextText = pgnText) {
    setError("");
    try {
      const nextReport = await analyzeGamesInWorker({ kind: "pgn", username: username || "You", pgnText: nextText });
      setReport(nextReport);
      setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
      if (!nextReport.games) setError("No games were found in that PGN.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PGN could not be analyzed.");
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="mark">♘</div>
            <div>
              <p className="eyebrow">Chess analysis</p>
              <h1>Pattern Coach</h1>
            </div>
          </div>
          <div className="source-note">
            <Activity size={16} />
            <span>{report ? `${report.games} games` : "Ready"}</span>
          </div>
        </header>

        {report && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <button className="ghost-button" onClick={() => setReport(null)}>
              <ArrowLeft size={16} /> New analysis
            </button>
            <button className="primary-button" onClick={() => setShowDrills(true)}>
              <Dumbbell size={16} /> Drill mode
            </button>
          </div>
        )}

        <section className="control-strip">
          <label>
            <span>Username</span>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="hikaru" />
          </label>
          <label>
            <span>Months</span>
            <input type="number" min={1} max={36} value={months} onChange={e => setMonths(Number(e.target.value))} />
          </label>
          <label>
            <span>Game cap</span>
            <input type="number" min={25} max={5000} value={gameLimit} onChange={e => setGameLimit(Number(e.target.value))} />
          </label>
          <label>
            <span>Time</span>
            <select value={timeClass} onChange={e => setTimeClass(e.target.value as typeof timeClass)}>
              <option value="all">All</option>
              <option value="rapid">Rapid</option>
              <option value="blitz">Blitz</option>
              <option value="bullet">Bullet</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <button className="primary-button" onClick={runChessComImport} disabled={loading || !username.trim()}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Import
          </button>
          <label className="file-button">
            <FileUp size={16} /> PGN
            <input type="file" accept=".pgn,.txt" onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setPgnText(text);
              runPgnAnalysis(text);
            }} />
          </label>
        </section>

        {progress && (
          <div className="progress-rail">
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            <strong>{progress.label}</strong>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        {!report ? (
          <EmptyState
            pgnText={pgnText} setPgnText={setPgnText}
            runPgnAnalysis={runPgnAnalysis}
            loadSample={() => { setUsername("You"); setPgnText(samplePgn); runPgnAnalysis(samplePgn); }}
          />
        ) : showDrills ? (
          <DrillPanel issues={report.issues} onBack={() => setShowDrills(false)} />
        ) : (
          <Dashboard
            report={report}
            selectedIssue={selectedIssue}
            setSelectedIssue={setSelectedIssue}
            topPhase={topPhase}
            boardHighlights={boardHighlights}
          />
        )}
      </section>
    </main>
  );
}

type WorkerPayload = { kind: "chesscom"; username: string; games: any[] } | { kind: "pgn"; username: string; pgnText: string };

function analyzeGamesInWorker(payload: WorkerPayload) {
  return new Promise<AnalysisReport>((resolve, reject) => {
    const w = new Worker(new URL("./analysis/analyzer.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ ok: true; report: AnalysisReport } | { ok: false; error: string }>) => {
      w.terminate(); if (e.data.ok) resolve(e.data.report); else reject(new Error(e.data.error));
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || "Worker failed.")); };
    w.postMessage(payload);
  });
}

function EmptyState({ pgnText, setPgnText, runPgnAnalysis, loadSample }: {
  pgnText: string; setPgnText: (t: string) => void; runPgnAnalysis: (t?: string) => void; loadSample: () => void;
}) {
  return (
    <section className="empty-grid">
      <div className="trainer-panel">
        <div className="panel-heading"><Brain size={16} /><h2>Analyze your games</h2></div>
        <textarea value={pgnText} onChange={e => setPgnText(e.target.value)} placeholder="Paste PGN here..." />
        <div className="button-row">
          <button className="primary-button" onClick={() => runPgnAnalysis()} disabled={!pgnText.trim()}>
            <Target size={16} /> Analyze PGN
          </button>
          <button className="ghost-button" onClick={loadSample}>Load sample</button>
        </div>
      </div>
      <div className="board-visual">
        {Array.from({ length: 64 }).map((_, i) => (
          <span key={i} className={(Math.floor(i / 8) + i) % 2 ? "dark" : "light"} />
        ))}
        <strong>♚</strong>
      </div>
    </section>
  );
}

function Dashboard({ report, selectedIssue, setSelectedIssue, topPhase, boardHighlights }: {
  report: AnalysisReport; selectedIssue: MoveIssue | null; setSelectedIssue: (i: MoveIssue) => void;
  topPhase: Phase; boardHighlights: Record<string, string>;
}) {
  const { skillProfile, trainingPlan, moveQuality } = report;

  return (
    <section className="dashboard">
      {/* Metrics */}
      <div className="metric-grid">
        <Metric icon={<Crown size={16} />} label="Games" value={report.games.toString()} />
        <Metric icon={<Swords size={16} />} label="Moves" value={report.moves.toString()} />
        <Metric icon={<Target size={16} />} label="Patterns" value={report.issues.length.toString()} />
        <Metric icon={<TrendingUp size={16} />} label="Est. rating" value={skillProfile.estimatedRating.toString()} />
      </div>

      {/* Coach focus + Board */}
      <section className="coach-grid">
        <div className="trainer-panel priority-panel">
          <div className="panel-heading"><Brain size={16} /><h2>Focus area</h2></div>
          {report.summaries[0] ? (
            <>
              <h3>{report.summaries[0].title}</h3>
              <p>{report.summaries[0].advice}</p>
              <PhaseBars summary={report.summaries[0]} />
            </>
          ) : (
            <p>No recurring patterns found in this sample.</p>
          )}
        </div>

        <div className="trainer-panel board-panel">
          <div className="panel-heading"><Target size={16} /><h2>Position lens</h2></div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ChessBoard
              fen={selectedIssue?.fenAfter || selectedIssue?.fenBefore}
              flipped={selectedIssue?.color === "black"}
              highlightSquares={boardHighlights}
              size={420}
            />
          </div>
          {selectedIssue && (
            <div className="position-caption">
              <strong>{selectedIssue.moveNumber}. {selectedIssue.san}</strong>
              <span>{selectedIssue.explanation}</span>
            </div>
          )}
        </div>
      </section>

      {/* Skill Profile */}
      <section className="skill-section">
        <div className="skill-header"><BarChart3 size={16} /><h2>Skill profile</h2></div>
        <div className="skill-profile-card">
          <div className="skill-profile-header">
            <div className="profile-left">
              <h3>Your chess DNA</h3>
              <p>{skillProfile.descriptions[skillProfile.strongest]}</p>
            </div>
            <div className="rating-display">
              <div className="rating-number">{skillProfile.estimatedRating}</div>
              <div className="rating-label">Estimated rating</div>
            </div>
          </div>

          <div className="dimension-grid">
            {(Object.entries(skillProfile.scores) as [SkillDimension, number][]).map(([dim, score]) => (
              <div key={dim} className="dimension-row">
                <span className="dimension-label">{dimensionLabels[dim]}</span>
                <div className="dimension-bar">
                  <div className="dimension-fill" style={{ width: `${score}%` }} />
                </div>
                <span className="dimension-value">{score}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Move Quality */}
      <section>
        <div className="skill-header"><Zap size={16} /><h2>Move quality distribution</h2></div>
        <div className="quality-grid">
          <QualityChip label="Blunders" value={moveQuality.blunders} />
          <QualityChip label="Mistakes" value={moveQuality.mistakes} />
          <QualityChip label="Inaccuracies" value={moveQuality.inaccuracies} />
          <QualityChip label="Good" value={moveQuality.good} />
          <QualityChip label="Excellent" value={moveQuality.excellent} />
        </div>
      </section>

      {/* Pattern Cards */}
      <section>
        <div className="skill-header"><Target size={16} /><h2>Patterns</h2></div>
        <div className="pattern-list">
          {report.summaries.map(s => (
            <PatternCard key={s.id} summary={s} setSelectedIssue={setSelectedIssue} />
          ))}
        </div>
      </section>

      {/* Training Plan */}
      <section>
        <div className="skill-header"><TrendingUp size={16} /><h2>Training plan</h2></div>
        <div className="training-grid">
          {trainingPlan.map(plan => (
            <TrainingCard key={plan.dimension} plan={plan} />
          ))}
        </div>
      </section>

      {/* Game Table */}
      <section className="trainer-panel">
        <div className="panel-heading"><Activity size={16} /><h2>Games with training signal</h2></div>
        <div className="game-table">
          {report.gameSummaries.slice().sort((a, b) => b.issues - a.issues).slice(0, 8).map((g, i) => (
            <a href={g.url} target="_blank" rel="noreferrer" className="game-row" key={`${g.url}-${i}`}>
              <span>{g.opponent || "Unknown"}</span>
              <span>{g.opening || "—"}</span>
              <span>{g.color}</span>
              <strong>{g.issues}</strong>
            </a>
          ))}
        </div>
      </section>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="metric">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function QualityChip({ label, value }: { label: string; value: number }) {
  return <div className="quality-chip"><strong>{value}</strong><span>{label}</span></div>;
}

function PatternCard({ summary, setSelectedIssue }: { summary: PatternSummary; setSelectedIssue: (i: MoveIssue) => void }) {
  return (
    <article className="pattern-card">
      <div className="pattern-header">
        <div><h3>{summary.title}</h3><p>{summary.advice}</p></div>
        <strong>{summary.total}</strong>
      </div>
      <PhaseBars summary={summary} />
      <div className="examples">
        {summary.examples.map((ex, i) => (
          <button key={`${ex.gameUrl}-${ex.moveNumber}-${i}`} onClick={() => setSelectedIssue(ex)}>
            <span>{ex.moveNumber}. {ex.san}</span>
            <small>{ex.phase}</small>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </article>
  );
}

function PhaseBars({ summary }: { summary: PatternSummary }) {
  const max = Math.max(...Object.values(summary.phases), 1);
  return (
    <div className="phase-bars">
      {phases.map(p => (
        <div key={p}>
          <span>{phaseLabels[p]}</span>
          <i><b style={{ width: `${(summary.phases[p] / max) * 100}%` }} /></i>
          <strong>{summary.phases[p]}</strong>
        </div>
      ))}
    </div>
  );
}

function TrainingCard({ plan }: { plan: TrainingRecommendation }) {
  return (
    <div className="training-card">
      <h4>
        {dimensionLabels[plan.dimension]}
        <span className="priority-badge">Priority {plan.priority}</span>
      </h4>
      <p>{plan.focus}</p>
      <ul>
        {plan.exercises.map((ex, i) => <li key={i}>{ex}</li>)}
      </ul>
      <div className="gain-text">{plan.expectedGain}</div>
    </div>
  );
}