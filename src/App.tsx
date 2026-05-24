import { Component, ReactNode, useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  FileUp,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Shield,
  Sword,
  User,
  X,
} from "lucide-react";
import { fetchChessComGames, fetchChessComProfile, ImportProgress } from "./analysis/chesscom";
import type { ChessComGame } from "./analysis/chesscom";
import type { AnalysisReport, MoveIssue, MoveReview, MoveReviewQuality, MoveQualityDistribution } from "./analysis/patterns";
import type { MoveEngineResult } from "./engine/EngineService";
import { classifyMoveQuality, DEFAULT_ENGINE_DEPTH, DEFAULT_ENGINE_MULTIPV } from "./engine/EngineService";
import { useStockfish } from "./engine/useStockfish";
import {
  isPlaceholderUsername,
  normalizeStoredProfile,
  readStorageValue,
  removeStorageValue,
  shouldAutoSyncProfile,
  writeStorageValue,
} from "./appPersistence";
import { ExactMobileImport, ExactPatternCoachMobile } from "./ExactMobileShell";

// ── constants ──────────────────────────────────────────────

const ENGINE_DEPTH = DEFAULT_ENGINE_DEPTH;
const PROFILE_STORAGE_KEY = "pattern-coach-profile";
const REPORT_STORAGE_KEY = "pattern-coach-report";
const SYNC_META_STORAGE_KEY = "pattern-coach-sync-meta";
const BACKGROUND_ENGINE_REVIEW_LIMIT = 36;
const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60_000;
const BACKGROUND_SYNC_MIN_GAP_MS = 10 * 60_000;
const LATEST_SYNC_MONTHS = 2;
const DEFAULT_MONTHS = 3;
const DEFAULT_GAME_LIMIT = 25;
const DEFAULT_TIME_CLASS: "all" | "rapid" | "blitz" | "bullet" | "daily" = "all";
const MATE_CP_THRESHOLD = 90_000;

type SyncMeta = {
  lastSyncedAt?: number;
  source?: "chesscom" | "pgn" | "sample";
  status?: "idle" | "syncing" | "error";
  message?: string;
};

type AnalysisStart = {
  fen: string;
  flipped?: boolean;
  title?: string;
  gamePgn?: string;
  returnMistakeReviewId?: string;
};

type ShellProps = {
  activeView: "dashboard" | "games" | "mistakes" | "patterns" | "drill" | "analysis";
  setActiveView: (view: "dashboard" | "games" | "mistakes" | "patterns" | "drill" | "analysis") => void;
  analysisReturnView: "dashboard" | "games" | "mistakes" | "patterns" | "drill";
  report: AnalysisReport;
  username: string;
  syncMeta?: SyncMeta;
  analysisStart?: AnalysisStart | null;
  openProfile: () => void;
  openMenu: () => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: { gamePgn?: string; returnMistakeReviewId?: string }) => void;
  openGame: (gameId: number) => void;
  selectedGameId: number | null;
  drillQuality: MoveReviewQuality | "all";
  drillPatternId: string;
  drillIssue: MoveIssue | null;
};

// ── helpers ────────────────────────────────────────────────

function loadSavedReport() {
  const saved = readStorageValue(REPORT_STORAGE_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { report?: AnalysisReport };
    return parsed.report ?? null;
  } catch {
    removeStorageValue(REPORT_STORAGE_KEY);
    return null;
  }
}

function findMatchingIssue(report: AnalysisReport, issue: MoveIssue | null) {
  if (!issue) return null;
  return (
    report.issues.find(
      (next) =>
        next.fenBefore === issue.fenBefore && next.uci === issue.uci && next.san === issue.san,
    ) ?? null
  );
}

function normalizeChessComUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function sameChessComUsername(a: string, b: string) {
  const left = normalizeChessComUsername(a);
  const right = normalizeChessComUsername(b);
  return Boolean(left && right && left === right);
}

function friendlySyncMessage(message?: string) {
  if (!message) return "";
  if (/worker failed/i.test(message)) return "Sync needs retry.";
  return message;
}

function mergeReportAndFetchedPgns(
  currentReport: AnalysisReport,
  fetchedGames: ChessComGame[],
  limit: number,
) {
  const byKey = new Map<string, { pgn: string; endTime: number }>();
  const add = (key: string | undefined, pgn: string | undefined, endTime = 0) => {
    const cleaned = pgn?.trim();
    if (!cleaned) return;
    byKey.set(key || cleaned.slice(0, 240), { pgn: cleaned, endTime });
  };

  currentReport.gameSummaries.forEach((game) => add(game.url, game.pgn, game.endTime ?? 0));
  fetchedGames.forEach((game) => add(game.url, game.pgn, game.end_time ?? 0));

  return [...byKey.values()]
    .sort((a, b) => a.endTime - b.endTime)
    .slice(-Math.max(1, limit))
    .map((game) => game.pgn)
    .join("\n\n");
}

