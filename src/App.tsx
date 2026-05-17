import { Component, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  Activity, ArrowLeft, BarChart3, Brain, ChevronLeft, ChevronRight,
  Crown, Dumbbell, FileUp, LoaderCircle, Search, Shield,
  Swords, Target, TrendingUp, Zap, Menu, LayoutGrid, Skull, Sword, BookOpen, AlertTriangle, CheckCircle2,
  User, X, RefreshCw, Link2, Clock3, Repeat2
} from "lucide-react";
import { fetchChessComGames, fetchChessComProfile, ImportProgress } from "./analysis/chesscom";
import type { AnalysisReport, GameSummary, MoveIssue, MoveReview, MoveReviewQuality, PatternSummary, Phase, SkillDimension, TrainingRecommendation } from "./analysis/patterns";
import ChessBoard from "./components/ChessBoard";
import DrillPanel from "./components/DrillPanel";
import EngineReadout, { formatEval as formatEngineEval, formatUci as formatEngineUci } from "./components/EngineReadout";
import { EngineEvaluation, useStockfish } from "./engine/useStockfish";
import { classifyMoveQuality, DEFAULT_ENGINE_DEPTH, DEFAULT_ENGINE_MULTIPV, type MoveEngineResult } from "./engine/EngineService";
import { isPlaceholderUsername, normalizeStoredProfile, shouldAutoSyncProfile } from "./appPersistence";

const samplePgn = `[Event "Training sample"]
[Site "https://www.chess.com/game/live/sample"]
[Date "2026.05.13"]
[White "Sample"]
[Black "CoachBot"]
[Result "0-1"]

1. e4 e5 2. Qh5 Nf6 3. Bc4 Nxh5 0-1`;

const phaseLabels: Record<Phase, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
const phases: Phase[] = ["opening", "middlegame", "endgame"];
const ENGINE_DEPTH = DEFAULT_ENGINE_DEPTH;
const PROFILE_STORAGE_KEY = "pattern-coach-profile";
const REPORT_STORAGE_KEY = "pattern-coach-report";
const SYNC_META_STORAGE_KEY = "pattern-coach-sync-meta";
const BACKGROUND_ENGINE_REVIEW_LIMIT = 36;
type ReviewBucket = "blunder" | "miss" | "mistake" | "good" | "best";
type TrainableReviewBucket = "blunder" | "miss" | "mistake";

type AnalysisStart = {
  fen: string;
  flipped?: boolean;
  title?: string;
  gamePgn?: string;
};

type SyncMeta = {
  lastSyncedAt?: number;
  source?: "chesscom" | "pgn" | "sample";
  status?: "idle" | "syncing" | "error";
  message?: string;
};

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

function loadSavedReport() {
  const saved = localStorage.getItem(REPORT_STORAGE_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { report?: AnalysisReport };
    return parsed.report ?? null;
  } catch {
    localStorage.removeItem(REPORT_STORAGE_KEY);
    return null;
  }
}