// ── quality helpers (shared with background‑refine loop) ──

function qualityLabel(quality: MoveReviewQuality) {
  return quality === "best"
    ? "Best"
    : quality === "good"
      ? "Good"
      : quality === "blunder"
        ? "Blunder"
        : quality === "miss"
          ? "Miss"
          : quality === "inaccuracy"
            ? "Inaccuracy"
            : "Mistake";
}

function qualityBucket(quality: MoveReviewQuality): "blunder" | "miss" | "mistake" | "inaccuracy" | "good" | "best" {
  return quality as "blunder" | "miss" | "mistake" | "inaccuracy" | "good" | "best";
}

function isTrainableQuality(quality: MoveReviewQuality) {
  return quality === "blunder" || quality === "miss" || quality === "mistake" || quality === "inaccuracy";
}

function reviewLossCp(review: MoveReview) {
  if (typeof review.engineEvalLoss === "number") return Math.max(0, review.engineEvalLoss);
  if (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number") {
    const playerSign = review.color === "white" ? 1 : -1;
    return Math.max(0, (review.engineEvalBefore - review.engineEvalAfter) * playerSign);
  }
  return Math.max(0, review.severity * 45);
}

function formatEngineEvalLoss(lossCp: number) {
  if (lossCp <= 0) return "0.0";
  if (lossCp >= MATE_CP_THRESHOLD) return "-M";
  const pawns = Math.max(0.1, Math.abs(lossCp) / 100);
  return `-${pawns.toFixed(pawns >= 10 ? 0 : 1)}`;
}

function refineReviewWithEngine(review: MoveReview, engine: MoveEngineResult): MoveReview {
  const loss = engine.evalLossCp;
  const missedTactic = review.issueIds.includes("missedForcingMove" as never);
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
    issueIds: isEngineMistake && !review.issueIds.length ? ["engineMistake"] : review.issueIds,
    title: isEngineMistake && !review.issueIds.length ? "Engine mistake" : review.title,
    explanation: isEngineMistake
      ? `Engine move was preferred. Eval swing ${formatEngineEvalLoss(loss)}.`
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
    if (issues.some((i) => i.fenBefore === review.fenBefore && i.san === review.san)) continue;
    issues.push({
      id: review.issueIds[0] ?? "engineMistake",
      phase: review.phase,
      quality: review.quality,
      severity: review.severity,
      title: review.title || "Engine mistake",
      explanation: review.explanation,
      advice: review.issueIds[0]
        ? "Compare your move with the engine line, then drill the same pattern until the candidate move is automatic."
        : "Use the engine line as a signal, then find the concrete tactic or positional reason behind the better move.",
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

// ── worker ─────────────────────────────────────────────────

type WorkerPayload =
  | { kind: "chesscom"; username: string; games: unknown[] }
  | { kind: "pgn"; username: string; pgnText: string };

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
    w.onmessage = (
      e: MessageEvent<{ ok: true; report: AnalysisReport } | { ok: false; error: string }>,
    ) => {
      cleanup();
      w.terminate();
      if (e.data.ok) resolve(e.data.report);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      cleanup();
      w.terminate();
      reject(new Error(e.message || "Worker failed."));
    };
    w.postMessage(payload);
  });
}

// ── overlays ───────────────────────────────────────────────