export default function App() {
  const [username, setUsername] = useState("");
  const [months, setMonths] = useState(3);
  const [gameLimit, setGameLimit] = useState(150);
  const [timeClass, setTimeClass] = useState<"all" | "rapid" | "blitz" | "bullet" | "daily">("all");
  const [pgnText, setPgnText] = useState("");
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<MoveIssue | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<"dashboard" | "games" | "mistakes" | "drill" | "analysis">("dashboard");
  const [qualityFilter, setQualityFilter] = useState<MoveReviewQuality | "all">("all");
  const [selectedPatternId, setSelectedPatternId] = useState<string>("all");
  const [selectedGameId, setSelectedGameId] = useState(-1);
  const [analysisStart, setAnalysisStart] = useState<AnalysisStart | null>(null);
  const [analysisReturnView, setAnalysisReturnView] = useState<"dashboard" | "games" | "mistakes" | "drill">("dashboard");
  const [drillStartInPuzzle, setDrillStartInPuzzle] = useState(false);
  const [drillLaunchKey, setDrillLaunchKey] = useState(0);
  const [activeMistakeReviewId, setActiveMistakeReviewId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ status: "idle" });
  const { evaluatePosition, analyzeMovePair } = useStockfish();
  const analysisAbortRef = useRef<AbortController | null>(null);
  const autoSyncRef = useRef("");

  const openAnalysis = (fen?: string, flipped?: boolean, title?: string, context?: Omit<AnalysisStart, "fen" | "flipped" | "title">) => {
    if (!fen) return;
    if (activeView !== "analysis") setAnalysisReturnView(activeView);
    setAnalysisStart({ fen, flipped, title, ...context });
    setActiveView("analysis");
  };

  useEffect(() => {
    const saved = localStorage.getItem(PROFILE_STORAGE_KEY);
    const savedReport = loadSavedReport();
    try {
      if (saved) {
        const parsed = normalizeStoredProfile(JSON.parse(saved));
        if (parsed.username) setUsername(parsed.username);
        if (parsed.months) setMonths(parsed.months);
        if (parsed.gameLimit) setGameLimit(parsed.gameLimit);
        if (parsed.timeClass) setTimeClass(parsed.timeClass);
      }
      if (savedReport) {
        setReport(savedReport);
        setSelectedIssue(savedReport.summaries[0]?.examples[0] ?? null);
      }
      const savedSync = localStorage.getItem(SYNC_META_STORAGE_KEY);
      if (savedSync) setSyncMeta(JSON.parse(savedSync) as SyncMeta);
    } catch {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      localStorage.removeItem(SYNC_META_STORAGE_KEY);
    } finally {
      setProfileHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!profileHydrated) return;
    if (username && !isPlaceholderUsername(username)) {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ username, months, gameLimit, timeClass }));
    } else {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    }
  }, [username, months, gameLimit, timeClass]);

  useEffect(() => {
    if (!profileHydrated) return;
    localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(syncMeta));
  }, [profileHydrated, syncMeta]);

  useEffect(() => {
    if (!profileHydrated) return;
    if (report) {
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), report }));
    } else {
      localStorage.removeItem(REPORT_STORAGE_KEY);
    }
  }, [profileHydrated, report]);

  useEffect(() => {
    return () => analysisAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!report) return;
    const candidates = report.moveReviews
      .filter(review => !review.engineReviewed && review.issueIds.length && isTrainableQuality(review.quality))
      .sort((a, b) => (b.endTime ?? b.gameId) - (a.endTime ?? a.gameId));
    if (!candidates.length) return;
    let cancelled = false;

    async function refineFlaggedMoves() {
      const updates = new Map<string, MoveReview>();
      for (const review of candidates.slice(0, BACKGROUND_ENGINE_REVIEW_LIMIT)) {
        if (cancelled) return;
        try {
          const engine = await analyzeMovePair({
            fenBefore: review.fenBefore,
            playedUci: review.uci,
            depth: ENGINE_DEPTH,
            multipv: DEFAULT_ENGINE_MULTIPV,
          });
          const refined = refineReviewWithEngine(review, engine);
          updates.set(review.id, refined);
        } catch {
          updates.set(review.id, { ...review, engineReviewed: true });
        }
      }
      if (cancelled || !updates.size) return;
      setReport(current => {
        if (!current) return current;
        return {
          ...current,
          moveReviews: current.moveReviews.map(review => updates.get(review.id) || review),
          issues: addEngineIssues(current.issues.map(issue => {
            const update = [...updates.values()].find(review => review.fenBefore === issue.fenBefore && review.san === issue.san);
            return update ? {
              ...issue,
              quality: update.quality,
              severity: update.severity,
              explanation: update.explanation,
              engineBestMove: update.engineBestMove,
              engineEvalLoss: update.engineEvalLoss,
              engineReviewed: true,
            } : issue;
          }), updates),
        };
      });
    }

    refineFlaggedMoves();
    return () => { cancelled = true; };
  }, [report, analyzeMovePair]);

  useEffect(() => {
    const syncUser = username.trim().toLowerCase();
    if (!profileHydrated || !shouldAutoSyncProfile(syncUser, loading)) return;
    const key = `${syncUser}:${months}:${gameLimit}:${timeClass}`;
    if (autoSyncRef.current === key) return;
    autoSyncRef.current = key;
    runChessComImport({ keepCurrentReport: Boolean(report), silent: Boolean(report) });
  }, [profileHydrated, username, months, gameLimit, timeClass]);

  const topPhase = useMemo<Phase>(() => {
    if (!report) return "opening";
    return ((Object.entries(report.phaseTotals) as [Phase, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "opening") as Phase;
  }, [report]);

  const boardHighlights = useMemo(() => {
    const h: Record<string, string> = {};
    if (!selectedIssue) return h;
    const target = selectedIssue.uci.slice(2, 4);
    if (/^[a-h][1-8]$/.test(target)) h[target] = "rgba(220,38,38,0.18)";
    return h;
  }, [selectedIssue]);

  async function runChessComImport(options: { keepCurrentReport?: boolean; silent?: boolean; usernameOverride?: string } = {}) {
    setError(""); setLoading(true); setProgress(options.silent ? null : null);
    setSyncMeta({ status: "syncing", source: "chesscom", message: "Syncing Chess.com games" });
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const progressHandler = options.silent ? undefined : setProgress;
      const syncUsername = options.usernameOverride || username;
      const games = await fetchChessComGames(syncUsername, months, timeClass, progressHandler, gameLimit);
      const gamesForAnalysis = games
        .slice()
        .sort((a, b) => (a.end_time ?? 0) - (b.end_time ?? 0))
        .slice(-gameLimit);
      progressHandler?.({ label: `Analyzing ${gamesForAnalysis.length} games`, done: 1, total: 1 });
      const nextReport = await analyzeGamesInWorker({ kind: "chesscom", username: syncUsername, games: gamesForAnalysis }, controller.signal);
      setReport(nextReport);
      setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
      setQualityFilter("all");
      setSelectedPatternId("all");
      setSelectedGameId(-1);
      setActiveView("dashboard");
      setProfileOpen(false);
      setSyncMeta({
        status: "idle",
        source: "chesscom",
        lastSyncedAt: Date.now(),
        message: `Synced ${nextReport.games} games`,
      });
      if (!nextReport.games) setError("No standard chess games matched that username and filter.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const message = err instanceof Error ? err.message : "The import failed.";
        setError(message);
        setSyncMeta({ status: "error", source: "chesscom", message });
        if (!options.keepCurrentReport) setReport(null);
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setLoading(false);
      if (!options.silent) window.setTimeout(() => setProgress(null), 700);
    }
  }

  async function runChessComConnect() {
    setError("");
    setLoading(true);
    setProgress({ label: "Connecting Chess.com profile", done: 0, total: 1 });
    try {
      const profile = await fetchChessComProfile(username);
      const canonicalUsername = profile.username || username.trim();
      setUsername(canonicalUsername);
      setProgress({ label: "Profile connected", done: 1, total: 1 });
      setProfileOpen(false);
      setSyncMeta({ status: "idle", source: "chesscom", message: "Profile connected" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect that Chess.com profile.");
    } finally {
      setLoading(false);
      window.setTimeout(() => setProgress(null), 700);
    }
  }

  async function runPgnAnalysis(nextText = pgnText, usernameOverride?: string) {
    setError(""); setLoading(true); setProgress({ label: "Analyzing PGN", done: 0, total: 1 });
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const nextReport = await analyzeGamesInWorker({ kind: "pgn", username: usernameOverride || username || "You", pgnText: nextText }, controller.signal);
      setReport(nextReport);
      setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
      setQualityFilter("all");
      setSelectedPatternId("all");
      setSelectedGameId(-1);
      setActiveView("dashboard");
      setProfileOpen(false);
      setSyncMeta({
        status: "idle",
        source: usernameOverride === "Sample" ? "sample" : "pgn",
        lastSyncedAt: Date.now(),
        message: usernameOverride === "Sample" ? "Sample report loaded" : "PGN report loaded",
      });
      if (!nextReport.games) setError("No games were found in that PGN.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "The PGN could not be analyzed.");
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setProgress(null);
      setLoading(false);
    }
  }

  async function runFirstRunConnect() {
    setError("");
    setLoading(true);
    setProgress({ label: "Connecting Chess.com profile", done: 0, total: 1 });
    try {
      const profile = await fetchChessComProfile(username);
      const canonicalUsername = profile.username || username.trim();
      setUsername(canonicalUsername);
      setProgress({ label: "Profile connected", done: 1, total: 2 });
      setLoading(false);
      await runChessComImport({ usernameOverride: canonicalUsername });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect that Chess.com profile.");
      setSyncMeta({ status: "error", source: "chesscom", message: err instanceof Error ? err.message : "Could not connect that Chess.com profile." });
      setLoading(false);
      window.setTimeout(() => setProgress(null), 700);
    }
  }

  return (
    <ErrorBoundary>
    <main className="app-shell">
      <section className={`workspace view-${activeView}`}>
        <header className="topbar">
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Open app menu"><Menu size={21} /></button>
          <div className="brand-lockup">
            <h1>Pattern Coach</h1>
          </div>
          <button className={`avatar ${username ? "connected" : ""}`} onClick={() => setProfileOpen(true)} aria-label="Open profile">
            {username ? username.slice(0, 2).toUpperCase() : <User size={17} />}
          </button>
        </header>

        {progress && activeView === "dashboard" && <ImportStatus progress={progress} />}

        {error && <div className="error-banner">{error}</div>}

        {report ? (
          <>
            {activeView === "dashboard" && (
              <Dashboard
                report={report}
                selectedIssue={selectedIssue}
                setSelectedIssue={setSelectedIssue}
                topPhase={topPhase}
                boardHighlights={boardHighlights}
                openAnalysis={openAnalysis}
                openQuality={(quality) => {
                  setQualityFilter(quality);
                  setDrillStartInPuzzle(false);
                  setDrillLaunchKey(key => key + 1);
                  setActiveView(quality === "good" || quality === "best" ? "games" : "drill");
                }}
                trainNow={() => {
                  setQualityFilter("all");
                  setSelectedPatternId("all");
                  setDrillStartInPuzzle(false);
                  setDrillLaunchKey(key => key + 1);
                  setActiveView("drill");
                }}
                syncMeta={syncMeta}
              />
            )}
            {activeView === "games" && (
              <GamesView
                report={report}
                selectedGameId={selectedGameId}
                setSelectedGameId={setSelectedGameId}
                openMove={(review) => {
                  const issue = report.issues.find(candidate => candidate.fenBefore === review.fenBefore && candidate.san === review.san);
                  if (issue) setSelectedIssue(issue);
                  const bucket = qualityBucket(review.quality);
                  setQualityFilter(bucket);
                  setActiveView(bucket === "good" || bucket === "best" ? "games" : "drill");
                }}
                openAnalysis={openAnalysis}
              />
            )}
            {activeView === "mistakes" && (
              <MistakeLab
                report={report}
                selectedIssue={selectedIssue}
                setSelectedIssue={setSelectedIssue}
                selectedPatternId={selectedPatternId}
                setSelectedPatternId={setSelectedPatternId}
                selectedReviewId={activeMistakeReviewId}
                setSelectedReviewId={setActiveMistakeReviewId}
                startDrill={(quality, patternId = "all", issue) => {
                  setQualityFilter(quality);
                  setSelectedPatternId(patternId);
                  if (issue) setSelectedIssue(issue);
                  setDrillStartInPuzzle(true);
                  setDrillLaunchKey(key => key + 1);
                  setActiveView("drill");
                }}
                openAnalysis={openAnalysis}
              />
            )}
            {activeView === "analysis" && analysisStart && (
              <AnalysisView
                start={analysisStart}
                back={() => setActiveView(analysisReturnView)}
              />
            )}
            {activeView === "drill" && (
              <DrillPanel
                issues={report.issues}
                summaries={report.summaries}
                initialIssue={selectedIssue}
                qualityFilter={qualityFilter}
                patternId={selectedPatternId}
                startInPuzzle={drillStartInPuzzle}
                launchKey={drillLaunchKey}
                onQualityFilterChange={setQualityFilter}
                onPatternChange={setSelectedPatternId}
                onAnalyze={(fen, flipped, title) => openAnalysis(fen, flipped, title)}
                returnToSourceOnPuzzleBack={drillStartInPuzzle}
                onBack={() => setActiveView("mistakes")}
              />
            )}
          </>
        ) : (
          <FirstRunLogin
            username={username}
            setUsername={setUsername}
            loading={loading}
            openProfile={() => setProfileOpen(true)}
            connectAndSync={runFirstRunConnect}
            loadSample={() => { setPgnText(samplePgn); runPgnAnalysis(samplePgn, "Sample"); }}
            error={error}
          />
        )}

        {menuOpen && (
          <AppMenu
            report={report}
            username={username}
            syncMeta={syncMeta}
            loading={loading}
            close={() => setMenuOpen(false)}
            openProfile={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}
            syncGames={() => {
              setMenuOpen(false);
              runChessComImport({ keepCurrentReport: Boolean(report) });
            }}
            clearData={() => {
              localStorage.removeItem(PROFILE_STORAGE_KEY);
              localStorage.removeItem(REPORT_STORAGE_KEY);
              localStorage.removeItem(SYNC_META_STORAGE_KEY);
              setUsername("");
              setReport(null);
              setSyncMeta({ status: "idle" });
              setSelectedIssue(null);
              setMenuOpen(false);
            }}
          />
        )}

        {profileOpen && (
          <ProfileSheet
            username={username}
            setUsername={setUsername}
            months={months}
            setMonths={setMonths}
            gameLimit={gameLimit}
            setGameLimit={setGameLimit}
            timeClass={timeClass}
            setTimeClass={setTimeClass}
            pgnText={pgnText}
            setPgnText={setPgnText}
            loading={loading}
            runChessComConnect={runChessComConnect}
            runChessComImport={() => runChessComImport()}
            runPgnAnalysis={runPgnAnalysis}
            loadSample={() => { setPgnText(samplePgn); runPgnAnalysis(samplePgn, "Sample"); }}
            forgetProfile={() => {
              localStorage.removeItem(PROFILE_STORAGE_KEY);
              localStorage.removeItem(REPORT_STORAGE_KEY);
              localStorage.removeItem(SYNC_META_STORAGE_KEY);
              setUsername("");
              setReport(null);
              setSyncMeta({ status: "idle" });
              setProfileOpen(false);
            }}
            close={() => setProfileOpen(false)}
          />
        )}

        <nav className={`bottom-nav view-${activeView}`}>
          <button className={activeView === "dashboard" ? "active" : ""} onClick={() => setActiveView("dashboard")}><LayoutGrid size={20} /><span>Dashboard</span></button>
          <button className={report && activeView === "games" ? "active" : ""} onClick={() => report ? setActiveView("games") : setProfileOpen(true)}><BookOpen size={20} /><span>Games</span></button>
          <button className={report && activeView === "mistakes" ? "active" : ""} onClick={() => report ? setActiveView("mistakes") : setProfileOpen(true)}><Skull size={20} /><span>Mistake Lab</span></button>
          <button className={report && activeView === "drill" ? "active" : ""} onClick={() => {
            if (!report) {
              setProfileOpen(true);
              return;
            }
            setDrillStartInPuzzle(false);
            setDrillLaunchKey(key => key + 1);
            setActiveView("drill");
          }}><Sword size={20} /><span>Drill Mode</span></button>
        </nav>
      </section>
    </main>
    </ErrorBoundary>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell">
        <section className="workspace">
          <div className="error-boundary-card">
            <h1>Pattern Coach hit a snag</h1>
            <p>The board did not crash silently. Refresh and try the last action again.</p>
            <pre>{this.state.error.message}</pre>
            <button className="primary-button" onClick={() => location.reload()}>Reload app</button>
          </div>
        </section>
      </main>
    );
  }
}

function ImportStatus({ progress }: { progress: ImportProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="import-status">
      <ProgressRing value={pct} size={48} />
      <div>
        <strong>{progress.label}</strong>
        <span>{pct}% complete</span>
      </div>
    </div>
  );
}

function ProgressRing({ value, size = 68 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span
      className="progress-ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--accent) ${clamped * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
      }}
      aria-label={`${clamped}% complete`}
    >
      <b>{clamped}</b>
    </span>
  );
}

type WorkerPayload = { kind: "chesscom"; username: string; games: any[] } | { kind: "pgn"; username: string; pgnText: string };

function analyzeGamesInWorker(payload: WorkerPayload, signal?: AbortSignal) {
  return new Promise<AnalysisReport>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Analysis was cancelled.", "AbortError"));
      return;
    }
    const w = new Worker(new URL("./analysis/analyzer.worker.ts", import.meta.url), { type: "module" });
    const abort = () => {
      w.terminate();
      reject(new DOMException("Analysis was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      w.onmessage = null;
      w.onerror = null;
    };
    w.onmessage = (e: MessageEvent<{ ok: true; report: AnalysisReport } | { ok: false; error: string }>) => {
      cleanup(); w.terminate(); if (e.data.ok) resolve(e.data.report); else reject(new Error(e.data.error));
    };
    w.onerror = e => { cleanup(); w.terminate(); reject(new Error(e.message || "Worker failed.")); };
    w.postMessage(payload);
  });
}

function FirstRunLogin({ username, setUsername, loading, openProfile, connectAndSync, loadSample, error }: {
  username: string;
  setUsername: (value: string) => void;
  loading: boolean;
  openProfile: () => void;
  connectAndSync: () => void;
  loadSample: () => void;
  error?: string;
}) {
  return (
    <section className="login-screen mobile-screen">
      <div className="home-hero login-card">
        <span className="connection-pill">First run</span>
        <h2>Connect your Chess.com games</h2>
        <p>Enter your public Chess.com username once. Pattern Coach will save it locally and refresh your games when you reopen the app.</p>
        <label className="login-username">
          <span>Chess.com username</span>
          <input
            value={username}
            onChange={event => setUsername(event.target.value)}
            placeholder="hikaru"
            autoCapitalize="none"
            autoComplete="username"
          />
        </label>
        {error && <div className="inline-error">{error}</div>}
        <div className="home-actions">
          <button className="primary-button" onClick={connectAndSync} disabled={loading || !username.trim()}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Connect and sync
          </button>
          <button className="ghost-button" onClick={openProfile}>More import options</button>
        </div>
      </div>

      <div className="onboarding-rail">
        <div>
          <RefreshCw size={18} />
          <strong>Auto-sync</strong>
          <span>Your saved username refreshes public games on launch.</span>
        </div>
        <div>
          <Search size={18} />
          <strong>Review</strong>
          <span>Every imported game becomes a move-by-move training map.</span>
        </div>
        <div>
          <Sword size={18} />
          <strong>Train</strong>
          <span>Drill the positions that came from your own games.</span>
        </div>
      </div>

      <button className="sample-link" onClick={loadSample}>Explore with sample data</button>
    </section>
  );
}

function AppMenu({ report, username, syncMeta, loading, close, openProfile, syncGames, clearData }: {
  report: AnalysisReport | null;
  username: string;
  syncMeta: SyncMeta;
  loading: boolean;
  close: () => void;
  openProfile: () => void;
  syncGames: () => void;
  clearData: () => void;
}) {
  return (
    <div className="profile-overlay menu-overlay" role="dialog" aria-modal="true" aria-label="App menu">
      <div className="profile-sheet app-menu-sheet">
        <div className="sheet-header">
          <div>
            <span className="eyebrow">Menu</span>
            <h2>Pattern Coach</h2>
          </div>
          <button className="icon-button sheet-close" onClick={close} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="profile-status-card">
          <div className={`profile-avatar-large ${username ? "connected" : ""}`}>{username ? username.slice(0, 2).toUpperCase() : <User size={22} />}</div>
          <div>
            <strong>{username || "No Chess.com username"}</strong>
            <span>{syncMeta.lastSyncedAt ? `Last synced ${new Date(syncMeta.lastSyncedAt).toLocaleString()}` : syncMeta.message || "Connect to keep games updated."}</span>
          </div>
        </div>
        <div className="menu-action-list">
          <button onClick={openProfile}><User size={17} /> Profile and import</button>
          <button onClick={syncGames} disabled={loading || !username.trim()}><RefreshCw size={17} /> {report ? "Sync latest games" : "Sync games"}</button>
          <a href="/legal/privacy.html" target="_blank" rel="noreferrer"><Shield size={17} /> Privacy policy</a>
          <a href="/legal/terms.html" target="_blank" rel="noreferrer"><FileUp size={17} /> Terms</a>
          <a href="/legal/support.html" target="_blank" rel="noreferrer"><AlertTriangle size={17} /> Support</a>
          <button className="danger-menu-item" onClick={clearData}><X size={17} /> Clear local data</button>
        </div>
      </div>
    </div>
  );
}

function ProfileSheet({ username, setUsername, months, setMonths, gameLimit, setGameLimit, timeClass, setTimeClass, pgnText, setPgnText, loading, runChessComConnect, runChessComImport, runPgnAnalysis, loadSample, forgetProfile, close }: {
  username: string;
  setUsername: (value: string) => void;
  months: number;
  setMonths: (value: number) => void;
  gameLimit: number;
  setGameLimit: (value: number) => void;
  timeClass: "all" | "rapid" | "blitz" | "bullet" | "daily";
  setTimeClass: (value: "all" | "rapid" | "blitz" | "bullet" | "daily") => void;
  pgnText: string;
  setPgnText: (value: string) => void;
  loading: boolean;
  runChessComConnect: () => void;
  runChessComImport: () => void;
  runPgnAnalysis: (text?: string, usernameOverride?: string) => void;
  loadSample: () => void;
  forgetProfile: () => void;
  close: () => void;
}) {
  return (
    <div className="profile-overlay" role="dialog" aria-modal="true">
      <div className="profile-sheet">
        <div className="sheet-header">
          <div>
            <span className="eyebrow">Profile</span>
            <h2>Chess.com connection</h2>
          </div>
          <button className="icon-button sheet-close" onClick={close} aria-label="Close profile"><X size={18} /></button>
        </div>

        <div className="profile-status-card">
          <div className={`profile-avatar-large ${username ? "connected" : ""}`}>{username ? username.slice(0, 2).toUpperCase() : <User size={22} />}</div>
          <div>
            <strong>{username || "No profile connected"}</strong>
            <span>{username ? "Public game sync enabled" : "Enter a Chess.com username to start."}</span>
          </div>
        </div>

        <section className="profile-form">
          <label>
            <span>Chess.com username</span>
            <input value={username} onChange={event => setUsername(event.target.value)} placeholder="hikaru" />
          </label>
          <button className="primary-button profile-sync" onClick={runChessComConnect} disabled={loading || !username.trim()}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Connect instantly
          </button>
          <div className="profile-grid">
            <label>
              <span>Months</span>
              <input type="number" min={1} max={240} value={months} onChange={event => setMonths(Number(event.target.value))} />
            </label>
            <label>
              <span>Game cap</span>
              <input type="number" min={25} max={50000} value={gameLimit} onChange={event => setGameLimit(Number(event.target.value))} />
            </label>
          </div>
          <label>
            <span>Time control</span>
            <select value={timeClass} onChange={event => setTimeClass(event.target.value as typeof timeClass)}>
              <option value="all">All time controls</option>
              <option value="rapid">Rapid</option>
              <option value="blitz">Blitz</option>
              <option value="bullet">Bullet</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <button className="ghost-button profile-sync" onClick={runChessComImport} disabled={loading || !username.trim()}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Sync {timeClass === "all" ? "Chess.com" : timeClass} games
          </button>
          <button className="ghost-button profile-sync" onClick={forgetProfile}>
            Forget profile
          </button>
        </section>

        <details className="pgn-drawer">
          <summary>PGN tools</summary>
          <textarea value={pgnText} onChange={event => setPgnText(event.target.value)} placeholder="Paste PGN here..." />
          <div className="button-row">
            <button className="ghost-button" onClick={() => runPgnAnalysis()} disabled={!pgnText.trim()}><Target size={16} /> Analyze PGN</button>
            <label className="file-button">
              <FileUp size={16} /> Upload PGN
              <input type="file" accept=".pgn,.txt" onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  alert("Please choose a PGN under 5 MB.");
                  event.currentTarget.value = "";
                  return;
                }
                const text = await file.text();
                setPgnText(text);
                runPgnAnalysis(text);
              }} />
            </label>
            <button className="ghost-button" onClick={loadSample}>Load sample</button>
          </div>
        </details>
      </div>
    </div>
  );
}