function AppMenu({
  report,
  username,
  connectedUsername,
  syncMeta,
  loading,
  close,
  openProfile,
  syncGames,
  clearData,
}: {
  report: AnalysisReport | null;
  username: string;
  connectedUsername: string;
  syncMeta: SyncMeta;
  loading: boolean;
  close: () => void;
  openProfile: () => void;
  syncGames: () => void;
  clearData: () => void;
}) {
  const statusName = username.trim() || connectedUsername;
  const draftIsConnected = sameChessComUsername(statusName, connectedUsername);
  return (
    <div
      className="profile-overlay menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="App menu"
      onClick={close}
    >
      <div className="profile-sheet app-menu-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <span className="eyebrow">Menu</span>
            <h2>Pattern Coach</h2>
          </div>
          <button className="icon-button sheet-close" onClick={close} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="profile-status-card">
          <div className={`profile-avatar-large ${draftIsConnected ? "connected" : ""}`}>
            {statusName ? statusName.slice(0, 2).toUpperCase() : <User size={22} />}
          </div>
          <div>
            <strong>{statusName || "No Chess.com username"}</strong>
            <span>
              {draftIsConnected && syncMeta.lastSyncedAt
                ? `Last synced ${new Date(syncMeta.lastSyncedAt).toLocaleString()}`
                : draftIsConnected
                  ? friendlySyncMessage(syncMeta.message) || "Public game sync enabled."
                  : connectedUsername
                    ? `Currently synced as ${connectedUsername}. Connect to switch.`
                    : "Connect to keep games updated."}
            </span>
          </div>
        </div>
        <div className="menu-action-list">
          <button onClick={openProfile}>
            <User size={17} /> Profile and import
          </button>
          <button onClick={syncGames} disabled={loading || !username.trim()}>
            <RefreshCw size={17} /> {report ? "Sync latest games" : "Sync games"}
          </button>
          <a href="/legal/privacy.html" target="_blank" rel="noreferrer noopener">
            <Shield size={17} /> Privacy policy
          </a>
          <a href="/legal/terms.html" target="_blank" rel="noreferrer noopener">
            <FileUp size={17} /> Terms
          </a>
          <a href="/legal/support.html" target="_blank" rel="noreferrer noopener">
            <AlertTriangle size={17} /> Support
          </a>
          <button
            className="danger-menu-item"
            onClick={() => {
              if (window.confirm("Delete all locally stored game data and settings? This cannot be undone.")) {
                clearData();
              }
            }}
          >
            <X size={17} /> Clear local data
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSheet({
  username,
  setUsername,
  connectedUsername,
  months,
  setMonths,
  gameLimit,
  setGameLimit,
  timeClass,
  setTimeClass,
  pgnText,
  setPgnText,
  loading,
  progress,
  error,
  syncMeta,
  runChessComConnect,
  runChessComImport,
  runPgnAnalysis,
  loadSample,
  forgetProfile,
  close,
}: {
  username: string;
  setUsername: (value: string) => void;
  connectedUsername: string;
  months: number;
  setMonths: (value: number) => void;
  gameLimit: number;
  setGameLimit: (value: number) => void;
  timeClass: "all" | "rapid" | "blitz" | "bullet" | "daily";
  setTimeClass: (value: "all" | "rapid" | "blitz" | "bullet" | "daily") => void;
  pgnText: string;
  setPgnText: (value: string) => void;
  loading: boolean;
  progress: ImportProgress | null;
  error: string;
  syncMeta: SyncMeta;
  runChessComConnect: () => void;
  runChessComImport: () => void;
  runPgnAnalysis: (text?: string, usernameOverride?: string) => void;
  loadSample: () => void;
  forgetProfile: () => void;
  close: () => void;
}) {
  const [fileError, setFileError] = useState(false);
  const statusName = username.trim() || connectedUsername;
  const draftIsConnected = sameChessComUsername(statusName, connectedUsername);
  const profileSyncStatus = friendlySyncMessage(progress?.label || syncMeta.message) || "";
  const isAnalyzing = Boolean(progress?.label.toLowerCase().startsWith("analyzing"));
  const profileSyncPercent =
    progress?.total && !isAnalyzing ? Math.round((progress.done / progress.total) * 100) : null;

  useEffect(() => {
    if (fileError) {
      const timer = window.setTimeout(() => setFileError(false), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [fileError]);
  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <span className="eyebrow">Profile</span>
            <h2>Chess.com connection</h2>
          </div>
          <button className="icon-button sheet-close" onClick={close} aria-label="Close profile">
            <X size={18} />
          </button>
        </div>

        <div className="profile-status-card">
          <div className={`profile-avatar-large ${draftIsConnected ? "connected" : ""}`}>
            {statusName ? statusName.slice(0, 2).toUpperCase() : <User size={22} />}
          </div>
          <div>
            <strong>{statusName || "No profile connected"}</strong>
            <span>
              {draftIsConnected
                ? "Public game sync enabled"
                : username
                  ? "Connect to enable game sync."
                  : "Enter a Chess.com username to start."}
            </span>
          </div>
        </div>

        <section className="profile-form">
          <label>
            <span>Chess.com username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button
            className="primary-button profile-sync"
            onClick={runChessComConnect}
            disabled={loading || !username.trim()}
          >
            {loading ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Connect and sync
            games
          </button>
          {(loading || profileSyncStatus || error) && (
            <div
              className={`profile-sync-status ${error ? "error" : syncMeta.status === "error" ? "error" : ""}`}
              role="status"
            >
              <strong>{error || profileSyncStatus || "Ready"}</strong>
              {loading && profileSyncPercent !== null && <span>{profileSyncPercent}% complete</span>}
              {loading && isAnalyzing && <span>Analyzing positions...</span>}
              {loading && !isAnalyzing && profileSyncPercent === null && <span>Working...</span>}
            </div>
          )}
          <div className="profile-grid">
            <label>
              <span>Months</span>
              <NumericSettingInput ariaLabel="Months" value={months} min={1} max={240} onValueChange={setMonths} />
            </label>
            <label>
              <span>Game cap</span>
              <NumericSettingInput
                ariaLabel="Game cap"
                value={gameLimit}
                min={1}
                max={50000}
                onValueChange={setGameLimit}
              />
            </label>
          </div>
          <label>
            <span>Time control</span>
            <select
              value={timeClass}
              onChange={(e) => setTimeClass(e.target.value as typeof timeClass)}
            >
              <option value="all">All time controls</option>
              <option value="rapid">Rapid</option>
              <option value="blitz">Blitz</option>
              <option value="bullet">Bullet</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <button
            className="ghost-button profile-sync"
            onClick={runChessComImport}
            disabled={loading || !username.trim()}
          >
            {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Sync{" "}
            {timeClass === "all" ? "Chess.com" : timeClass} games
          </button>
          <button className="ghost-button profile-sync" onClick={() => {
            if (window.confirm("Forget this profile and all saved data? This cannot be undone.")) {
              forgetProfile();
            }
          }}>
            Forget profile
          </button>
        </section>

        <details className="pgn-drawer">
          <summary>PGN tools</summary>
          <textarea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder="Paste PGN here..."
          />
          <div className="button-row">
            <button className="ghost-button" onClick={() => runPgnAnalysis()} disabled={!pgnText.trim()}>
              Analyze PGN
            </button>
            <label className="file-button">
              <FileUp size={16} /> Upload PGN
              <input
                type="file"
                accept=".pgn,.txt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    setFileError(true);
                    e.currentTarget.value = "";
                    return;
                  }
                  const text = await file.text();
                  setPgnText(text);
                  runPgnAnalysis(text);
                }}
              />
            </label>
            <button className="ghost-button" onClick={loadSample}>
              Load sample
            </button>
            {fileError && <div className="inline-error" style={{ marginTop: "8px", padding: "8px 12px", background: "rgba(220,38,38,0.12)", borderRadius: "8px", color: "#fca5a5", fontSize: "0.85rem" }}>Please choose a PGN under 5 MB.</div>}
          </div>
        </details>
      </div>
    </div>
  );
}

function NumericSettingInput({
  ariaLabel,
  value,
  min,
  max,
  onValueChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (nextDraft = draft) => {
    const parsed = Number.parseInt(nextDraft, 10);
    const nextValue = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(nextValue));
    if (nextValue !== value) onValueChange(nextValue);
  };

  return (
    <input
      aria-label={ariaLabel}
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => {
        const nextDraft = e.target.value.replace(/[^\d]/g, "");
        setDraft(nextDraft);
        if (nextDraft) {
          const parsed = Number.parseInt(nextDraft, 10);
          if (Number.isFinite(parsed)) onValueChange(Math.min(max, Math.max(min, parsed)));
        }
      }}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// ── import status ──────────────────────────────────────────

function ImportStatus({ progress }: { progress: ImportProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="import-status">
      <ProgressRing value={pct} />
      <div>
        <strong>{progress.label}</strong>
        <span>{pct}% complete</span>
      </div>
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span
      className="progress-ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      style={{
        width: 48,
        height: 48,
        background: `conic-gradient(var(--accent) ${clamped * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
      }}
      aria-label={`${clamped}% complete`}
    >
      <b>{clamped}</b>
    </span>
  );
}

// ── error boundary ────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="pc-shell">
        <div className="pc-error-boundary">
          <h1>Something went wrong</h1>
          <p>Refresh and try your last action again.</p>
          <pre>{this.state.error.message}</pre>
          <button className="pc-btn primary" onClick={() => location.reload()}>
            Reload app
          </button>
        </div>
      </main>
    );
  }
}

// ── app ────────────────────────────────────────────────────

export default function App() {
  const [username, setUsername] = useState("");
  const [months, setMonths] = useState(DEFAULT_MONTHS);
  const [gameLimit, setGameLimit] = useState(DEFAULT_GAME_LIMIT);
  const [timeClass, setTimeClass] = useState<"all" | "rapid" | "blitz" | "bullet" | "daily">(DEFAULT_TIME_CLASS);
  const [pgnText, setPgnText] = useState("");
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<MoveIssue | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<"dashboard" | "games" | "mistakes" | "patterns" | "drill" | "analysis">("dashboard");
  const [analysisReturnView, setAnalysisReturnView] = useState<"dashboard" | "games" | "mistakes" | "patterns" | "drill">("dashboard");
  const [analysisStart, setAnalysisStart] = useState<AnalysisStart | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [connectedUsername, setConnectedUsername] = useState("");
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ status: "idle" });
  const [drillQuality, setDrillQuality] = useState<MoveReviewQuality | "all">("all");
  const [drillPatternId, setDrillPatternId] = useState("all");
  const [drillIssue, setDrillIssue] = useState<MoveIssue | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const { analyzeMovePair } = useStockfish();
  const analysisAbortRef = useRef<AbortController | null>(null);
  const autoSyncRef = useRef("");
  const syncInFlightRef = useRef(false);
  const syncMetaRef = useRef(syncMeta);
  const lastBackgroundSyncRef = useRef(0);

  useEffect(() => {
    syncMetaRef.current = syncMeta;
  }, [syncMeta]);

  const openAnalysis = (
    fen?: string,
    flipped?: boolean,
    title?: string,
    context?: Omit<AnalysisStart, "fen" | "flipped" | "title">,
  ) => {
    if (!fen) return;
    if (activeView !== "analysis") setAnalysisReturnView(activeView);
    setAnalysisStart({ fen, flipped, title, ...context });
    startTransition(() => {
      setActiveView("analysis");
    });
  };

  // ── hydration ──

  useEffect(() => {
    const saved = readStorageValue(PROFILE_STORAGE_KEY);
    const savedReport = loadSavedReport();
    try {
      if (saved) {
        const parsed = normalizeStoredProfile(JSON.parse(saved));
        if (parsed.username) {
          setUsername(parsed.username);
          setConnectedUsername(parsed.username);
        }
        if (parsed.months) setMonths(parsed.months);
        if (parsed.gameLimit) setGameLimit(parsed.gameLimit);
        if (parsed.timeClass) setTimeClass(parsed.timeClass);
      }
      if (savedReport) {
        setReport(savedReport);
        setSelectedIssue(savedReport.summaries[0]?.examples[0] ?? null);
      }
      const savedSync = readStorageValue(SYNC_META_STORAGE_KEY);
      if (savedSync) setSyncMeta(JSON.parse(savedSync) as SyncMeta);
    } catch {
      removeStorageValue(PROFILE_STORAGE_KEY);
      removeStorageValue(SYNC_META_STORAGE_KEY);
    } finally {
      setProfileHydrated(true);
    }
  }, []);

  // ── persistence ──

  useEffect(() => {
    if (!profileHydrated) return;
    if (connectedUsername && !isPlaceholderUsername(connectedUsername)) {
      writeStorageValue(
        PROFILE_STORAGE_KEY,
        JSON.stringify({ username: connectedUsername, months, gameLimit, timeClass }),
      );
    } else {
      removeStorageValue(PROFILE_STORAGE_KEY);
    }
  }, [profileHydrated, connectedUsername, months, gameLimit, timeClass]);

  useEffect(() => {
    if (!profileHydrated) return;
    writeStorageValue(SYNC_META_STORAGE_KEY, JSON.stringify(syncMeta));
  }, [profileHydrated, syncMeta]);

  useEffect(() => {
    if (!profileHydrated) return;
    if (report) {
      const payload = JSON.stringify({ savedAt: Date.now(), report });
      const saved = writeStorageValue(REPORT_STORAGE_KEY, payload);
      if (!saved) {
        const stripped = {
          ...report,
          gameSummaries: report.gameSummaries.map((g) => ({ ...g, pgn: "" })),
        };
        writeStorageValue(REPORT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), report: stripped }));
      }
    } else {
      removeStorageValue(REPORT_STORAGE_KEY);
    }
  }, [profileHydrated, report]);

  // ── selected‑issue resolution ──

  useEffect(() => {
    if (!report) {
      if (selectedIssue) setSelectedIssue(null);
      return;
    }
    if (selectedIssue && findMatchingIssue(report, selectedIssue)) return;
    setSelectedIssue(report.summaries[0]?.examples[0] ?? report.issues[0] ?? null);
  }, [report]);

  useEffect(() => {
    return () => analysisAbortRef.current?.abort();
  }, []);

  // ── background engine refine ──

  useEffect(() => {
    if (!report) return;
    const candidates = report.moveReviews
      .filter((review) => !review.engineReviewed && review.issueIds.length && isTrainableQuality(review.quality))
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
      setReport((current) => {
        if (!current) return current;
        return {
          ...current,
          moveReviews: current.moveReviews.map((r) => updates.get(r.id) || r),
          issues: addEngineIssues(
            current.issues.map((issue) => {
              const update = [...updates.values()].find(
                (r) => r.fenBefore === issue.fenBefore && r.san === issue.san,
              );
              return update
                ? {
                    ...issue,
                    quality: update.quality,
                    severity: update.severity,
                    explanation: update.explanation,
                    engineBestMove: update.engineBestMove,
                    engineEvalLoss: update.engineEvalLoss,
                    engineReviewed: true,
                  }
                : issue;
            }),
            updates,
          ),
        };
      });
    }

    refineFlaggedMoves();
    return () => {
      cancelled = true;
    };
  }, [report, analyzeMovePair]);

  // ── auto‑sync on startup ──

  useEffect(() => {
    const syncUser = connectedUsername.trim().toLowerCase();
    const syncEnabled = Boolean(connectedUsername) && sameChessComUsername(username, connectedUsername);
    if (!profileHydrated || !shouldAutoSyncProfile(syncUser, loading, syncEnabled) || syncInFlightRef.current)
      return;
    if (report) return;
    const key = `startup:${syncUser}:${months}:${gameLimit}:${timeClass}`;
    if (autoSyncRef.current === key) return;
    autoSyncRef.current = key;
    runChessComImport({ usernameOverride: connectedUsername });
  }, [profileHydrated, username, connectedUsername, months, gameLimit, timeClass, loading, report]);

  // ── background sync interval ──

  useEffect(() => {
    const syncUser = connectedUsername.trim().toLowerCase();
    if (
      !profileHydrated ||
      !report ||
      !syncUser ||
      isPlaceholderUsername(syncUser) ||
      !sameChessComUsername(username, connectedUsername)
    )
      return;

    const syncLatest = () => {
      if (syncInFlightRef.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const now = Date.now();
      const lastSync = Math.max(lastBackgroundSyncRef.current, syncMetaRef.current.lastSyncedAt ?? 0);
      if (now - lastSync < BACKGROUND_SYNC_MIN_GAP_MS) return;
      lastBackgroundSyncRef.current = now;
      runChessComImport({ keepCurrentReport: true, silent: true, usernameOverride: connectedUsername });
    };

    const timer = window.setInterval(syncLatest, BACKGROUND_SYNC_INTERVAL_MS);

    const syncOnVisible = () => {
      if (document.visibilityState === "visible") syncLatest();
    };
    window.addEventListener("focus", syncLatest);
    window.addEventListener("online", syncLatest);
    document.addEventListener("visibilitychange", syncOnVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncLatest);
      window.removeEventListener("online", syncLatest);
      document.removeEventListener("visibilitychange", syncOnVisible);
    };
  }, [profileHydrated, report, username, connectedUsername, months, gameLimit, timeClass]);

  // ── actions ──

  const resetLocalProfileData = () => {
    removeStorageValue(PROFILE_STORAGE_KEY);
    removeStorageValue(REPORT_STORAGE_KEY);
    removeStorageValue(SYNC_META_STORAGE_KEY);
    analysisAbortRef.current?.abort();
    syncInFlightRef.current = false;
    autoSyncRef.current = "";
    lastBackgroundSyncRef.current = 0;
    setUsername("");
    setConnectedUsername("");
    setMonths(DEFAULT_MONTHS);
    setGameLimit(DEFAULT_GAME_LIMIT);
    setTimeClass(DEFAULT_TIME_CLASS);
    setPgnText("");
    setReport(null);
    setSelectedIssue(null);
    setProgress(null);
    setError("");
    setLoading(false);
    setSyncMeta({ status: "idle" });
    setActiveView("dashboard");
    setAnalysisStart(null);
    setAnalysisReturnView("dashboard");
  };

  async function runChessComImport(
    options: { keepCurrentReport?: boolean; silent?: boolean; usernameOverride?: string } = {},
  ) {
    if (syncInFlightRef.current) {
      if (!options.silent) {
        setSyncMeta({ status: "syncing", source: "chesscom", message: "Sync already running" });
        setProgress({ label: "Sync already running", done: 0, total: 1 });
      }
      return;
    }
    syncInFlightRef.current = true;
    if (!options.silent) setError("");
    if (!options.silent) setLoading(true);
    if (!options.silent) setProgress(null);
    setSyncMeta({
      status: "syncing",
      source: "chesscom",
      message: options.silent ? "Checking latest Chess.com games" : "Syncing Chess.com games",
    });
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const currentReport = report;
    try {
      const progressHandler = options.silent ? undefined : setProgress;
      const syncUsername = (options.usernameOverride || username).trim();
      const isSameConnectedUser = sameChessComUsername(syncUsername, connectedUsername);
      const isLatestRefresh = Boolean(options.keepCurrentReport && currentReport && isSameConnectedUser);
      const syncMonths = isLatestRefresh ? Math.min(Math.max(months, LATEST_SYNC_MONTHS), 3) : months;
      const syncLimit = Math.max(1, gameLimit);
      const games = await fetchChessComGames(syncUsername, syncMonths, timeClass, progressHandler, syncLimit);
      const knownUrls = new Set(
        (isLatestRefresh ? currentReport?.gameSummaries ?? [] : []).map((g) => g.url).filter(Boolean),
      );
      const newGames = isLatestRefresh ? games.filter((g) => !g.url || !knownUrls.has(g.url)) : games;
      const needsLimitRepair = Boolean(isLatestRefresh && currentReport && currentReport.games > syncLimit);

      if (isLatestRefresh && !newGames.length && !needsLimitRepair) {
        setSyncMeta({
          status: "idle",
          source: "chesscom",
          lastSyncedAt: Date.now(),
          message: `Already up to date (${currentReport?.games ?? 0} games)`,
        });
        return;
      }

      const gamesForAnalysis = newGames
        .slice()
        .sort((a, b) => (a.end_time ?? 0) - (b.end_time ?? 0))
        .slice(-syncLimit);
      const analysisLabel = `Analyzing ${isLatestRefresh ? "new" : gamesForAnalysis.length} games`;
      progressHandler?.({ label: analysisLabel, done: 1, total: 1 });
      if (!options.silent)
        setSyncMeta({ status: "syncing", source: "chesscom", message: analysisLabel });
      const nextReport =
        isLatestRefresh && currentReport
          ? await analyzeGamesInWorker(
              {
                kind: "pgn",
                username: syncUsername,
                pgnText: mergeReportAndFetchedPgns(currentReport, gamesForAnalysis, syncLimit),
              },
              controller.signal,
            )
          : await analyzeGamesInWorker(
              { kind: "chesscom", username: syncUsername, games: gamesForAnalysis },
              controller.signal,
            );
      const syncedUsername = syncUsername;
      setReport(nextReport);
      if (syncedUsername && !isPlaceholderUsername(syncedUsername)) {
        setConnectedUsername(syncedUsername);
        setUsername(syncedUsername);
        autoSyncRef.current = `${syncedUsername.toLowerCase()}:${months}:${gameLimit}:${timeClass}`;
      }
      if (options.silent && isLatestRefresh) {
        setSelectedIssue(
          (current) =>
            findMatchingIssue(nextReport, current) ?? nextReport.summaries[0]?.examples[0] ?? null,
        );
      } else {
        setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
        setActiveView("dashboard");
        setProfileOpen(false);
      }
      setSyncMeta({
        status: "idle",
        source: "chesscom",
        lastSyncedAt: Date.now(),
        message: isLatestRefresh
          ? needsLimitRepair
            ? `Kept latest ${nextReport.games} games`
            : `Added ${gamesForAnalysis.length} new game${gamesForAnalysis.length === 1 ? "" : "s"}`
          : `Synced ${nextReport.games} games`,
      });
      if (!nextReport.games) setError("No standard chess games matched that username and filter.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const message = err instanceof Error ? err.message : "The import failed.";
        if (!options.silent) setError(message);
        setSyncMeta({ status: "error", source: "chesscom", message });
        if (!options.keepCurrentReport && !currentReport) setReport(null);
      }
    } finally {
      syncInFlightRef.current = false;
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      if (!options.silent) setLoading(false);
      if (!options.silent) window.setTimeout(() => setProgress(null), 700);
    }
  }

  async function runChessComConnectAndSync() {
    setError("");
    setLoading(true);
    setProgress({ label: "Connecting Chess.com profile", done: 0, total: 2 });
    setSyncMeta({ status: "syncing", source: "chesscom", message: "Connecting Chess.com profile" });
    try {
      const profile = await fetchChessComProfile(username.trim());
      const canonicalUsername = profile.username || username.trim();
      setUsername(canonicalUsername);
      setProgress({ label: "Profile connected", done: 1, total: 2 });
      autoSyncRef.current = `${canonicalUsername.trim().toLowerCase()}:${months}:${gameLimit}:${timeClass}`;
      setLoading(false);
      await runChessComImport({ usernameOverride: canonicalUsername });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect that Chess.com profile.";
      setError(message);
      setSyncMeta({ status: "error", source: "chesscom", message });
      setLoading(false);
      window.setTimeout(() => setProgress(null), 700);
    }
  }

  async function runPgnAnalysis(nextText = pgnText, usernameOverride?: string) {
    setError("");
    setLoading(true);
    setProgress({ label: "Analyzing PGN", done: 0, total: 1 });
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const nextReport = await analyzeGamesInWorker(
        { kind: "pgn", username: usernameOverride || username || "You", pgnText: nextText },
        controller.signal,
      );
      setReport(nextReport);
      setSelectedIssue(nextReport.summaries[0]?.examples[0] ?? null);
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

  const navigateView = (view: "dashboard" | "games" | "mistakes" | "patterns" | "drill" | "analysis") => {
    setProfileOpen(false);
    setMenuOpen(false);
    if (view !== "games") setSelectedGameId(null);
    startTransition(() => {
      setActiveView(view);
    });
  };

  const startDrill = (quality: MoveReviewQuality | "all" = "all", patternId = "all", issue?: MoveIssue) => {
    if (issue) setSelectedIssue(issue);
    setDrillQuality(quality);
    setDrillPatternId(patternId);
    setDrillIssue(issue || null);
    startTransition(() => {
      setActiveView("drill");
    });
  };

  // ── render ──

  const shellProps: ShellProps = {
    activeView,
    setActiveView: navigateView,
    analysisReturnView,
    report: report!,
    username: username || connectedUsername,
    syncMeta,
    analysisStart,
    openProfile: () => setProfileOpen(true),
    openMenu: () => setMenuOpen(true),
    startDrill,
    openAnalysis,
    openGame: (gameId: number) => {
      setSelectedGameId(gameId);
      startTransition(() => {
        setActiveView("games");
      });
    },
    selectedGameId,
    drillQuality,
    drillPatternId,
    drillIssue,
  };

  return (
    <ErrorBoundary>
      <main className="pc-shell">
        {report ? (
          <ExactPatternCoachMobile
            activeView={shellProps.activeView}
            setActiveView={shellProps.setActiveView}
            analysisReturnView={shellProps.analysisReturnView}
            report={shellProps.report}
            username={shellProps.username}
            syncMeta={shellProps.syncMeta}
            analysisStart={shellProps.analysisStart}
            openProfile={shellProps.openProfile}
            openMenu={shellProps.openMenu}
            startDrill={shellProps.startDrill}
            openAnalysis={shellProps.openAnalysis}
            openGame={shellProps.openGame}
            selectedGameId={shellProps.selectedGameId}
            drillQuality={shellProps.drillQuality}
            drillPatternId={shellProps.drillPatternId}
            drillIssue={shellProps.drillIssue}
          />
        ) : (
          <ExactMobileImport
            username={username}
            setUsername={setUsername}
            months={months}
            setMonths={setMonths}
            gameLimit={gameLimit}
            setGameLimit={setGameLimit}
            timeClass={timeClass}
            setTimeClass={setTimeClass}
            loading={loading}
            openProfile={() => setProfileOpen(true)}
            connectAndSync={runChessComConnectAndSync}
            loadSample={() => {
              const samplePgn = `[Event "Training sample"]
[Site "https://www.chess.com/game/live/sample"]
[Date "2026.05.13"]
[White "Sample"]
[Black "CoachBot"]
[Result "0-1"]

1. e4 e5 2. Qh5 Nf6 3. Bc4 Nxh5 0-1`;
              setPgnText(samplePgn);
              runPgnAnalysis(samplePgn, "Sample");
            }}
            progress={progress}
            syncMeta={syncMeta}
            error={error}
          />
        )}

        {menuOpen && (
          <AppMenu
            report={report}
            username={username}
            connectedUsername={connectedUsername}
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
              resetLocalProfileData();
              setMenuOpen(false);
            }}
          />
        )}

        {profileOpen && (
          <ProfileSheet
            username={username}
            setUsername={setUsername}
            connectedUsername={connectedUsername}
            months={months}
            setMonths={setMonths}
            gameLimit={gameLimit}
            setGameLimit={setGameLimit}
            timeClass={timeClass}
            setTimeClass={setTimeClass}
            pgnText={pgnText}
            setPgnText={setPgnText}
            loading={loading}
            progress={progress}
            error={error}
            syncMeta={syncMeta}
            runChessComConnect={runChessComConnectAndSync}
            runChessComImport={() => runChessComImport()}
            runPgnAnalysis={runPgnAnalysis}
            loadSample={() => {
              setPgnText(
                `[Event "Training sample"]
[Site "https://www.chess.com/game/live/sample"]
[Date "2026.05.13"]
[White "Sample"]
[Black "CoachBot"]
[Result "0-1"]

1. e4 e5 2. Qh5 Nf6 3. Bc4 Nxh5 0-1`,
              );
              runPgnAnalysis(
                `[Event "Training sample"]
[Site "https://www.chess.com/game/live/sample"]
[Date "2026.05.13"]
[White "Sample"]
[Black "CoachBot"]
[Result "0-1"]

1. e4 e5 2. Qh5 Nf6 3. Bc4 Nxh5 0-1`,
                "Sample",
              );
            }}
            forgetProfile={() => {
              resetLocalProfileData();
              setProfileOpen(false);
            }}
            close={() => setProfileOpen(false)}
          />
        )}
      </main>
    </ErrorBoundary>
  );
}