function Dashboard({ report, selectedIssue, setSelectedIssue, topPhase, boardHighlights, openQuality, trainNow, openAnalysis, syncMeta }: {
  report: AnalysisReport; selectedIssue: MoveIssue | null; setSelectedIssue: (i: MoveIssue) => void;
  topPhase: Phase; boardHighlights: Record<string, string>;
  openQuality: (quality: MoveReviewQuality) => void;
  trainNow: () => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string) => void;
  syncMeta: SyncMeta;
}) {
  const { skillProfile, moveQuality } = report;
  const dueIssues = report.issues
    .slice()
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 4);

  return (
    <section className="dashboard restored-dashboard">
      <div className="dashboard-actions">
        <button className="primary-button" onClick={trainNow}><Dumbbell size={16} /> Drill mode</button>
        <button className="ghost-button" onClick={() => openAnalysis(selectedIssue?.fenBefore, selectedIssue?.color === "black", selectedIssue?.title)} disabled={!selectedIssue}>
          <Search size={16} /> Analyze position
        </button>
      </div>

      <div className="metric-grid">
        <Metric icon={<Crown size={16} />} label="Games" value={report.games.toString()} />
        <Metric icon={<Swords size={16} />} label="Moves" value={report.moves.toString()} />
        <Metric icon={<Target size={16} />} label="Patterns" value={report.issues.length.toString()} />
        <Metric icon={<TrendingUp size={16} />} label="Est. rating" value={skillProfile.estimatedRating.toString()} />
      </div>

      <section className="trainer-panel sync-panel">
        <div className="panel-heading"><RefreshCw size={16} /><h2>Game sync</h2></div>
        <p>{syncMeta.message || "Your latest public Chess.com games will refresh automatically when the app opens."}</p>
        {syncMeta.lastSyncedAt && <small>Last updated {new Date(syncMeta.lastSyncedAt).toLocaleString()}</small>}
      </section>

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
          <div className="dashboard-board-frame">
            <ChessBoard
              fen={selectedIssue?.fenAfter || selectedIssue?.fenBefore}
              flipped={selectedIssue?.color === "black"}
              highlightSquares={boardHighlights}
              onAnalyze={() => openAnalysis(selectedIssue?.fenBefore, selectedIssue?.color === "black", selectedIssue?.title)}
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

      <section>
        <div className="skill-header"><Target size={16} /><h2>Patterns</h2></div>
        <div className="pattern-list">
          {report.summaries.map(s => (
            <PatternCard key={s.id} summary={s} setSelectedIssue={setSelectedIssue} />
          ))}
        </div>
      </section>

      <section className="trainer-panel drill-queue-card">
        <div className="panel-heading"><Clock3 size={16} /><h2>Today&apos;s drill queue</h2></div>
        <div className="due-list">
          {dueIssues.length ? dueIssues.map(issue => (
            <button key={`${issue.fenBefore}-${issue.uci}-${issue.id}`} onClick={() => setSelectedIssue(issue)}>
              <span>{issue.moveNumber}. {issue.san}</span>
              <strong>{issue.title}</strong>
              <small>{issue.opening || issue.phase}</small>
            </button>
          )) : (
            <p>No trainable mistakes yet. Sync more games or paste a PGN to build a queue.</p>
          )}
        </div>
      </section>

      <section className="trainer-panel">
        <div className="panel-heading"><Activity size={16} /><h2>Games with training signal</h2></div>
        <div className="game-table">
          {report.gameSummaries.slice().sort((a, b) => b.issues - a.issues).slice(0, 8).map((g, i) => (
            <a href={g.url} target="_blank" rel="noreferrer" className="game-row" key={`${g.url}-${i}`}>
              <span>{g.opponent || "Unknown"}</span>
              <span>{g.opening || "-"}</span>
              <span>{g.color}</span>
              <strong>{g.issues}</strong>
            </a>
          ))}
        </div>
      </section>
    </section>
  );
}

function QualityReviewCard({ icon, label, value, tone, onClick }: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "bad" | "miss" | "warn" | "engine" | "good" | "neutral";
  onClick: () => void;
}) {
  return (
    <button className={`quality-review-card ${tone}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function MistakeLab({ report, selectedIssue, setSelectedIssue, selectedPatternId, setSelectedPatternId, selectedReviewId, setSelectedReviewId, startDrill, openAnalysis }: {
  report: AnalysisReport;
  selectedIssue: MoveIssue | null;
  setSelectedIssue: (i: MoveIssue) => void;
  selectedPatternId: string;
  setSelectedPatternId: (id: string) => void;
  selectedReviewId: string;
  setSelectedReviewId: (id: string) => void;
  startDrill: (quality: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: Omit<AnalysisStart, "fen" | "flipped" | "title">) => void;
}) {
  const [qualityFilter, setQualityFilter] = useState<TrainableReviewBucket | "all">("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"latest" | "severity">("latest");
  const filterCounts = useMemo(() => {
    const base = report.moveReviews
      .filter(review => timeFilter === "all" || review.timeClass === timeFilter)
      .filter(review => selectedPatternId === "all" || review.issueIds.includes(selectedPatternId as any))
      .filter(review => review.issueIds.length);
    return {
      all: base.length,
      blunder: base.filter(review => qualityBucket(review.quality) === "blunder").length,
      miss: base.filter(review => qualityBucket(review.quality) === "miss").length,
      mistake: base.filter(review => qualityBucket(review.quality) === "mistake").length,
    };
  }, [report.moveReviews, timeFilter, selectedPatternId]);
  const reviews = useMemo(() => report.moveReviews
      .filter(review => timeFilter === "all" || review.timeClass === timeFilter)
      .filter(review => selectedPatternId === "all" || review.issueIds.includes(selectedPatternId as any))
      .filter(review => qualityFilter === "all" || qualityBucket(review.quality) === qualityFilter)
      .filter(review => review.issueIds.length)
      .sort((a, b) => sortMode === "latest"
        ? (b.endTime ?? b.gameId) - (a.endTime ?? a.gameId) || (b.engineEvalLoss ?? b.severity) - (a.engineEvalLoss ?? a.severity)
        : (b.engineEvalLoss ?? b.severity) - (a.engineEvalLoss ?? a.severity) || (b.endTime ?? b.gameId) - (a.endTime ?? a.gameId))
      .slice(0, 80),
    [report.moveReviews, timeFilter, selectedPatternId, qualityFilter, sortMode]
  );
  const issueForReview = (review: MoveReview): MoveIssue | null => {
    const exact = report.issues.find(issue => issue.fenBefore === review.fenBefore && (issue.san === review.san || issue.uci === review.uci));
    if (exact) return exact;
    const patternId = review.issueIds[0];
    if (!patternId) return null;
    const summary = report.summaries.find(item => item.id === patternId);
    const similar = report.issues.find(issue => issue.id === patternId);
    return {
      id: patternId,
      phase: review.phase,
      quality: review.quality,
      severity: review.severity,
      title: summary?.title || review.title,
      explanation: review.explanation,
      advice: summary?.advice || similar?.advice || "Compare the played move with the engine arrow and replay the position until the safer move is automatic.",
      moveNumber: review.moveNumber,
      san: review.san,
      uci: review.uci,
      materialGain: review.materialGain,
      fenBefore: review.fenBefore,
      fenAfter: review.fenAfter,
      gameUrl: review.gameUrl,
      opponent: review.opponent,
      color: review.color,
      opening: review.opening,
      engineBestMove: review.engineBestMove,
      engineEvalLoss: review.engineEvalLoss,
      engineReviewed: review.engineReviewed,
    };
  };
  const selectedReview = reviews.find(review => review.id === selectedReviewId);
  const selectedReviewIssue = selectedReview ? issueForReview(selectedReview) : null;
  const selectedIndex = selectedReview ? reviews.findIndex(review => review.id === selectedReview.id) : -1;

  useEffect(() => {
    if (!selectedReviewId || !reviews.some(review => review.id === selectedReviewId)) {
      setSelectedReviewId("");
    }
  }, [reviews, selectedReviewId]);

  useEffect(() => {
    if (qualityFilter !== "all" && filterCounts[qualityFilter] === 0) {
      setQualityFilter("all");
    }
  }, [filterCounts, qualityFilter]);

  const selectedGame = selectedReview ? report.gameSummaries.find(game => game.id === selectedReview.gameId) : undefined;

  return (
    <section className="mistake-screen mobile-screen">
      <div className="mistake-lab-header">
        <div>
          <span className="eyebrow">Mistake Lab</span>
          <h2>{reviews.length} {reviews.length === 1 ? "mistake" : "mistakes"}</h2>
        </div>
        <button className="primary-button" onClick={() => startDrill(qualityFilter, selectedPatternId)} disabled={!reviews.length}>
          <Dumbbell size={16} /> Drill shown
        </button>
      </div>

      <div className="lab-filter-tabs">
        {(["all", "blunder", "miss", "mistake"] as Array<TrainableReviewBucket | "all">).map(quality => (
          <button
            key={quality}
            className={qualityFilter === quality ? "active" : ""}
            onClick={() => setQualityFilter(quality)}
            disabled={quality !== "all" && filterCounts[quality] === 0}
          >
            {quality === "all" ? "All" : qualityLabel(quality)}
          </button>
        ))}
      </div>

      <div className="lab-select-grid">
        <label className="pattern-select">
          <span>Time Control</span>
          <select value={timeFilter} onChange={event => setTimeFilter(event.target.value)}>
            <option value="all">All time controls</option>
            <option value="rapid">Rapid</option>
            <option value="blitz">Blitz</option>
            <option value="bullet">Bullet</option>
            <option value="daily">Daily</option>
          </select>
        </label>
        <label className="pattern-select">
          <span>Sort</span>
          <select value={sortMode} onChange={event => setSortMode(event.target.value as "latest" | "severity")}>
            <option value="latest">Latest games first</option>
            <option value="severity">Biggest mistakes first</option>
          </select>
        </label>
      </div>

      <label className="pattern-select">
        <span>Mistake Category</span>
        <select value={selectedPatternId} onChange={event => setSelectedPatternId(event.target.value)}>
          <option value="all">All recurring patterns</option>
          {report.summaries.map(summary => (
            <option key={summary.id} value={summary.id}>{summary.title} ({summary.total})</option>
          ))}
        </select>
      </label>

      <div className="mistake-card-list">
        {reviews.map((review) => {
          const issue = issueForReview(review);
          const bucket = qualityBucket(review.quality);
          return (
          <button
            key={review.id}
            className={`mistake-big-card ${selectedReviewId === review.id ? "active" : ""}`}
            onClick={() => {
              if (issue) {
                setSelectedIssue(issue);
                setSelectedReviewId(review.id);
              }
            }}
          >
            <div className="mistake-card-body">
              <div className="mistake-card-topline">
                <div>
                  <span>{phaseLabels[review.phase]}</span>
                  <strong>{review.san}</strong>
                </div>
                <span className="eval-swing">{formatReviewSwing(review)}</span>
              </div>
              <div className="mistake-card-tags">
                <span className={`tag ${bucket}`}>{qualityLabel(review.quality)}</span>
                <span>{issue?.title || review.title}</span>
              </div>
              <p><Zap size={14} /> {visualConsequenceCopy(review, issue)} <i /> {review.opponent || "Opponent"}</p>
            </div>
          </button>
        )})}
        {!reviews.length && (
          <div className="empty-lab-state">
            <strong>No mistakes match these filters</strong>
            <span>Switch to All, choose another category, or sync more games.</span>
          </div>
        )}
      </div>
      {selectedReview && selectedReviewIssue && (
        <MistakeBottomSheet
          review={selectedReview}
          issue={selectedReviewIssue}
          game={selectedGame}
          close={() => setSelectedReviewId("")}
          next={reviews[selectedIndex + 1] ? () => {
            const nextReview = reviews[selectedIndex + 1];
            const nextIssue = issueForReview(nextReview);
            if (nextIssue) setSelectedIssue(nextIssue);
            setSelectedReviewId(nextReview.id);
          } : undefined}
          prev={reviews[selectedIndex - 1] ? () => {
            const previousReview = reviews[selectedIndex - 1];
            const previousIssue = issueForReview(previousReview);
            if (previousIssue) setSelectedIssue(previousIssue);
            setSelectedReviewId(previousReview.id);
          } : undefined}
          train={() => startDrill(qualityBucket(selectedReview.quality), selectedReviewIssue.id, selectedReviewIssue)}
          openAnalysis={openAnalysis}
        />
      )}
    </section>
  );
}

function MistakeBottomSheet({ review, issue, game, close, next, prev, train, openAnalysis }: {
  review: MoveReview;
  issue: MoveIssue;
  game?: GameSummary;
  close: () => void;
  next?: () => void;
  prev?: () => void;
  train: () => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: Omit<AnalysisStart, "fen" | "flipped" | "title">) => void;
}) {
  const betterMove = review.engineBestMove || review.engineLines?.[0]?.bestMove || "";
  const bucket = qualityBucket(review.quality);
  const betterLabel = formatEngineUci(betterMove) || "Best line";
  const [comparison, setComparison] = useState<"played" | "better">("played");
  const playedArrow = { from: review.uci.slice(0, 2), to: review.uci.slice(2, 4), color: comparison === "played" ? "rgba(255,89,89,0.84)" : "rgba(255,89,89,0.30)" };
  const betterArrow = betterMove ? { from: betterMove.slice(0, 2), to: betterMove.slice(2, 4), color: comparison === "better" ? "rgba(183,226,107,0.88)" : "rgba(183,226,107,0.32)" } : null;
  return (
    <div className="mistake-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Mistake details">
      <div className="mistake-sheet">
        <button className="sheet-grabber" onClick={close} aria-label="Close mistake details" />
        <div className="sheet-title-row">
          <div>
            <span className="eyebrow">{phaseLabels[review.phase]}</span>
            <h2>{review.san}</h2>
          </div>
          <span className="eval-swing large">{formatReviewSwing(review)}</span>
        </div>

        <MistakeEvalSwing review={review} />

        <div className="mistake-visual-card">
          <ChessBoard
            fen={review.fenBefore}
            flipped={review.color === "black"}
            arrows={[playedArrow, ...(betterArrow ? [betterArrow] : [])]}
            size={760}
          />
          <div className="sheet-move-compare">
            <button
              type="button"
              className={`played ${comparison === "played" ? "active" : ""}`}
              onClick={() => setComparison("played")}
              aria-pressed={comparison === "played"}
              aria-label={`Show your move ${review.san}`}
            >
              <span>Your move</span>
              <strong>{review.san}</strong>
            </button>
            <button
              type="button"
              className={`better ${comparison === "better" ? "active" : ""}`}
              onClick={() => setComparison("better")}
              aria-pressed={comparison === "better"}
              aria-label={`Show better move ${betterLabel}`}
              disabled={!betterMove}
            >
              <span>Better</span>
              <strong>{betterLabel}</strong>
            </button>
          </div>
        </div>

        <div className="coach-why-card">
          <span className={`tag ${bucket}`}>{qualityLabel(review.quality)}</span>
          <strong>{issue.title}</strong>
          <p>{coachMistakeCopy(review, issue, betterLabel)}</p>
        </div>

        <div className="sheet-actions">
          {prev && <button className="ghost-button" onClick={prev}><ChevronLeft size={16} /> Prev</button>}
          <button className="ghost-button" onClick={() => openAnalysis(review.fenBefore, review.color === "black", `${review.san}`, { gamePgn: game?.pgn })}><Search size={16} /> Analyze</button>
          <button className="primary-button" onClick={train}><Sword size={16} /> Train</button>
          {next && <button className="ghost-button" onClick={next}>Next <ChevronRight size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

function MistakeEvalSwing({ review }: { review: MoveReview }) {
  const before = typeof review.engineEvalBefore === "number" ? review.engineEvalBefore : undefined;
  const after = typeof review.engineEvalAfter === "number" ? review.engineEvalAfter : undefined;
  const beforePct = review.color === "black" ? 100 - evalToWhitePercent(before) : evalToWhitePercent(before);
  const afterPct = review.color === "black" ? 100 - evalToWhitePercent(after) : evalToWhitePercent(after);
  const beforeLabel = formatEngineEval(before) || "Before";
  const afterLabel = formatEngineEval(after) || "After";
  return (
    <div className="mistake-eval-strip" aria-label={`Evaluation swing ${formatReviewSwing(review)}`}>
      <div className="mistake-eval-labels">
        <span>Before <strong>{beforeLabel}</strong></span>
        <b>{formatReviewSwing(review)}</b>
        <span>After <strong>{afterLabel}</strong></span>
      </div>
      <div className="mistake-eval-track">
        <i className="before" style={{ left: `${beforePct}%` }} />
        <i className="after" style={{ left: `${afterPct}%` }} />
        <em style={{ left: `${Math.min(beforePct, afterPct)}%`, width: `${Math.max(4, Math.abs(beforePct - afterPct))}%` }} />
      </div>
    </div>
  );
}

function MistakeDetail({ review, issue, game, back, next, prev, train, openAnalysis }: {
  review: MoveReview;
  issue: MoveIssue;
  game?: GameSummary;
  back: () => void;
  next?: () => void;
  prev?: () => void;
  train: () => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: Omit<AnalysisStart, "fen" | "flipped" | "title">) => void;
}) {
  const { evaluatePosition } = useStockfish();
  const [bestMove, setBestMove] = useState("");
  const [engineLine, setEngineLine] = useState("");
  const [sourceEval, setSourceEval] = useState<EngineEvaluation | null>(null);
  const [boardEval, setBoardEval] = useState<EngineEvaluation | null>(null);
  const [boardFen, setBoardFen] = useState(review.fenBefore);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [storyStep, setStoryStep] = useState<"position" | "played" | "better">("position");

  useEffect(() => {
    let cancelled = false;
    document.querySelector(".workspace")?.scrollTo({ top: 0, behavior: "auto" });
    setBestMove("");
    setEngineLine("");
    setSourceEval(null);
    setBoardEval(null);
    setBoardFen(review.fenBefore);
    setLastMove(undefined);
    setStoryStep("position");
    evaluatePosition(review.fenBefore, ENGINE_DEPTH).then(result => {
      if (cancelled) return;
      setSourceEval(result);
      setBestMove(result.bestMove || review.engineBestMove || "");
      setEngineLine(result.pv);
    });
    return () => { cancelled = true; };
  }, [review.id, review.fenBefore, review.engineBestMove, evaluatePosition]);

  useEffect(() => {
    let cancelled = false;
    setBoardEval(null);
    evaluatePosition(boardFen, ENGINE_DEPTH).then(result => {
      if (!cancelled) setBoardEval(result);
    });
    return () => { cancelled = true; };
  }, [boardFen, evaluatePosition]);

  const showOriginal = () => {
    setBoardFen(review.fenBefore);
    setLastMove(undefined);
    setStoryStep("position");
  };

  const showPlayedMove = () => {
    setBoardFen(review.fenAfter);
    setLastMove({ from: review.uci.slice(0, 2), to: review.uci.slice(2, 4) });
    setStoryStep("played");
  };

  const showBetterMove = () => {
    const move = sourceBestMove;
    const board = new Chess(review.fenBefore);
    const played = move && board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || "q" });
    setBoardFen(played ? board.fen() : review.fenBefore);
    setLastMove(move ? { from: move.slice(0, 2), to: move.slice(2, 4) } : undefined);
    setStoryStep("better");
  };

  const practiceHere = async () => {
    train();
  };

  const bucket = qualityBucket(review.quality);
  const sourceBestMove = sourceEval?.bestMove || bestMove || review.engineBestMove;

  const storyArrows =
    storyStep === "played"
      ? [{ from: review.uci.slice(0, 2), to: review.uci.slice(2, 4), color: "rgba(230,79,79,0.72)" }]
      : storyStep === "better" && sourceBestMove
        ? [{ from: sourceBestMove.slice(0, 2), to: sourceBestMove.slice(2, 4), color: "rgba(183,226,107,0.82)" }]
        : undefined;

  return (
    <section className="mistake-detail mobile-screen">
      <div className="detail-topbar">
        <button className="ghost-button" onClick={back}><ArrowLeft size={16} /> Back</button>
        {prev && <button className="ghost-button" onClick={prev}>Prev</button>}
        {next && <button className="ghost-button" onClick={next}>Next</button>}
        <button className="primary-button" onClick={practiceHere}><Sword size={16} /> Train This Pattern</button>
      </div>

      <div className="detail-title">
        <div className="detail-move-row">
          <h2>{review.moveNumber}. {review.san}</h2>
          <button className="move-analyze-button" onClick={() => openAnalysis(review.fenBefore, review.color === "black", `${review.moveNumber}. ${review.san}`, { gamePgn: game?.pgn })} aria-label="Analyze position">
            <Search size={18} />
          </button>
        </div>
        <span className={`tag ${bucket}`}>{qualityLabel(review.quality)}</span>
        <p>{issue.title}</p>
        <div className="detail-game-meta">
          <span>Opponent: {review.opponent || "Unknown"}</span>
          <span>{review.opening || "Unknown opening"}</span>
        </div>
      </div>

      <div className="detail-board-card">
        <div className="mistake-compare-strip">
          <div className="played">
            <span>You played</span>
            <strong>{review.san}</strong>
          </div>
          <div className="better">
            <span>Better</span>
            <strong>{formatEngineUci(sourceBestMove) || "Calculating"}</strong>
          </div>
        </div>
        <div className="mistake-board-story">
          <button className={storyStep === "position" ? "active" : ""} onClick={showOriginal}>
            <span>Position</span>
            <strong>Before move</strong>
          </button>
          <button className={storyStep === "played" ? "active" : ""} onClick={showPlayedMove}>
            <span>Your move</span>
            <strong>{review.san}</strong>
          </button>
          <button className={storyStep === "better" ? "active" : ""} onClick={showBetterMove}>
            <span>Better</span>
            <strong>{formatEngineUci(sourceBestMove) || "..."}</strong>
          </button>
        </div>
        <SlimEvalBar evaluation={boardEval} flipped={review.color === "black"} />
        <ChessBoard
          fen={boardFen}
          flipped={review.color === "black"}
          lastMove={lastMove}
          arrows={storyArrows}
          size={620}
        />
        {(sourceEval?.pv || engineLine) && <div className="mistake-line-preview">{(sourceEval?.pv || engineLine).split(" ").slice(0, 5).map(formatEngineUci).join(" ")}</div>}
      </div>

    </section>
  );
}

function AnalysisView({ start, back }: {
  start: AnalysisStart;
  back: () => void;
}) {
  const [fen, setFen] = useState(start.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [engineEval, setEngineEval] = useState<EngineEvaluation | null>(null);
  const [moveLog, setMoveLog] = useState<string[]>([]);
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>(() => buildAnalysisHistory(start));
  const [historyIndex, setHistoryIndex] = useState(0);
  const [boardFlipped, setBoardFlipped] = useState(Boolean(start.flipped));
  const { ready, error, evaluatePosition } = useStockfish();

  useEffect(() => {
    const nextHistory = buildAnalysisHistory(start);
    const nextIndex = findHistoryIndex(nextHistory, start.fen);
    const entry = nextHistory[nextIndex] || { fen: start.fen };
    setFen(entry.fen);
    setLastMove(entry.lastMove);
    setMoveLog(nextHistory.slice(1, nextIndex + 1).map(item => item.san).filter(Boolean) as string[]);
    setHistory(nextHistory);
    setHistoryIndex(nextIndex);
    setEngineEval(null);
    setBoardFlipped(Boolean(start.flipped));
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    setEngineEval(null);
    evaluatePosition(fen, ENGINE_DEPTH).then(result => {
      if (!cancelled) setEngineEval(result);
    });
    return () => { cancelled = true; };
  }, [fen, evaluatePosition]);

  const playMove = async (from: string, to: string, promotion?: string) => {
    const board = new Chess(fen);
    const move = board.move({ from, to, promotion: promotion || "q" });
    if (!move) return;
    setLastMove({ from, to });
    setFen(board.fen());
    const entry = { fen: board.fen(), lastMove: { from, to }, san: move.san };
    setHistory(current => {
      const next = current.slice(0, historyIndex + 1).concat(entry);
      setHistoryIndex(next.length - 1);
      setMoveLog(next.slice(1).map(item => item.san).filter(Boolean) as string[]);
      return next;
    });
    const result = await evaluatePosition(board.fen(), ENGINE_DEPTH);
    setEngineEval(result);
  };

  const jumpToHistory = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(history.length - 1, nextIndex));
    const entry = history[clamped];
    setHistoryIndex(clamped);
    setFen(entry.fen);
    setLastMove(entry.lastMove);
    setMoveLog(history.slice(1, clamped + 1).map(item => item.san).filter(Boolean) as string[]);
  };

  const resetAnalysis = () => {
    const nextHistory = buildAnalysisHistory(start);
    const entry = nextHistory[0] || { fen: start.fen };
    setFen(entry.fen);
    setMoveLog([]);
    setLastMove(entry.lastMove);
    setHistory(nextHistory);
    setHistoryIndex(0);
  };

  return (
    <section className="analysis-screen mobile-screen">
      <div className="detail-topbar">
        <button className="ghost-button" onClick={back}><ArrowLeft size={16} /> Back</button>
      </div>
      <div className="game-detail-head">
        <span className="eyebrow">Analysis Board</span>
        <h2>{start.title || "Explore the position"}</h2>
        <p>Move pieces, reset, and compare ideas directly on the board.</p>
      </div>
      <div className="analysis-board-area">
        <SlimEvalBar evaluation={engineEval} flipped={boardFlipped} />
        <ChessBoard
          fen={fen}
          flipped={boardFlipped}
          interactive
          onMove={playMove}
          lastMove={lastMove}
          arrows={engineEval?.bestMove ? [{ from: engineEval.bestMove.slice(0, 2), to: engineEval.bestMove.slice(2, 4), color: "rgba(175,209,139,0.48)" }] : undefined}
          showToolbar={false}
          size={620}
        />
        <div className="analysis-board-controls" aria-label="Analysis board controls">
          <button onClick={() => jumpToHistory(historyIndex - 1)} disabled={historyIndex <= 0} aria-label="Previous move"><ChevronLeft size={19} /></button>
          <button onClick={resetAnalysis} aria-label="Reset analysis board"><RefreshCw size={18} /></button>
          <button onClick={() => setBoardFlipped(value => !value)} aria-label="Flip board"><Repeat2 size={18} /></button>
          <button onClick={() => jumpToHistory(historyIndex + 1)} disabled={historyIndex >= history.length - 1} aria-label="Next move"><ChevronRight size={19} /></button>
        </div>
        <EngineSuggestions evaluation={engineEval} ready={ready} error={error} />
      </div>
      <div className="analysis-move-log">
        {moveLog.length ? moveLog.map((move, index) => <span key={`${move}-${index}`}>{index + 1}. {move}</span>) : <span>No moves played yet.</span>}
      </div>
    </section>
  );
}

function SlimEvalBar({ evaluation, flipped = false }: { evaluation: EngineEvaluation | null; flipped?: boolean }) {
  const whitePct = evalToWhitePercent(evaluation?.evalCp, evaluation?.mate);
  const displayPct = flipped ? 100 - whitePct : whitePct;
  const labels = evalEdgeLabels(evaluation?.evalCp, evaluation?.mate, flipped);
  return (
    <div className="slim-eval-bar" aria-label={`Evaluation ${formatEngineEval(evaluation?.evalCp, evaluation?.mate) || "calculating"}`}>
      <span className={`eval-number ${labels.leftColor}`}>{labels.left}</span>
      <div className="slim-eval-track">
        <i style={{ width: `${displayPct}%` }} />
      </div>
      <span className={`eval-number ${labels.rightColor}`}>{labels.right}</span>
    </div>
  );
}

function EngineTopLine({ evaluation, ready, error }: { evaluation: EngineEvaluation | null; ready: boolean; error?: string }) {
  const line = evaluation?.pv?.split(" ").slice(0, 5).map(formatEngineUci).join(" ");
  const evalPercent = evalToWhitePercent(evaluation?.evalCp, evaluation?.mate);
  return (
    <div className="engine-top-line">
      <div className="engine-top-header">
        <span><i /> Engine Evaluation</span>
        <strong>{formatEngineEval(evaluation?.evalCp, evaluation?.mate) || "..."}</strong>
      </div>
      <div className="engine-eval-meter" aria-label={`Evaluation ${formatEngineEval(evaluation?.evalCp, evaluation?.mate) || "calculating"}`}>
        <span style={{ width: `${evalPercent}%` }} />
      </div>
      <p>{error || `${evaluation ? `d:${evaluation.depth || "..."} ` : ready ? "calculating " : "starting "}${line || "Engine line will appear here."}`}</p>
    </div>
  );
}

function EngineSuggestions({ evaluation, ready, error }: { evaluation: EngineEvaluation | null; ready: boolean; error?: string }) {
  const lines = evaluation?.lines?.length
    ? evaluation.lines
    : evaluation?.pv
      ? [{ multipv: 1, bestMove: evaluation.bestMove || evaluation.pv.split(" ")[0], evalCp: evaluation.evalCp, mate: evaluation.mate, pv: evaluation.pv, depth: evaluation.depth }]
      : [];
  return (
    <div className="engine-suggestions" data-engine-error={error || ""}>
      {lines.length ? lines.slice(0, 3).map(line => (
        <div className="engine-suggestion" key={`${line.multipv}-${line.pv}`}>
          <b>{formatEngineEval(line.evalCp, line.mate) || "..."}</b>
          <strong>{formatPrincipalVariation(line.pv, line.bestMove)}</strong>
          <span>d:{line.depth || "..."}</span>
        </div>
      )) : (
        <div className="engine-suggestion muted">
          <b>...</b>
          <strong>{error ? "Offline" : ready ? "Thinking" : "Booting"}</strong>
          <span>d:...</span>
        </div>
      )}
    </div>
  );
}

function formatPrincipalVariation(pv?: string, fallback?: string) {
  const moves = (pv || fallback || "").split(" ").filter(Boolean).slice(0, 5);
  if (!moves.length) return "...";
  return moves.map((move, index) => `${index === 0 ? "1. " : ""}${formatEngineUci(move)}`).join(" ");
}

function evalToWhitePercent(evalCp?: number, mate?: number) {
  if (typeof mate === "number") return mate > 0 ? 96 : 4;
  if (typeof evalCp !== "number") return 50;
  return Math.max(4, Math.min(96, 50 + evalCp / 18));
}

function evalEdgeLabels(evalCp?: number, mate?: number, flipped = false) {
  const whiteValue = formatEngineEval(evalCp, mate);
  const blackValue = formatSideEval("black", evalCp, mate);
  const side = evalAdvantageSide(evalCp, mate);
  const leftColor = flipped ? "white" : "black";
  const rightColor = flipped ? "black" : "white";
  const labelFor = (color: "white" | "black") => {
    if (!whiteValue || side === "equal") return whiteValue || "...";
    if (side === color) return color === "white" ? whiteValue : blackValue;
    return "";
  };
  return {
    leftColor,
    rightColor,
    left: labelFor(leftColor),
    right: labelFor(rightColor),
  };
}

function evalAdvantageSide(evalCp?: number, mate?: number): "white" | "black" | "equal" {
  if (typeof mate === "number") return mate > 0 ? "white" : "black";
  if (typeof evalCp !== "number" || Math.abs(evalCp) < 1) return "equal";
  return evalCp > 0 ? "white" : "black";
}

function formatSideEval(side: "white" | "black", evalCp?: number, mate?: number) {
  if (side === "white") return formatEngineEval(evalCp, mate);
  if (typeof mate === "number") return mate < 0 ? `M${Math.abs(mate)}` : `-M${mate}`;
  if (typeof evalCp !== "number") return "";
  return formatEngineEval(-evalCp);
}

type AnalysisHistoryEntry = {
  fen: string;
  lastMove?: { from: string; to: string };
  san?: string;
};

function buildAnalysisHistory(start: AnalysisStart): AnalysisHistoryEntry[] {
  if (!start.gamePgn) return [{ fen: start.fen }];
  try {
    const source = new Chess();
    source.loadPgn(start.gamePgn);
    const moves = source.history({ verbose: true });
    const replay = new Chess();
    const entries: AnalysisHistoryEntry[] = [{ fen: replay.fen() }];
    for (const move of moves) {
      const played = replay.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      if (!played) break;
      entries.push({
        fen: replay.fen(),
        lastMove: { from: move.from, to: move.to },
        san: move.san,
      });
    }
    return entries.length ? entries : [{ fen: start.fen }];
  } catch {
    return [{ fen: start.fen }];
  }
}

function findHistoryIndex(history: AnalysisHistoryEntry[], fen: string) {
  const target = comparableFen(fen);
  const index = history.findIndex(entry => comparableFen(entry.fen) === target);
  return index >= 0 ? index : 0;
}

function comparableFen(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function qualityLabel(quality: MoveReviewQuality) {
  return quality === "best" ? "Best" :
    quality === "good" ? "Good" :
    quality === "blunder" ? "Blunder" :
    quality === "miss" ? "Miss" :
    "Mistake";
}

function qualityBucket(quality: MoveReviewQuality): ReviewBucket {
  return quality === "inaccuracy" ? "mistake" : quality;
}

function isTrainableQuality(quality: MoveReviewQuality) {
  return qualityBucket(quality) === "blunder" || qualityBucket(quality) === "miss" || qualityBucket(quality) === "mistake";
}

function reviewLossCp(review: MoveReview) {
  if (typeof review.engineEvalLoss === "number") return Math.max(0, review.engineEvalLoss);
  if (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number") {
    const playerSign = review.color === "white" ? 1 : -1;
    return Math.max(0, (review.engineEvalBefore - review.engineEvalAfter) * playerSign);
  }
  return Math.max(0, review.engineEvalLoss ?? review.severity * 45);
}

function formatReviewSwing(review: MoveReview) {
  const loss = reviewLossCp(review);
  return formatEngineEvalLoss(loss);
}

function formatEngineEvalLoss(lossCp: number) {
  if (lossCp <= 0) return "0.0";
  const pawns = Math.max(0.1, Math.abs(lossCp) / 100);
  return `-${pawns.toFixed(pawns >= 10 ? 0 : 1)}`;
}

function reviewSwingCopy(review: MoveReview) {
  const better = review.engineBestMove ? formatEngineUci(review.engineBestMove) : "the engine move";
  return `${better} was preferred. Eval swing ${formatReviewSwing(review)}.`;
}

function visualConsequenceCopy(review: MoveReview, issue?: MoveIssue | null) {
  if (issue?.explanation) return issue.explanation.replace(/\.$/, "");
  const loss = reviewLossCp(review);
  if (loss >= 250) return "Major consequence";
  if (loss >= 120) return "Position slipped";
  if (loss >= 50) return "Small edge lost";
  return "Pattern to review";
}

function coachMistakeCopy(review: MoveReview, issue: MoveIssue, betterLabel: string) {
  const consequence = visualConsequenceCopy(review, issue);
  if (issue.id === "twoMoveBlindspot") return `${consequence}. The visual clue: after your move, the opponent gets the next forcing shot. Compare the red arrow with ${betterLabel}.`;
  if (issue.id === "queenEarly") return `${consequence}. The queen moved before the position was ready, so the better move keeps development and king safety first.`;
  if (issue.id === "loosePiece") return `${consequence}. A piece became tactically loose. The better move removes that target or creates a stronger threat.`;
  if (issue.id === "kingShelter") return `${consequence}. The king cover opens up. Keep the shelter intact unless the tactic is concrete.`;
  if (issue.id === "missedForcingMove") return `${consequence}. The board had a forcing move available. Look for checks, captures, and threats before quiet moves.`;
  return `${consequence}. The better move, ${betterLabel}, changes the shape of the position before the punishment arrives.`;
}

function refineReviewWithEngine(
  review: MoveReview,
  engine: MoveEngineResult,
): MoveReview {
  const loss = engine.evalLossCp;
  const missedTactic = review.issueIds.includes("missedForcingMove" as any);
  const playerColor = review.color === "black" ? "b" : "w";
  const nextQuality = classifyMoveQuality({
    bestMove: engine.bestMove,
    playedMove: engine.playedMove,
    evalLossCp: loss,
    evalBefore: engine.evalBefore,
    evalAfter: engine.evalAfter,
    playerColor,
    missedForcingMove: missedTactic,
    confidence: engine.confidence,
  });
  const isEngineMistake = ["blunder", "miss", "mistake", "inaccuracy"].includes(nextQuality);

  return {
    ...review,
    quality: nextQuality,
    severity: loss > 250 ? 9 : loss > 120 ? 6 : loss > 50 ? 3 : Math.min(review.severity, 1),
    issueIds: isEngineMistake && !review.issueIds.length ? ["twoMoveBlindspot" as any] : review.issueIds,
    title: isEngineMistake && !review.issueIds.length ? "Engine mistake" : review.title,
    explanation: isEngineMistake
      ? `${formatEngineUci(engine.bestMove) || "The engine move"} was preferred. Eval swing ${formatEngineEvalLoss(loss)}.`
      : review.explanation,
    engineBestMove: engine.bestMove,
    engineEvalBefore: engine.evalBefore.cp,
    engineEvalAfter: engine.evalAfter.cp,
    engineEvalLoss: loss,
    engineDepth: engine.depth,
    engineConfidence: engine.confidence,
    engineLines: engine.multipv,
      engineReviewed: true,
  };
}

function addEngineIssues(existingIssues: MoveIssue[], updates: Map<string, MoveReview>) {
  const issues = existingIssues.slice();
  for (const review of updates.values()) {
    if (!isTrainableQuality(review.quality)) continue;
    if (issues.some(issue => issue.fenBefore === review.fenBefore && issue.san === review.san)) continue;
    issues.push({
      id: "twoMoveBlindspot",
      phase: review.phase,
      quality: review.quality,
      severity: review.severity,
      title: review.title || "Engine mistake",
      explanation: review.explanation,
      advice: "Compare your move with the engine line, then drill the same pattern until the candidate move is automatic.",
      moveNumber: review.moveNumber,
      san: review.san,
      uci: review.uci,
      materialGain: review.materialGain,
      fenBefore: review.fenBefore,
      fenAfter: review.fenAfter,
      gameUrl: review.gameUrl,
      opponent: review.opponent,
      color: review.color,
      opening: review.opening,
      engineBestMove: review.engineBestMove,
      engineEvalLoss: review.engineEvalLoss,
      engineReviewed: review.engineReviewed,
    });
  }
  return issues;
}

function GamesView({ report, selectedGameId, setSelectedGameId, openMove, openAnalysis }: {
  report: AnalysisReport;
  selectedGameId: number;
  setSelectedGameId: (id: number) => void;
  openMove: (review: MoveReview) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: Omit<AnalysisStart, "fen" | "flipped" | "title">) => void;
}) {
  const [timeFilter, setTimeFilter] = useState("all");
  const sortedGames = useMemo(
    () => report.gameSummaries
      .filter(game => timeFilter === "all" || game.timeClass === timeFilter)
      .slice()
      .sort((a, b) => (b.endTime ?? b.id) - (a.endTime ?? a.id)),
    [report.gameSummaries, timeFilter]
  );
  const game = sortedGames.find(candidate => candidate.id === selectedGameId);
  const reviews = useMemo(() => report.moveReviews.filter(review => review.gameId === game?.id), [report.moveReviews, game?.id]);
  const [selectedReviewId, setSelectedReviewId] = useState(reviews[0]?.id || "");
  const selectedReview = reviews.find(review => review.id === selectedReviewId) || reviews[0];
  const [playFen, setPlayFen] = useState(selectedReview?.fenBefore || "");
  const [lastEngineMove, setLastEngineMove] = useState("");
  const [boardEval, setBoardEval] = useState<EngineEvaluation | null>(null);
  const [autoReply, setAutoReply] = useState(false);
  const { ready, error, evaluatePosition } = useStockfish();

  useEffect(() => {
    setSelectedReviewId(reviews[0]?.id || "");
    setPlayFen(reviews[0]?.fenBefore || "");
    setLastEngineMove("");
    setBoardEval(null);
  }, [selectedGameId, reviews]);

  useEffect(() => {
    let cancelled = false;
    const fen = playFen || selectedReview?.fenBefore;
    if (!fen) return;
    setBoardEval(null);
    evaluatePosition(fen, ENGINE_DEPTH).then(result => {
      if (cancelled) return;
      setBoardEval(result);
    });
    return () => { cancelled = true; };
  }, [playFen, selectedReview?.fenBefore, evaluatePosition]);

  const playMove = async (from: string, to: string, promotion?: string) => {
    const board = new Chess(playFen || selectedReview?.fenBefore);
    const move = board.move({ from, to, promotion: promotion || "q" });
    if (!move) return;
    const afterUser = board.fen();
    setPlayFen(afterUser);
    const engine = await evaluatePosition(afterUser, ENGINE_DEPTH);
    setBoardEval(engine);
    setLastEngineMove(engine.bestMove);
    if (autoReply && engine.bestMove) {
      const response = new Chess(afterUser);
      const reply = response.move({ from: engine.bestMove.slice(0, 2), to: engine.bestMove.slice(2, 4), promotion: engine.bestMove[4] || "q" });
      if (reply) setPlayFen(response.fen());
    }
  };

  const qualityCountsForGame = (id: number) => {
    const gameReviews = report.moveReviews.filter(review => review.gameId === id);
    return {
      critical: gameReviews.filter(review => ["blunder", "miss", "mistake"].includes(review.quality)).length,
      reviewed: gameReviews.length,
    };
  };

  if (!game) {
    return (
      <section className="games-screen mobile-screen">
      <div className="screen-intro">
        <h2>Games</h2>
        <p>Browse your played games. Open one when you want the board, engine lines, and move review.</p>
      </div>

      <label className="pattern-select">
        <span>Time Control</span>
        <select value={timeFilter} onChange={event => setTimeFilter(event.target.value)}>
          <option value="all">All time controls</option>
          <option value="rapid">Rapid</option>
          <option value="blitz">Blitz</option>
          <option value="bullet">Bullet</option>
          <option value="daily">Daily</option>
        </select>
      </label>

      <div className="game-library-list">
        {sortedGames.map(summary => (
          <button key={summary.id} onClick={() => setSelectedGameId(summary.id)}>
            <div>
              <strong>{summary.opponent || "Unknown opponent"}</strong>
              <span>{[summary.timeClass, summary.opening || summary.result].filter(Boolean).join(" • ") || "Game review"}</span>
            </div>
            <b>{qualityCountsForGame(summary.id).critical}</b>
            <small>{summary.endTime ? new Date(summary.endTime * 1000).toLocaleDateString() : "PGN"}</small>
          </button>
        ))}
      </div>
      </section>
    );
  }

  return (
    <section className="games-screen mobile-screen">
      <div className="detail-topbar">
        <button className="ghost-button" onClick={() => setSelectedGameId(-1)}><ArrowLeft size={16} /> Games</button>
        <button className="ghost-button" onClick={() => selectedReview && openMove(selectedReview)} disabled={!selectedReview}>Open move</button>
        <button className={`ghost-button ${autoReply ? "active" : ""}`} onClick={() => setAutoReply(value => !value)}>
          {autoReply ? "Engine replies on" : "Free explore"}
        </button>
      </div>

      <div className="game-detail-head">
        <h2>{game.opponent || "Unknown opponent"}</h2>
        <p>{[game.timeClass, game.opening || game.result].filter(Boolean).join(" • ")}</p>
        <div className="detail-game-meta">
          <span>{game.issues} flagged</span>
          <span>{reviews.length} reviewed moves</span>
          {game.endTime && <span>{new Date(game.endTime * 1000).toLocaleDateString()}</span>}
        </div>
      </div>

      <div className="game-review-board">
        <ChessBoard
          fen={playFen || selectedReview?.fenBefore}
          flipped={game.color === "black"}
          interactive
          onMove={playMove}
          onGestureBack={() => {
            const currentIndex = reviews.findIndex(review => review.id === selectedReview?.id);
            const previous = reviews[Math.max(0, currentIndex - 1)];
            if (previous) {
              setSelectedReviewId(previous.id);
              setPlayFen(previous.fenBefore);
              setLastEngineMove("");
            }
          }}
          onGestureForward={() => {
            const currentIndex = reviews.findIndex(review => review.id === selectedReview?.id);
            const next = reviews[Math.min(reviews.length - 1, currentIndex + 1)];
            if (next) {
              setSelectedReviewId(next.id);
              setPlayFen(next.fenBefore);
              setLastEngineMove("");
            }
          }}
          lastMove={lastEngineMove ? { from: lastEngineMove.slice(0, 2), to: lastEngineMove.slice(2, 4) } : undefined}
          onAnalyze={() => openAnalysis(playFen || selectedReview?.fenBefore, game.color === "black", game.opponent || "Game analysis", { gamePgn: game.pgn })}
          size={340}
        />
        <EngineReadout evaluation={boardEval} ready={ready} error={error} flipped={game.color === "black"} />
      </div>

      {selectedReview && (
        <div className="selected-move-panel">
          <div><span>You played</span><strong>{selectedReview.san}</strong></div>
          <div><span>Engine suggests</span><strong>{formatEngineUci(boardEval?.bestMove) || "Calculating..."}</strong></div>
          <div><span>Evaluation</span><strong>{formatEngineEval(boardEval?.evalCp, boardEval?.mate) || "Calculating..."}</strong></div>
          <p>{selectedReview.explanation}</p>
          {boardEval?.pv && <small>Line: {boardEval.pv.split(" ").slice(0, 8).map(formatEngineUci).join(" ")}</small>}
        </div>
      )}

      <div className="move-review-list">
        {reviews.map(review => (
          <button
            key={review.id}
            className={review.id === selectedReview?.id ? "active" : ""}
            onClick={() => {
              setSelectedReviewId(review.id);
              setPlayFen(review.fenBefore);
              setLastEngineMove("");
            }}
            onDoubleClick={() => openMove(review)}
          >
            <span>{review.moveNumber}. {review.san}</span>
            <small className={qualityBucket(review.quality)}>{qualityLabel(review.quality)}</small>
            <p>{review.explanation}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatReviewDate(review: MoveReview) {
  if (!review.endTime) return "PGN game";
  return new Date(review.endTime * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
