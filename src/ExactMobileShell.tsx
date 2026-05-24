import { CSSProperties, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Chess } from "chess.js";
import { Search } from "lucide-react";
import type { AnalysisReport, GameSummary, MoveIssue, MoveReview, MoveReviewQuality, Phase } from "./analysis/patterns";
import type { ImportProgress } from "./analysis/chesscom";
import { DEFAULT_ENGINE_DEPTH, DEFAULT_ENGINE_MULTIPV, type EngineEvaluation, type MoveEngineResult } from "./engine/EngineService";
import { useStockfish } from "./engine/useStockfish";
import { explainMove, type MoveExplanation } from "./analysis/moveExplainer";
import { buildStruggleMap, struggleGradient, topStruggleSquares, type StruggleMap, type StrugglePhase } from "./analysis/struggleMap";

type AppView = "dashboard" | "games" | "mistakes" | "patterns" | "drill" | "analysis";
type DrillPhaseFilter = Phase | "all";
type PatternViewFilter = StrugglePhase;
type PatternOpeningSort = "loss" | "games" | "win" | "name";

type ShellAnalysisStart = {
  fen: string;
  flipped?: boolean;
  title?: string;
  gamePgn?: string;
  returnMistakeReviewId?: string;
};

type AnalysisOpenContext = Pick<ShellAnalysisStart, "gamePgn" | "returnMistakeReviewId">;

type SyncMeta = {
  lastSyncedAt?: number;
  source?: "chesscom" | "pgn" | "sample";
  status?: "idle" | "syncing" | "error";
  message?: string;
};

type ExactShellProps = {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  analysisReturnView: Exclude<AppView, "analysis">;
  report: AnalysisReport;
  username: string;
  syncMeta?: SyncMeta;
  analysisStart?: ShellAnalysisStart | null;
  openProfile: () => void;
  openMenu: () => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  openGame: (gameId: number) => void;
  selectedGameId: number | null;
  drillQuality: MoveReviewQuality | "all";
  drillPatternId: string;
  drillIssue: MoveIssue | null;
};

type DesignArrow = { from: string; to: string; kind?: "you" | "them" | "idea" | "neutral" };

type GameTimelineMove = {
  ply: number;
  moveNumber: number;
  san: string;
  uci: string;
  color: "w" | "b";
  fenBefore: string;
  fenAfter: string;
  lastMove: { from: string; to: string };
  review?: MoveReview;
};

type MoveExplainerState = {
  open: boolean;
  loading: boolean;
  data: MoveExplanation | null;
  error: string;
  title: string;
};

type AnalysisLineOption = {
  move: string;
  evalLabel: string;
  pv: string;
  rawPv: string;
  sourceFen?: string;
};

type AnalysisPlaybackFrame = {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  highlights: Record<string, string>;
  arrows: DesignArrow[];
};

type AnalysisPlaybackState = {
  key: string;
  frames: AnalysisPlaybackFrame[];
  index: number;
};

type AnalysisWhyBeat = {
  toneName: "you" | "them" | "idea" | "neutral";
  tag: string;
  caption: string;
  spotlights: string[];
  arrows: DesignArrow[];
};

const phaseLabels: Record<Phase, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
const MATE_CP_THRESHOLD = 90_000;
const pieceGlyphs: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

export function ExactPatternCoachMobile({
  activeView,
  setActiveView,
  analysisReturnView,
  report,
  username,
  syncMeta,
  analysisStart,
  openProfile,
  openMenu,
  startDrill,
  openAnalysis,
  openGame,
  selectedGameId,
  drillQuality,
  drillPatternId,
  drillIssue,
}: ExactShellProps) {
  const [mobileLabPattern, setMobileLabPattern] = useState("all");
  const [mobileLabQuality, setMobileLabQuality] = useState<MoveReviewQuality | "all">("all");
  const [mobileLabReviewId, setMobileLabReviewId] = useState("");
  const [mobileLabMode, setMobileLabMode] = useState<"list" | "detail">("list");
  const [mobileDrillMode, setMobileDrillMode] = useState<"picker" | "session">("picker");
  const [mobilePatternTrap, setMobilePatternTrap] = useState<string | null>(null);
  const patternModel = useMemo(() => buildPatternModel(report), [report]);

  const openMobilePattern = (patternId: string) => {
    setMobilePatternTrap(patternId || null);
    setActiveView("patterns");
  };

  const openPatternsHome = () => {
    setMobilePatternTrap(null);
    setActiveView("patterns");
  };

  const navigateWithReset = (view: AppView) => {
    if (view !== activeView) {
      if (view === "mistakes") {
        setMobileLabMode("list");
        setMobileLabReviewId("");
      }
      if (view === "drill") {
        setMobileDrillMode("picker");
      }
    }
    if (view === "patterns") {
      setMobilePatternTrap(null);
    }
    setActiveView(view);
  };

  return (
    <main className="pc-shell">
      <StatusOverlay />
      {activeView === "dashboard" && (
        <DashboardPage
          report={report}
          username={username}
          syncMeta={syncMeta}
          setActiveView={setActiveView}
          openProfile={openProfile}
          openGame={openGame}
          train={() => startDrill("all")}
          openPattern={openMobilePattern}
        />
      )}
      {activeView === "games" && (
        <GamesPage
          report={report}
          syncMeta={syncMeta}
          setActiveView={setActiveView}
          openAnalysis={openAnalysis}
          preselectedGameId={selectedGameId}
        />
      )}
      {activeView === "mistakes" && (
        <MistakeLabPage
          report={report}
          setActiveView={setActiveView}
          startDrill={startDrill}
          openAnalysis={openAnalysis}
          initialPatternFilter={mobileLabPattern}
          qualityFilter={mobileLabQuality}
          setQualityFilter={setMobileLabQuality}
          selectedReviewId={mobileLabReviewId}
          setSelectedReviewId={setMobileLabReviewId}
          mobileMode={mobileLabMode}
          setMobileMode={setMobileLabMode}
        />
      )}
      {activeView === "patterns" && (
        <PatternsPage
          report={report}
          patternModel={patternModel}
          selectedTrapKey={mobilePatternTrap}
          setSelectedTrapKey={setMobilePatternTrap}
          startDrill={startDrill}
        />
      )}
      {activeView === "drill" && (
        <DrillPage
          report={report}
          setActiveView={setActiveView}
          startDrill={startDrill}
          openAnalysis={openAnalysis}
          mobileMode={mobileDrillMode}
          setMobileMode={setMobileDrillMode}
          drillQuality={drillQuality}
          drillPatternId={drillPatternId}
          drillIssue={drillIssue}
        />
      )}
      {activeView === "analysis" && (
        <AnalysisPage
          report={report}
          start={analysisStart}
          setActiveView={setActiveView}
          back={() => {
            setMobileLabMode("list");
            setMobileLabReviewId("");
            setMobileDrillMode("picker");
            setActiveView(analysisReturnView);
          }}
        />
      )}
      <MobileTabBar
        activeView={activeView}
        analysisReturnView={analysisReturnView}
        setActiveView={navigateWithReset}
        openMenu={openMenu}
        openProfile={openProfile}
      />
      <HomeIndicator />
    </main>
  );
}

export function ExactMobileImport({
  username,
  setUsername,
  connectAndSync,
  loading,
  openProfile,
  loadSample,
  months,
  setMonths,
  gameLimit,
  setGameLimit,
  timeClass,
  setTimeClass,
  progress,
  syncMeta,
  error,
}: {
  username: string;
  setUsername: (value: string) => void;
  connectAndSync: () => void;
  loading: boolean;
  openProfile: () => void;
  loadSample: () => void;
  months: number;
  setMonths: (value: number) => void;
  gameLimit: number;
  setGameLimit: (value: number) => void;
  timeClass: "all" | "rapid" | "blitz" | "bullet" | "daily";
  setTimeClass: (value: "all" | "rapid" | "blitz" | "bullet" | "daily") => void;
  progress: ImportProgress | null;
  syncMeta: SyncMeta;
  error: string;
}) {
  const isAnalyzing = Boolean(progress?.label.toLowerCase().startsWith("analyzing"));
  const progressPct = progress?.total && !isAnalyzing ? Math.round((progress.done / progress.total) * 100) : null;
  const statusText = friendlySyncMessage(error || progress?.label || syncMeta.message) || "Ready to sync";
  const statusClass = error || syncMeta.status === "error" ? "error" : progress || syncMeta.status === "syncing" ? "loading" : "idle";

  return (
    <main className="pc-import-page">
      <section className="pc-import-left">
        <BrandMark />
        <div className="pc-import-copy">
          <div className="pc-eyebrow">Connect</div>
          <h1>Bring in <i className="pc-you">your games.</i> We'll find the shapes you keep <i className="pc-them">misreading.</i></h1>
        </div>
        <div className="pc-import-form">
          <label className="pc-form-row">
            <span>Chess.com username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="your_username"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <div className="pc-import-grid">
            <label className="pc-form-row">
              <span>Months</span>
              <ImportNumberInput ariaLabel="Months" value={months} min={1} max={240} onValueChange={setMonths} />
            </label>
            <label className="pc-form-row">
              <span>Game cap</span>
              <ImportNumberInput ariaLabel="Game cap" value={gameLimit} min={1} max={50000} onValueChange={setGameLimit} />
            </label>
          </div>
          <div className="pc-form-row">
            <span>Time controls</span>
            <div className="pc-time-chips">
              {(["all", "bullet", "blitz", "rapid", "daily"] as const).map(value => (
                <button key={value} type="button" className={timeClass === value ? "active" : ""} onClick={() => setTimeClass(value)}>
                  {value === "all" ? "All" : titleCase(value)}
                </button>
              ))}
            </div>
          </div>
          <div className={`pc-import-status ${statusClass}`} role="status">
            <strong>{statusText}</strong>
            <span>{progressPct !== null ? `${progressPct}% complete` : isAnalyzing ? "Analyzing positions..." : statusClass === "loading" ? "Working..." : "Local analysis · no account required"}</span>
          </div>
        </div>
        <div className="pc-import-actions">
          <Button primary onClick={connectAndSync} disabled={loading || !username.trim()}>{loading ? "Syncing..." : "Sync games"} <span>↗</span></Button>
          <Button onClick={openProfile}>PGN tools</Button>
          <Button ghost onClick={loadSample}>Try sample</Button>
        </div>
        <div className="pc-import-foot">LOCAL ANALYSIS · NO ACCOUNT REQUIRED · STOCKFISH 18</div>
      </section>
      <section className="pc-import-preview">
        <div className="pc-preview-grid" />
        <div className="pc-preview-content">
          <div className="pc-eyebrow">What you'll see</div>
          <div className="pc-preview-board-row">
            <DesignBoard
              fen="r1bqk2r/pppp1ppp/2n2n2/2b1p2Q/2B1P3/5N2/PPPP1PPP/RNB1K2R"
              size={240}
              showCoords={false}
              highlights={{ c4: "you", h5: "them", f3: "idea" }}
              arrows={[{ from: "f6", to: "h5", kind: "them" }]}
            />
            <div className="pc-preview-map">
              <PreviewMini kind="you" label="You" san="Bc4" />
              <PreviewMini kind="them" label="Them" san="Nxh5" />
              <PreviewMini kind="idea" label="Idea" san="Nf3" />
            </div>
          </div>
          <p>Your move map, your patterns. Every spot comes from <i>your</i> games, not a puzzle library.</p>
          <div className="pc-preview-stats">
            <MetricBlock label="Patterns" value="9" />
            <MetricBlock label="Openings" value="13" divider />
            <MetricBlock label="Motifs" value="20+" divider />
          </div>
        </div>
      </section>
    </main>
  );
}

function ImportNumberInput({ ariaLabel, value, min, max, onValueChange }: {
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
      onChange={event => {
        const nextDraft = event.target.value.replace(/[^\d]/g, "");
        setDraft(nextDraft);
        if (nextDraft) {
          const parsed = Number.parseInt(nextDraft, 10);
          if (Number.isFinite(parsed)) onValueChange(Math.min(max, Math.max(min, parsed)));
        }
      }}
      onBlur={() => commit()}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function DashboardPage({ report, username, syncMeta, setActiveView, openProfile, openGame, train, openPattern }: {
  report: AnalysisReport;
  username: string;
  syncMeta?: SyncMeta;
  setActiveView: (view: AppView) => void;
  openProfile: () => void;
  openGame: (gameId: number) => void;
  train: () => void;
  openPattern: (patternId: string) => void;
}) {
  return (
    <MobileDashboardSurface
      report={report}
      username={username}
      openProfile={openProfile}
      review={() => setActiveView("mistakes")}
      train={train}
      openPattern={openPattern}
    />
  );
}

function GamesPage({ report, syncMeta, setActiveView, openAnalysis, preselectedGameId }: {
  report: AnalysisReport;
  syncMeta?: SyncMeta;
  setActiveView: (view: AppView) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  preselectedGameId: number | null;
}) {
  const [gameFilter, setGameFilter] = useState("all");
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [selectedGameId, setSelectedGameId] = useState(-1);
  const [selectedPly, setSelectedPly] = useState(0);
  const [boardFlipped, setBoardFlipped] = useState(false);

  const allSorted = useMemo(() => report.gameSummaries
    .slice()
    .sort((a, b) => (b.endTime ?? b.id) - (a.endTime ?? a.id)), [report.gameSummaries]);

  const visibleGames = useMemo(() => allSorted.filter(game => {
    if (gameFilter === "all") return true;
    if (gameFilter === "mistakes") return game.issues > 0;
    if (gameFilter === "white") return game.color === "white";
    if (gameFilter === "black") return game.color === "black";
    if (gameFilter === "rapid" || gameFilter === "blitz" || gameFilter === "bullet" || gameFilter === "daily") return game.timeClass === gameFilter;
    return true;
  }), [allSorted, gameFilter]);

  useEffect(() => {
    if (preselectedGameId !== null && preselectedGameId !== undefined) {
      const target = allSorted.find(g => g.id === preselectedGameId);
      if (target) {
        setSelectedGameId(preselectedGameId);
        setMode("detail");
        setSelectedPly(0);
      }
    }
  }, [preselectedGameId, allSorted]);

  const selectedGame = visibleGames.find(g => g.id === selectedGameId) || visibleGames[0];
  const reviews = useMemo(() => report.moveReviews.filter(r => r.gameId === selectedGame?.id), [report.moveReviews, selectedGame?.id]);
  const timeline = useMemo(() => selectedGame ? buildGameTimeline(selectedGame, reviews) : [], [selectedGame, reviews]);
  const currentFen = selectedPly > 0 && timeline.length
    ? timeline[Math.min(selectedPly - 1, timeline.length - 1)]?.fenAfter || timeline[0]?.fenBefore || new Chess().fen()
    : timeline[0]?.fenBefore || new Chess().fen();
  const selectedMove = selectedPly > 0 ? timeline[Math.min(selectedPly - 1, timeline.length - 1)] : null;

  useEffect(() => {
    setSelectedPly(0);
    if (selectedGame) setBoardFlipped(selectedGame.color === "black");
  }, [selectedGameId]);

  const jumpBy = (delta: number) => setSelectedPly(current => Math.max(0, Math.min(timeline.length, current + delta)));

  if (mode === "detail" && selectedGame) {
    return (
      <section className="pc-mobile-surface pc-mobile-games-detail">
        <div className="pc-mobile-detail-top">
          <MobileCircleButton ariaLabel="Back to games" onClick={() => { setMode("list"); setSelectedPly(0); }}>‹</MobileCircleButton>
          <div className="pc-mobile-detail-title">
            <strong>{selectedGame.opponent || "Unknown opponent"}</strong>
            <span>{[selectedGame.opening, selectedGame.timeClass, formatGameDate(selectedGame.endTime)].filter(Boolean).join(" · ")}</span>
          </div>
          <MobileCircleButton
            ariaLabel="Analyse position"
            onClick={() => openAnalysis(currentFen, selectedGame.color === "black", selectedGame.opponent || "Game analysis", { gamePgn: selectedGame.pgn })}
          >↗</MobileCircleButton>
        </div>

        <div className="pc-mobile-analysis-board-row">
          <EvalBar score={0} height={325} />
          <DesignBoard
            fen={currentFen}
            size={313}
            flipped={boardFlipped}
            lastMove={selectedMove?.lastMove}
            highlights={selectedMove ? { [selectedMove.lastMove.to]: selectedMove.review ? qualityTone(selectedMove.review.quality) : "sel" } : {}}
            onAnalyze={() => openAnalysis(currentFen, boardFlipped, selectedGame.opponent || "Game analysis", { gamePgn: selectedGame.pgn })}
          />
        </div>

        <div className="pc-mobile-analysis-eval">
          <div>
            <span>Replay</span>
            <strong> {selectedPly}/{timeline.length}</strong>
          </div>
          <div className="pc-mobile-engine-status">
            <span>{sideToMove(currentFen).toUpperCase()}</span>
            <small>to move</small>
          </div>
        </div>

        <div className="pc-mobile-analysis-controls-row">
          <button className="pc-mobile-analysis-flip" onClick={() => setBoardFlipped(v => !v)}>⇄</button>
          <div className="pc-mobile-analysis-controls">
            <button onClick={() => setSelectedPly(0)}>⏮</button>
            <button onClick={() => jumpBy(-1)} disabled={selectedPly <= 0}>◀</button>
            <button onClick={() => setSelectedPly(timeline.length)}>⏭</button>
            <button onClick={() => jumpBy(1)} disabled={selectedPly >= timeline.length}>▶</button>
          </div>
        </div>

        <div className="game-move-strip" aria-label="Game move list">
          <button className={selectedPly === 0 ? "active start" : "start"} onClick={() => setSelectedPly(0)}>Start</button>
          {timeline.map(move => (
            <button
              key={`${move.ply}-${move.uci}`}
              className={`${selectedPly === move.ply ? "active" : ""} ${move.review ? qualityBucket(move.review.quality) : ""} ${move.color === (selectedGame.color === "white" ? "w" : "b") ? "user-move" : ""}`.trim()}
              onClick={() => setSelectedPly(move.ply)}
            >
              {move.san}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="pc-mobile-surface pc-mobile-games">
      <MobilePageHead eyebrow={`${visibleGames.length} of ${report.games} games`} title="Games" />
      <div className="pc-mobile-chip-row">
        {(Object.entries({ all: "All", mistakes: "With mistakes", white: "White", black: "Black" }) as [string, string][]).map(([id, label]) => (
          <button key={id} className={gameFilter === id ? "active" : ""} onClick={() => setGameFilter(id)}>{label}</button>
        ))}
      </div>
      <div className="pc-mobile-row-list">
        {visibleGames.map(game => (
          <button key={game.id} className="pc-mobile-game-row" onClick={() => { setSelectedGameId(game.id); setMode("detail"); }}>
            <span className={game.result}>{game.result === "win" ? "W" : game.result === "loss" ? "L" : game.result === "draw" ? "D" : "?"}</span>
            <div><strong>{game.opponent || "Unknown opponent"}</strong><small>{[game.opening, game.timeClass, formatGameDate(game.endTime)].filter(Boolean).join(" · ")}</small></div>
            <b>{game.issues || "—"}</b>
            <em>›</em>
          </button>
        ))}
        {visibleGames.length === 0 && <div className="pc-mobile-empty-inline">No games match this filter.</div>}
      </div>
    </section>
  );
}

function MistakeLabPage({
  report,
  setActiveView,
  startDrill,
  openAnalysis,
  initialPatternFilter = "all",
  qualityFilter,
  setQualityFilter,
  selectedReviewId,
  setSelectedReviewId,
  mobileMode,
  setMobileMode,
}: {
  report: AnalysisReport;
  setActiveView: (view: AppView) => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  initialPatternFilter?: string;
  qualityFilter: MoveReviewQuality | "all";
  setQualityFilter: (quality: MoveReviewQuality | "all") => void;
  selectedReviewId: string;
  setSelectedReviewId: (reviewId: string) => void;
  mobileMode: "list" | "detail";
  setMobileMode: (mode: "list" | "detail") => void;
}) {
  const allReviews = useMemo(() => getTrainableReviews(report), [report]);
  const [patternFilter, setPatternFilter] = useState(initialPatternFilter);
  const [detailView, setDetailView] = useState<"your" | "them" | "idea">("your");
  const patternReviews = useMemo(() => allReviews.filter(review => patternFilter === "all" || review.issueIds.includes(patternFilter as never)), [allReviews, patternFilter]);
  const qualityOptions = useMemo(() => buildQualityFilterOptions(patternReviews), [patternReviews]);
  const filteredReviews = useMemo(() => patternReviews.filter(review => qualityFilter === "all" || review.quality === qualityFilter), [patternReviews, qualityFilter]);
  const selectedReview = filteredReviews.find(review => review.id === selectedReviewId) || filteredReviews[0];
  const issue = selectedReview ? issueForReview(report, selectedReview, patternFilter !== "all" ? patternFilter : undefined) : null;
  const game = selectedReview ? report.gameSummaries.find(item => item.id === selectedReview.gameId) : undefined;

  useEffect(() => {
    setPatternFilter(initialPatternFilter);
  }, [initialPatternFilter]);

  useEffect(() => {
    if (qualityFilter !== "all" && !patternReviews.some(review => review.quality === qualityFilter)) {
      setQualityFilter("all");
    }
  }, [patternReviews, qualityFilter, setQualityFilter]);

  useEffect(() => {
    if (!selectedReviewId || !filteredReviews.some(review => review.id === selectedReviewId)) {
      setSelectedReviewId(filteredReviews[0]?.id || "");
    }
  }, [filteredReviews, selectedReviewId]);

  return (
    <MobileMistakeLabSurface
      report={report}
      reviews={filteredReviews}
      selectedReview={selectedReview}
      selectedIssue={issue}
      patternFilter={patternFilter}
      setPatternFilter={setPatternFilter}
      qualityFilter={qualityFilter}
      setQualityFilter={setQualityFilter}
      qualityOptions={qualityOptions}
      mode={mobileMode}
      setMode={setMobileMode}
      selectReview={(reviewId) => {
        setSelectedReviewId(reviewId);
        setMobileMode("detail");
      }}
      detailView={detailView}
      setDetailView={setDetailView}
      startDrill={startDrill}
      openAnalysis={openAnalysis}
      game={game}
    />
  );
}

function DrillPage({ report, setActiveView, startDrill, openAnalysis, mobileMode, setMobileMode, drillQuality, drillPatternId, drillIssue }: {
  report: AnalysisReport;
  setActiveView: (view: AppView) => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  mobileMode: "picker" | "session";
  setMobileMode: (mode: "picker" | "session") => void;
  drillQuality: MoveReviewQuality | "all";
  drillPatternId: string;
  drillIssue: MoveIssue | null;
}) {
  const issues = useMemo(() => {
    let filtered = report.issues.slice().sort((a, b) => b.severity - a.severity);
    if (drillQuality && drillQuality !== "all") {
      filtered = filtered.filter(i => i.quality === drillQuality);
    }
    if (drillPatternId && drillPatternId !== "all") {
      filtered = filtered.filter(i => i.id === drillPatternId || i.title === drillPatternId);
    }
    if (drillIssue) {
      const exact = filtered.find(i => i.fenBefore === drillIssue.fenBefore && i.uci === drillIssue.uci);
      if (exact) filtered = [exact, ...filtered.filter(i => i !== exact)];
    }
    return filtered.length ? filtered : report.issues.slice().sort((a, b) => b.severity - a.severity);
  }, [report.issues, drillQuality, drillPatternId, drillIssue]);
  const [index, setIndex] = useState(0);
  const [candidate, setCandidate] = useState("");
  const [sortOrder, setSortOrder] = useState<"pressing" | "new" | "accuracy" | "quick">("pressing");
  const issue = issues[index] || issues[0];
  const bestMove = issue?.engineBestMove || "";

  if (!issue) {
    return (
      <div className="pc-empty-state">Sync or import more games to create a personal drill queue.</div>
    );
  }

  return (
    <MobileDrillSurface
      report={report}
      issues={issues}
      issue={issue}
      index={index}
      setIndex={setIndex}
      candidate={candidate}
      setCandidate={setCandidate}
      bestMove={bestMove}
      candidates={buildDrillCandidates(issue, bestMove)}
      mode={mobileMode}
      setMode={setMobileMode}
      openAnalysis={openAnalysis}
      sortOrder={sortOrder}
      setSortOrder={setSortOrder}
    />
  );
}

type PatternTrap = {
  key: string;
  patternId: string;
  opening: string;
  openingFamily: string;
  playerColor: "white" | "black";
  title: string;
  phase: Phase;
  count: number;
  gameCount: number;
  gameIds: number[];
  winRate: number;
  averageLossCp: number | null;
  totalLossCp: number | null;
  engineReviewedCount: number;
  cleanGames: number;
  lastReset: string;
  personalBest: number;
  recentFirings: number;
  recentTimeline: boolean[];
  fen: string;
  evalLabel: string;
  cueCopy: string;
  cureAction: string;
  cureMove: string;
  cureNote: string;
  mainLine: string;
  mainLineMoves: string[];
  engineLine: string;
  weaknessCopy: string;
  trainingFocus: string;
  openingPlan: string;
  momentCopy: string;
  trigger: string;
  insight: string;
  highlights: Record<string, string>;
  arrows: DesignArrow[];
  lastMove?: { from: string; to: string } | null;
  formation: PatternFormationStep[];
  issue?: MoveIssue;
  reviews: MoveReview[];
};

type PatternHeatSquare = {
  square: string;
  count: number;
  lossCp: number;
  pct: number;
  role: "played" | "cure" | "reply";
  label: string;
};

type PatternHeatmap = {
  phase: Phase;
  playerColor: "white" | "black";
  count: number;
  engineReviewedCount: number;
  totalLossCp: number | null;
  evalLabel: string;
  fen: string;
  squares: PatternHeatSquare[];
  focus?: PatternHeatSquare;
  opening?: string;
  line: string;
  summary: string;
};

type PatternOpeningNode = {
  id: string;
  phase: Phase;
  family: string;
  variation: string;
  playerColor: "white" | "black";
  lineName: string;
  movePath: string[];
  gameCount: number;
  patternCount: number;
  winRate: number;
  avgLossCp: number | null;
  totalLossCp: number | null;
  topTrapKey: string;
  plans: string[];
  commonTraps: string[];
};

type WeaknessCluster = {
  id: string;
  title: string;
  openingFamily: string;
  lineName: string;
  motifName: string;
  phase: Phase;
  count: number;
  avgLossCp: number | null;
  totalLossCp: number | null;
  winRate: number;
  focusSquares: PatternHeatSquare[];
  topTrapKey: string;
  trainingGoal: string;
  status: "active" | "improving" | "worsening";
};

type PatternTrainingPlan = {
  id: string;
  clusterId: string;
  trapKey: string;
  mode: "recognition" | "prevention" | "calculation" | "repertoire";
  title: string;
  description: string;
  positions: number;
  targetMove: string;
  successRule: string;
  durationMin: number;
  priority: number;
};

type PatternProgressSnapshot = {
  activeClusters: number;
  improvingClusters: number;
  worseningClusters: number;
  cleanStreak: number;
  personalBest: number;
  last30Firings: number;
  headline: string;
};

type PatternModel = {
  traps: PatternTrap[];
  phaseStats: Array<{ phase: Phase; label: string; count: number }>;
  heatmaps: Record<Phase, PatternHeatmap>;
  struggleMaps: Record<StrugglePhase, StruggleMap>;
  openings: PatternOpeningNode[];
  clusters: WeaknessCluster[];
  trainingPlans: PatternTrainingPlan[];
  progress: PatternProgressSnapshot;
};

type PatternFormationStep = {
  ply: string;
  label: string;
  fen: string;
  lastMove?: { from: string; to: string } | null;
};

function PatternsPage({ report, patternModel, selectedTrapKey, setSelectedTrapKey, startDrill }: {
  report: AnalysisReport;
  patternModel: PatternModel;
  selectedTrapKey: string | null;
  setSelectedTrapKey: (key: string | null) => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
}) {
  const traps = patternModel.traps;
  const selectedTrap = selectedTrapKey
    ? traps.find(trap => trap.key === selectedTrapKey || trap.patternId === selectedTrapKey) ?? null
    : null;

  if (selectedTrap) {
    return (
      <PatternTrapDetail
        trap={selectedTrap}
        trapIndex={Math.max(0, traps.findIndex(trap => trap.key === selectedTrap.key))}
        trapTotal={traps.length}
        back={() => setSelectedTrapKey(null)}
        startDrill={startDrill}
      />
    );
  }

  return <PatternOverview report={report} patternModel={patternModel} traps={traps} openTrap={(key) => setSelectedTrapKey(key)} startDrill={startDrill} />;
}

function PatternOverview({ report, patternModel, traps, openTrap, startDrill }: {
  report: AnalysisReport;
  patternModel: PatternModel;
  traps: PatternTrap[];
  openTrap: (key: string) => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<PatternViewFilter>("all");
  const [openingSort, setOpeningSort] = useState<PatternOpeningSort>("loss");
  const phaseStats = patternModel.phaseStats;
  const filterOptions = buildPatternFilterOptions(phaseStats);
  const filteredTraps = activeFilter === "all" ? traps : traps.filter(trap => trap.phase === activeFilter);
  const visibleTraps = filteredTraps.slice(0, 5);
  const openingRows = sortPatternOpenings(patternModel.openings, openingSort);
  const showOpenings = activeFilter === "all" || activeFilter === "opening";
  const leadTrap = visibleTraps[0] || traps[0];
  const struggleMap = patternModel.struggleMaps[activeFilter];
  const windowLabel = patternWindowLabel(report);
  const totalSpots = phaseStats.reduce((sum, phase) => sum + phase.count, 0);
  const activeCount = activeFilter === "all" ? totalSpots : phaseStats.find(stat => stat.phase === activeFilter)?.count || 0;
  const filterLabel = activeFilter === "all" ? "all phases" : phaseLabels[activeFilter].toLowerCase();
  const drillPattern = visibleTraps[0];

  useEffect(() => {
    if (activeFilter === "all" || traps.some(trap => trap.phase === activeFilter)) return;
    setActiveFilter("all");
  }, [activeFilter, traps]);

  return (
    <section className="pc-mobile-surface pc-patterns-overview">
      <div className="pc-pattern-topline">
        <span>{totalSpots} spots · {windowLabel}</span>
        <button type="button" aria-label="Drill all patterns" onClick={() => startDrill("all")}>⚙</button>
      </div>
      <h1>Patterns</h1>

      <div className="pc-mobile-phase-tabs pc-pattern-filter-tabs" role="tablist" aria-label="Pattern phase">
        {filterOptions.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={activeFilter === option.id}
            className={activeFilter === option.id ? "active" : ""}
            disabled={option.id !== "all" && option.count === 0}
            onClick={() => setActiveFilter(option.id)}
          >
            <span>{option.label}</span><b>{option.count}</b>
          </button>
        ))}
      </div>

      {leadTrap ? (
        <>
          <button className="pc-pattern-board-card" type="button" aria-label="Open strongest pattern detail" onClick={() => openTrap(leadTrap.key)}>
            <MasterStruggleHeatmap
              map={struggleMap}
              fallbackTrap={leadTrap}
            />
            <div className="pc-pattern-loss-strip">
              <i style={{ width: `${patternLossPct(leadTrap, traps)}%` }} aria-hidden="true" />
              <span>{activeFilter === "all" ? "total loss" : `${phaseLabels[activeFilter]} loss`} · {windowLabel}</span>
              <strong>{struggleMap.reviewedCount ? formatLossCp(struggleMap.totalLossCp) : "pending"}</strong>
            </div>
            <p>{struggleMap.summary}</p>
          </button>

          {showOpenings && (
            <PatternOpeningRepertoire
              openings={openingRows}
              sort={openingSort}
              setSort={setOpeningSort}
              openTrap={openTrap}
            />
          )}

          <PatternWeakSpotList traps={visibleTraps} activeFilter={activeFilter} openTrap={openTrap} />

          <button className="pc-pattern-drill-card" type="button" onClick={() => startDrill("all", drillPattern?.patternId, drillPattern?.issue)}>
            <span>Drill</span>
            <strong>{filterLabel} mistakes</strong>
            <b>{activeCount} <small>spots</small></b>
          </button>
        </>
      ) : (
        <div className="pc-pattern-empty-state">
          <strong>No pattern yet.</strong>
          <span>Import more games or wait for engine review to finish.</span>
        </div>
      )}
    </section>
  );
}

function MasterStruggleHeatmap({ map, fallbackTrap }: {
  map: StruggleMap;
  fallbackTrap: PatternTrap;
}) {
  const flipped = fallbackTrap.playerColor === "black";
  const topSquares = topStruggleSquares(map, 3);
  const topSquareLabel = topSquares.length ? topSquares.map(square => square.square).join(" · ") : "Clean";
  const squareStyles = map.squares.reduce<Record<string, CSSProperties>>((acc, square) => {
    if (square.intensity > 0) {
      acc[square.square] = { "--pc-struggle-color": struggleGradient(square.intensity) } as CSSProperties;
    }
    return acc;
  }, {});

  return (
    <div className="pc-pattern-board pc-pattern-board-struggle">
      <span className="pc-pattern-eval-chip">{formatLossCp(map.totalLossCp)}</span>
      <DesignBoard
        fen={fallbackTrap.fen}
        size={313}
        showAnalyze={false}
        flipped={flipped}
        squareStyles={squareStyles}
        arrows={[]}
        lastMove={fallbackTrap.lastMove}
      />
      <div className="pc-struggle-compact-meta">
        <span>Top squares</span>
        <strong>{topSquareLabel}</strong>
      </div>
    </div>
  );
}

function PatternOpeningRepertoire({ openings, sort, setSort, openTrap }: {
  openings: PatternOpeningNode[];
  sort: PatternOpeningSort;
  setSort: (sort: PatternOpeningSort) => void;
  openTrap: (key: string) => void;
}) {
  if (!openings.length) return null;
  return (
    <section className="pc-pattern-opening-list pc-pattern-openings-full">
      <header className="pc-pattern-section-head">
        <div>
          <span>Openings played</span>
          <b>{openings.length} lines</b>
        </div>
        <em>games · win · loss</em>
      </header>
      <div className="pc-pattern-sort-row" role="tablist" aria-label="Sort openings">
        {([
          { id: "loss" as const, label: "Loss" },
          { id: "games" as const, label: "Games" },
          { id: "win" as const, label: "Win%" },
          { id: "name" as const, label: "A-Z" },
        ]).map(option => (
          <button key={option.id} type="button" role="tab" aria-selected={sort === option.id} className={sort === option.id ? "active" : ""} onClick={() => setSort(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <div>
        {openings.map((opening, index) => (
          <button
            key={opening.id}
            type="button"
            className={!opening.topTrapKey ? "clean" : ""}
            onClick={() => opening.topTrapKey && openTrap(opening.topTrapKey)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div className="pc-pattern-opening-name">
              <strong>{opening.family}</strong>
              <small>{titleCase(opening.playerColor)} · {opening.lineName}</small>
            </div>
            <em>{opening.gameCount}<small>g</small></em>
            <b>{opening.winRate}<small>%</small></b>
            <u>{opening.avgLossCp !== null ? formatLossCp(opening.avgLossCp) : "0.0"}</u>
          </button>
        ))}
      </div>
    </section>
  );
}

function PatternWeakSpotList({ traps, activeFilter, openTrap }: {
  traps: PatternTrap[];
  activeFilter: PatternViewFilter;
  openTrap: (key: string) => void;
}) {
  if (!traps.length) return null;
  return (
    <section className="pc-pattern-opening-list pc-pattern-weak-list">
      <header className="pc-pattern-section-head">
        <div>
          <span>{activeFilter === "all" ? "Weak spots" : `${phaseLabels[activeFilter]} weak spots`}</span>
          <b>{traps.length} shown</b>
        </div>
        <em>spots · loss</em>
      </header>
      <div>
        {traps.map((trap, index) => (
          <button key={trap.key} type="button" onClick={() => openTrap(trap.key)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div className="pc-pattern-opening-name">
              <strong>{trap.title.replace(/\.$/, "")}</strong>
              <small>{trap.openingFamily} · {phaseLabels[trap.phase]}</small>
            </div>
            <em>{trap.count}</em>
            <b>{trap.evalLabel}</b>
            <i>›</i>
          </button>
        ))}
      </div>
    </section>
  );
}

function PatternHeatmapBoard({ heatmap, fallbackTrap }: { heatmap: PatternHeatmap; fallbackTrap: PatternTrap }) {
  const fen = heatmap.fen || fallbackTrap.fen;
  const flipped = (heatmap.playerColor || fallbackTrap.playerColor) === "black";
  const highlights = heatmap.squares.slice(0, 6).reduce<Record<string, string>>((acc, square) => {
    acc[square.square] = square.role === "cure" ? "idea" : square.role === "reply" ? "you" : "them";
    return acc;
  }, {});

  return (
    <div className="pc-pattern-board pc-pattern-board-heatmap">
      <span className="pc-pattern-eval-chip">{heatmap.evalLabel}</span>
      <DesignBoard
        fen={fen}
        size={313}
        showAnalyze={false}
        flipped={flipped}
        highlights={highlights}
        arrows={[]}
        lastMove={fallbackTrap.lastMove}
      />
      <div className="pc-pattern-heatmap-overlay" aria-hidden="true">
        {heatmap.squares.slice(0, 14).map(square => {
          const point = squareCenterPct(square.square, flipped);
          const size = 9 + square.pct * 20;
          const style = {
            left: `${point.x}%`,
            top: `${point.y}%`,
            width: `${size}px`,
            height: `${size}px`,
            opacity: 0.16 + square.pct * 0.36,
          } as CSSProperties;
          return <i key={`${square.square}-${square.role}`} className={square.role} style={style} />;
        })}
      </div>
    </div>
  );
}

function PatternOpeningIntelligence({ openings, openTrap }: {
  openings: PatternOpeningNode[];
  openTrap: (key: string) => void;
}) {
  if (!openings.length) return null;
  return (
    <section className="pc-pattern-intel-section pc-pattern-opening-intel">
      <header>
        <span>Opening view</span>
        <b>{openings.length} lines</b>
      </header>
      <div>
        {openings.slice(0, 3).map(opening => (
          <button key={opening.id} type="button" onClick={() => openTrap(opening.topTrapKey)}>
            <strong>{opening.family}</strong>
            <em>{titleCase(opening.playerColor)} · {opening.variation}</em>
            <p>{opening.lineName}</p>
            <footer>
              <span>{opening.gameCount} games</span>
              <span>{opening.patternCount} spots</span>
              <b>{opening.avgLossCp !== null ? formatLossCp(opening.avgLossCp) : "pending"}</b>
            </footer>
          </button>
        ))}
      </div>
    </section>
  );
}

function PatternWeaknessClusters({ clusters, openTrap }: {
  clusters: WeaknessCluster[];
  openTrap: (key: string) => void;
}) {
  if (!clusters.length) return null;
  return (
    <section className="pc-pattern-intel-section pc-pattern-clusters">
      <header>
        <span>Weakness clusters</span>
        <b>{clusters.length} active</b>
      </header>
      <div>
        {clusters.slice(0, 4).map(cluster => (
          <button key={cluster.id} type="button" onClick={() => openTrap(cluster.topTrapKey)}>
            <i className={cluster.status} />
            <div>
              <strong>{cluster.title}</strong>
              <p>{cluster.openingFamily} · {phaseLabels[cluster.phase]}</p>
            </div>
            <span>{cluster.count}</span>
            <b>{cluster.avgLossCp !== null ? formatLossCp(cluster.avgLossCp) : "pending"}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function PatternTrainingQueue({ plans, traps, startDrill }: {
  plans: PatternTrainingPlan[];
  traps: PatternTrap[];
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
}) {
  if (!plans.length) return null;
  const trapsByKey = new Map(traps.map(trap => [trap.key, trap]));
  return (
    <section className="pc-pattern-intel-section pc-pattern-training-queue">
      <header>
        <span>Training queue</span>
        <b>{plans.length} sets</b>
      </header>
      <div>
        {plans.slice(0, 3).map(plan => {
          const trap = trapsByKey.get(plan.trapKey);
          return (
            <button key={plan.id} type="button" onClick={() => startDrill("all", trap?.patternId, trap?.issue)}>
              <span>{plan.mode}</span>
              <strong>{plan.title}</strong>
              <p>{plan.successRule}</p>
              <footer><b>{plan.positions} positions</b><em>{plan.durationMin} min</em></footer>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PatternProgressPanel({ progress }: { progress: PatternProgressSnapshot }) {
  return (
    <section className="pc-pattern-progress-panel">
      <header>
        <span>Progress</span>
        <b>{progress.activeClusters} clusters</b>
      </header>
      <p>{progress.headline}</p>
      <div>
        <span><strong>{progress.cleanStreak}</strong><em>clean</em></span>
        <span><strong>{progress.personalBest}</strong><em>best</em></span>
        <span><strong>{progress.last30Firings}</strong><em>firings</em></span>
      </div>
    </section>
  );
}

function PatternTrapDetail({ trap, trapIndex, trapTotal, back, startDrill }: {
  trap: PatternTrap;
  trapIndex: number;
  trapTotal: number;
  back: () => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
}) {
  const examples = trap.reviews.slice(0, 3);

  return (
    <section className="pc-mobile-surface pc-pattern-trap-detail">
      <div className="pc-pattern-detail-top">
        <MobileCircleButton ariaLabel="Back to patterns" onClick={back}>‹</MobileCircleButton>
        <span>TRAP {trapIndex + 1} / {Math.max(1, trapTotal)}</span>
        <MobileCircleButton ariaLabel="Pattern actions" onClick={() => startDrill("all", trap.patternId, trap.issue)}>⋯</MobileCircleButton>
      </div>

      <div className="pc-pattern-detail-title">
        <span>{trap.openingFamily || trap.opening} · as {titleCase(trap.playerColor)}</span>
        <h1>{trap.title}</h1>
      </div>

      <div className="pc-pattern-detail-stats">
        <article>
          <strong>{trap.gameCount}</strong>
          <span>games</span>
        </article>
        <article>
          <strong>{trap.winRate}%</strong>
          <span>win</span>
        </article>
        <article>
          <strong>{trap.evalLabel}</strong>
          <span>avg loss</span>
        </article>
      </div>

      <PatternBoard trap={trap} detail />

      <p className="pc-pattern-insight">{trap.momentCopy}</p>

      <section className="pc-pattern-cue-card">
        <span>The cue</span>
        <p><i>When</i> <b>{trap.cueCopy}</b></p>
        <p><i>{trap.cureAction}</i> <strong>{trap.cureMove}</strong> <em>{trap.cureNote}</em></p>
      </section>

      <section className="pc-pattern-line-card">
        <span>Main line context</span>
        <div className="pc-pattern-line-moves">
          {trap.mainLineMoves.length
            ? trap.mainLineMoves.map((move, index) => <b key={`${move}-${index}`}>{move}</b>)
            : <b>{trap.mainLine || "Imported game line"}</b>}
        </div>
        <p>{trap.openingPlan}</p>
        <em>{trap.engineLine}</em>
      </section>

      <section className="pc-pattern-streak-card">
        <header>
          <span>Avoidance streak</span>
          <strong>{trap.cleanGames}</strong>
        </header>
        <div>
          <span>games clean</span>
          <b>last reset</b>
          <em>{trap.lastReset}</em>
        </div>
        <footer>
          <span>Personal best</span>
          <b>{trap.personalBest}</b>
        </footer>
        <div className="pc-pattern-firings">
          <span>Last 30 games</span>
          <b>{trap.recentFirings} firings</b>
        </div>
        <div className="pc-pattern-spark-rail">
          <span>OLDEST</span>
          <div>
            {trap.recentTimeline.map((fired, index) => <i key={index} className={fired ? "fired" : ""} />)}
          </div>
          <b>NOW</b>
        </div>
      </section>

      <section className="pc-pattern-formation">
        <header>
          <span>How it forms</span>
          <b>{trap.formation.length} plies</b>
        </header>
        <div>
          {trap.formation.map(step => (
            <article key={`${step.ply}-${step.label}`}>
              <DesignBoard fen={step.fen} size={104} showCoords={false} showAnalyze={false} flipped={trap.playerColor === "black"} lastMove={step.lastMove} />
              <span>ply</span>
              <strong>{step.ply}</strong>
              <em>{step.label}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="pc-pattern-before-game">
        <span>Before your next game</span>
        <button type="button">
          <strong>Pre-game brief</strong>
          <em>Show this trigger before each {trap.openingFamily || trap.opening} game</em>
        </button>
        <button type="button" onClick={() => startDrill("all", trap.patternId, trap.issue)}>
          <strong>Drill the cure</strong>
          <em>{Math.min(20, Math.max(1, trap.count))} positions · {Math.max(1, Math.ceil(Math.min(20, Math.max(1, trap.count)) * 0.3))} min</em>
          <small>Trains the prophylactic move, not the rescue.</small>
        </button>
      </section>

      <section className="pc-pattern-recent">
        <header>
          <span>Recent firings</span>
          <b>{Math.min(3, examples.length)} of {trap.recentFirings}</b>
        </header>
        {examples.map((example) => (
          <button key={example.id} type="button">
            <span>{formatRelativeGameDate(example.endTime)}</span>
            <strong>{example.opponent || "Opponent"}</strong>
            <em>ply</em>
            <b>{example.moveNumber}</b>
            <small>{formatAccurateReviewLoss(example)}</small>
            <i>›</i>
          </button>
        ))}
        {!examples.length && <div className="pc-pattern-recent-empty">No recent engine-reviewed firings.</div>}
        {trap.recentFirings > examples.length && <button className="pc-pattern-see-all" type="button">See all {trap.recentFirings} firings →</button>}
      </section>
    </section>
  );
}

function PatternBoard({ trap, detail = false }: { trap: PatternTrap; detail?: boolean }) {
  return (
    <div className={`pc-pattern-board ${detail ? "detail" : ""}`}>
      <span className="pc-pattern-eval-chip">{trap.evalLabel}</span>
      <DesignBoard
        fen={trap.fen}
        size={detail ? 313 : 313}
        showAnalyze={false}
        flipped={trap.playerColor === "black"}
        highlights={trap.highlights}
        arrows={trap.arrows}
        lastMove={trap.lastMove}
      />
    </div>
  );
}

function AnalysisPage({ report, start, setActiveView, back }: {
  report: AnalysisReport;
  start?: ShellAnalysisStart | null;
  setActiveView: (view: AppView) => void;
  back: () => void;
}) {
  const history = useMemo(() => buildAnalysisHistory(start), [start]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(Boolean(start?.flipped));
  const { analyzeMovePair } = useStockfish();
  const [explainer, setExplainer] = useState<MoveExplainerState>({
    open: false,
    loading: false,
    data: null,
    error: "",
    title: "",
  });

  useEffect(() => {
    setIndex(findHistoryIndex(history, start?.fen));
    setFlipped(Boolean(start?.flipped));
  }, [history, start]);

  const entry = history[index] || history[0] || { fen: start?.fen || new Chess().fen() };

  const explainEntry = useCallback(async (target?: AnalysisHistoryEntry) => {
    const move = target || entry;
    const review = reviewForAnalysisEntry(report, move, start?.returnMistakeReviewId);
    const issue = review ? issueForReview(report, review) : null;
    const moveUci = move.uci || review?.uci || (move.lastMove ? `${move.lastMove.from}${move.lastMove.to}` : "");
    const fenBefore = move.fenBefore || review?.fenBefore || entry.fen || start?.fen || new Chess().fen();
    const moveSan = move.san && move.san !== "Start" ? move.san : review?.san || formatUci(moveUci) || "Move";
    setExplainer({ open: true, loading: true, data: null, error: "", title: moveSan });
    try {
      const data = await explainMove(
        { fenBefore, moveSan, moveUci, review, issue },
        moveUci
          ? ({ fenBefore: sourceFen, playedUci }) => analyzeMovePair({
              fenBefore: sourceFen,
              playedUci,
              depth: DEFAULT_ENGINE_DEPTH,
              multipv: DEFAULT_ENGINE_MULTIPV,
            })
          : undefined,
      );
      setExplainer({ open: true, loading: false, data, error: "", title: moveSan });
    } catch (error) {
      setExplainer({
        open: true,
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Move explanation failed.",
        title: moveSan,
      });
    }
  }, [analyzeMovePair, entry, report, start]);

  if (!start) {
    return <div className="pc-analysis-empty">Open Analysis from a game or mistake to inspect the exact position.</div>;
  }

  return (
    <>
      <MobileAnalysisSurface
        history={history}
        index={index}
        setIndex={setIndex}
        entry={entry}
        flipped={flipped}
        setFlipped={setFlipped}
        back={back}
        report={report}
        start={start}
        onExplainMove={explainEntry}
      />
      <MoveExplainerSheet state={explainer} close={() => setExplainer(current => ({ ...current, open: false }))} />
    </>
  );
}

function MobileDashboardSurface({ report, username, openProfile, review, train, openPattern }: {
  report: AnalysisReport;
  username: string;
  openProfile: () => void;
  review: () => void;
  train: () => void;
  openPattern: (patternId: string) => void;
}) {
  const examples = getTrainableReviews(report).slice(0, 3);
  const patterns = buildMobilePatterns(report);
  const stats = buildMobileQualityStats(report);
  const weekly = buildWeeklyTrend(report);
  const focus = patterns[0];
  const total = Math.max(1, stats.reduce((sum, stat) => sum + stat.count, 0));

  return (
    <section className="pc-mobile-surface pc-mobile-home">
      <MobilePageHead
        eyebrow={todayShortLabel()}
        title={<>Hi, <i>{cleanDisplayName(username || report.username)}</i></>}
        right={<MobileCircleButton ariaLabel="Open profile and import" onClick={openProfile}>↗</MobileCircleButton>}
      />
      <section className="pc-mobile-focus-card">
        <svg viewBox="0 0 400 200" aria-hidden="true">
          <ellipse cx="320" cy="50" rx="110" ry="80" />
          <ellipse cx="360" cy="20" rx="50" ry="35" />
        </svg>
        <div className="pc-mobile-focus-top">
          <Pill tone="you">Today's focus</Pill>
          <span><i />{focus ? `${Math.max(1, Math.ceil((focus.count || 1) * 0.7))} MIN` : ""} · {focus?.count || 0} SPOTS</span>
        </div>
        <h2>{focus ? patternHeadline(focus.title) : <>Sync games to reveal your first <i>pattern</i>.</>}</h2>
        <p>{focus ? `${focus.title} · ${focus.count} live examples` : "No trainable mistakes in the current report"}</p>
        <div className="pc-mobile-focus-actions">
          <button type="button" onClick={train} disabled={!focus}>Train · 4 min</button>
          <button type="button" onClick={review}>Review</button>
        </div>
      </section>

      <section className="pc-mobile-quality">
        <MobileSectionHead eyebrow="Move quality" meta="Last 30 days" />
        <div className="pc-mobile-quality-grid">
          {stats.map(stat => <MobileStatTile key={stat.key} stat={stat} />)}
        </div>
        <div className="pc-mobile-severity">
          {stats.map(stat => <i key={stat.key} className={stat.key} style={{ width: `${Math.max(4, (stat.count / total) * 100)}%` }} />)}
        </div>
        <div className="pc-mobile-severity-meta"><span>{total} flagged moves</span><b>{formatSignedPercent(weekly.changePct)} {weekly.compareLabel}</b></div>
      </section>

      <section className="pc-mobile-week">
        <MobileSectionHead eyebrow={weekly.label} meta={`${weekly.total} mistakes`} />
        <div className="pc-mobile-week-card">
          <div className="pc-mobile-week-bars">
            {weekly.days.map((day, i) => <MobileStackedDay key={`${day.day}-${i}`} day={day} max={weekly.max} today={i === weekly.days.length - 1} />)}
          </div>
          <div className="pc-mobile-week-legend">
            <span><i className="blunder" />BLUNDER</span>
            <span><i className="mistake" />MISTAKE</span>
            <span><i className="inacc" />INACC</span>
            <b>{formatSignedPercent(weekly.changePct)} <em>{weekly.compareLabel}</em></b>
          </div>
        </div>
      </section>

      <section className="pc-mobile-patterns">
        <MobileSectionHead eyebrow="Patterns" meta={`${patterns.length} active`} action="See all" onAction={review} />
        <div className="pc-mobile-pattern-list">
          {patterns.map(pattern => (
            <button key={pattern.id} type="button" onClick={() => openPattern(pattern.id)} aria-label={`Open ${pattern.title}`}>
              <i style={{ background: pattern.tone }} />
              <span><b style={{ width: `${Math.max(18, pattern.pct * 100)}%`, background: pattern.tone }} /></span>
              <strong>{pattern.count}</strong>
              <em>›</em>
            </button>
          ))}
        </div>
      </section>

      <section className="pc-mobile-top-examples">
        <MobileSectionHead eyebrow="Top examples" meta={`${examples.length} of ${Math.max(examples.length, focus?.count || 0)}`} action="View all" onAction={review} />
        <div>
          {examples.map((example) => (
            <button key={example.id} type="button" onClick={review}>
              <span>{example.moveNumber}.</span>
              <div><strong>{example.san}</strong><small>vs. {example.opponent || "Opponent"}</small></div>
              <b>{formatReviewLoss(example)}</b>
              <em>›</em>
            </button>
          ))}
          {!examples.length && <button type="button" onClick={review}><span>0.</span><div><strong>No flagged examples yet</strong><small>Sync or import more games</small></div><b>0.0</b><em>›</em></button>}
        </div>
      </section>
    </section>
  );
}

function MobileStatTile({ stat }: { stat: ReturnType<typeof buildMobileQualityStats>[number] }) {
  return (
    <div className={`pc-mobile-stat ${stat.key}`}>
      <div>
        <span><i />{stat.short}</span>
        <b>{formatSignedCount(stat.delta)}</b>
      </div>
      <strong>{stat.count}</strong>{stat.glyph && <em>{stat.glyph}</em>}
      <Sparkline colorKey={stat.key} data={stat.spark} />
    </div>
  );
}

function MobileStackedDay({ day, max, today }: { day: { day: string; b: number; m: number; i: number }; max: number; today?: boolean }) {
  return (
    <div className={today ? "today" : ""}>
      <span>
        {day.b > 0 && <i className="blunder" style={{ height: `${(day.b / max) * 100}%` }} />}
        {day.m > 0 && <i className="mistake" style={{ height: `${(day.m / max) * 100}%` }} />}
        {day.i > 0 && <i className="inacc" style={{ height: `${(day.i / max) * 100}%` }} />}
      </span>
      <b>{day.day}</b>
    </div>
  );
}

function MobileMistakeLabSurface({
  report,
  reviews,
  selectedReview,
  selectedIssue,
  patternFilter,
  setPatternFilter,
  qualityFilter,
  setQualityFilter,
  qualityOptions,
  mode,
  setMode,
  selectReview,
  detailView,
  setDetailView,
  startDrill,
  openAnalysis,
  game,
}: {
  report: AnalysisReport;
  reviews: MoveReview[];
  selectedReview?: MoveReview;
  selectedIssue: MoveIssue | null;
  patternFilter: string;
  setPatternFilter: (id: string) => void;
  qualityFilter: MoveReviewQuality | "all";
  setQualityFilter: (quality: MoveReviewQuality | "all") => void;
  qualityOptions: Array<{ id: MoveReviewQuality | "all"; label: string; count: number }>;
  mode: "list" | "detail";
  setMode: (mode: "list" | "detail") => void;
  selectReview: (reviewId: string) => void;
  detailView: "your" | "them" | "idea";
  setDetailView: (view: "your" | "them" | "idea") => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  game?: GameSummary;
}) {
  const patterns = buildMobilePatterns(report);
  const detailIssue = selectedReview ? selectedIssue || issueForReview(report, selectedReview) : null;

  if (mode === "detail" && selectedReview && detailIssue) {
    return (
      <MobileMistakeDetailSurface
        review={selectedReview}
        issue={detailIssue}
        detailView={detailView}
        setDetailView={setDetailView}
        back={() => setMode("list")}
        startDrill={startDrill}
        openAnalysis={openAnalysis}
        game={game}
      />
    );
  }

  const visibleReviews = orderReviewsForVisualList(reviews);

  return (
    <section className="pc-mobile-surface pc-mobile-lab">
      <MobilePageHead eyebrow={`${reviews.length} spots · ${patterns.length} patterns`} title="Mistake Lab" />
      <div className="pc-mobile-chip-row pc-mobile-chip-scroll">
        {patterns.map((pattern, i) => (
          <button
            key={pattern.id}
            type="button"
            className={(patternFilter === pattern.id || (patternFilter === "all" && i === 0)) ? "active" : ""}
            onClick={() => setPatternFilter(pattern.id)}
          >
            <i style={{ background: pattern.tone }} />{pattern.title}<b>{pattern.count}</b>
          </button>
        ))}
        {!patterns.length && <span className="pc-mobile-chip-empty">No active patterns</span>}
      </div>
      <div className="pc-mobile-chip-row pc-mobile-chip-scroll pc-mobile-quality-filters">
        {qualityOptions.map(option => (
          <button
            key={option.id}
            type="button"
            className={qualityFilter === option.id ? "active" : ""}
            onClick={() => setQualityFilter(option.id)}
          >
            {option.label}<b>{option.count}</b>
          </button>
        ))}
      </div>
      <div className="pc-mobile-lab-list">
        {visibleReviews.map((review) => (
          <button
            key={review.id}
            type="button"
            className={`quality-${qualityClass(review.quality)}`}
            onClick={() => selectReview(review.id)}
            aria-label={`${formatMoveLabel(review)}, ${qualityLabel(review.quality)}, ${formatReviewLoss(review)}`}
          >
            <div className="pc-mobile-lab-move">
              <small>{review.moveNumber}{review.color === "black" ? "..." : "."}</small>
              <strong>{review.san}</strong>
              <b className={`pc-mobile-quality-badge ${mistakeEvalTone(review.quality)}`}>{qualityLabel(review.quality)}</b>
            </div>
            <strong className={`pc-mobile-eval-chip ${mistakeEvalTone(review.quality)}`}>{formatReviewLoss(review)}</strong>
          </button>
        ))}
        {!reviews.length && <div className="pc-mobile-empty-inline">No trainable mistakes match this filter.</div>}
      </div>
    </section>
  );
}

function MobileMistakeDetailSurface({ review, issue, detailView, setDetailView, back, startDrill, openAnalysis, game }: {
  review: MoveReview;
  issue: MoveIssue;
  detailView: "your" | "them" | "idea";
  setDetailView: (view: "your" | "them" | "idea") => void;
  back: () => void;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  game?: GameSummary;
}) {
  const moveSquares = review.uci && /^[a-h][1-8][a-h][1-8]/.test(review.uci) ? { from: review.uci.slice(0, 2), to: review.uci.slice(2, 4) } : null;
  const reply = game ? nextMoveAfterReview(game, review) : null;
  const replySquares = reply?.lastMove || null;
  const bestMove = review.engineBestMove || review.engineLines?.[0]?.bestMove || issue.engineBestMove || "";
  const bestSquares = /^[a-h][1-8][a-h][1-8]/.test(bestMove) ? { from: bestMove.slice(0, 2), to: bestMove.slice(2, 4) } : null;
  const detailFen = detailView === "idea" ? review.fenBefore : detailView === "them" && reply ? reply.fenAfter : review.fenAfter;
  const ideaSan = formatMoveSan(review.fenBefore, bestMove) || "the engine idea";
  const moveLabel = formatMoveLabel(review);
  const sparsePosition = countFenPieces(detailFen) <= 6;
  const highlights = detailView === "idea" && bestSquares
    ? { [bestSquares.from]: "idea", [bestSquares.to]: "idea" }
    : detailView === "them" && replySquares
      ? { [replySquares.from]: "them", [replySquares.to]: "them" }
    : moveSquares
      ? { [moveSquares.from]: detailView === "your" ? "you" : "them", [moveSquares.to]: detailView === "your" ? "you" : "them" }
      : {};
  const arrows: DesignArrow[] = detailView === "idea" && bestSquares
    ? [{ ...bestSquares, kind: "idea" }]
    : detailView === "them" && replySquares
      ? [{ ...replySquares, kind: "them" }]
    : moveSquares
      ? [{ ...moveSquares, kind: detailView === "your" ? "you" : "them" }]
      : [];

  return (
    <section className="pc-mobile-surface pc-mobile-lab-detail">
      <div className="pc-mobile-detail-top">
        <MobileCircleButton ariaLabel="Back" onClick={back}>‹</MobileCircleButton>
        <div className="pc-mobile-detail-title">
          <strong>{moveLabel}</strong>
          <span>{qualityLabel(review.quality)} · {issue.title}</span>
        </div>
        <MobileCircleButton
          ariaLabel="Open in analysis"
          onClick={() => openAnalysis(review.fenAfter, review.color === "black", `${review.moveNumber}. ${review.san}`, { gamePgn: game?.pgn, returnMistakeReviewId: review.id })}
        >
          ↗
        </MobileCircleButton>
      </div>
      <div className="pc-mobile-board-wrap">
        <DesignBoard
          fen={detailFen}
          size={313}
          flipped={review.color === "black"}
          highlights={highlights}
          arrows={arrows}
          lastMove={detailView === "them" && replySquares ? replySquares : detailView !== "idea" ? moveSquares : undefined}
          onAnalyze={() => openAnalysis(review.fenAfter, review.color === "black", `${review.moveNumber}. ${review.san}`, { gamePgn: game?.pgn, returnMistakeReviewId: review.id })}
        />
      </div>
      {sparsePosition && <p className="pc-mobile-position-note">Exact endgame snapshot from your game.</p>}
      <Segmented
        value={detailView}
        options={[
          { id: "your", label: "Your move", tone: "you" },
          { id: "them", label: "Consequence", tone: "them" },
          { id: "idea", label: "Idea", tone: "idea" },
        ]}
        onChange={setDetailView}
      />
      <MoveMap
        compact
        you={review.san}
        them={reply?.san}
        idea={ideaSan}
        insight={visualConsequenceCopy(review, issue)}
      />
      <div className="pc-mobile-detail-actions">
        <button type="button" onClick={() => startDrill(qualityBucket(review.quality), issue.id, issue)}>Train this position</button>
        <button type="button" onClick={() => openAnalysis(review.fenAfter, review.color === "black", `${review.moveNumber}. ${review.san}`, { gamePgn: game?.pgn, returnMistakeReviewId: review.id })}>↗</button>
      </div>
      <section className="pc-mobile-engine-closed">
        <div><span>Engine lines</span><b>{review.engineLines?.length || 3} lines · depth {review.engineDepth || 22}</b></div><em>▾</em>
      </section>
    </section>
  );
}

function MobileDrillSurface({ report, issues, issue, index, setIndex, candidate, setCandidate, bestMove, candidates, mode, setMode, openAnalysis, sortOrder, setSortOrder }: {
  report: AnalysisReport;
  issues: MoveIssue[];
  issue: MoveIssue;
  index: number;
  setIndex: (updater: (current: number) => number) => void;
  candidate: string;
  setCandidate: (candidate: string) => void;
  bestMove: string;
  candidates: string[];
  mode: "picker" | "session";
  setMode: (mode: "picker" | "session") => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  sortOrder: "pressing" | "new" | "accuracy" | "quick";
  setSortOrder: (order: "pressing" | "new" | "accuracy" | "quick") => void;
}) {
  const [sessionPatternId, setSessionPatternId] = useState("all");
  const [drillPhase, setDrillPhase] = useState<DrillPhaseFilter>("all");
  const phaseOptions = useMemo(() => buildDrillPhaseOptions(issues), [issues]);
  const activeIssues = useMemo(() => {
    return drillPhase === "all" ? issues : issues.filter(item => item.phase === drillPhase);
  }, [drillPhase, issues]);
  const sessionIssues = useMemo(() => {
    if (sessionPatternId === "all") return activeIssues;
    const filtered = activeIssues.filter(item => String(item.id) === sessionPatternId || item.title === sessionPatternId);
    return filtered.length ? filtered : activeIssues;
  }, [activeIssues, sessionPatternId]);
  const sessionIndex = Math.min(index, Math.max(0, sessionIssues.length - 1));
  const sessionIssue = sessionIssues[sessionIndex] || issue;
  const sessionBestMove = sessionIssue?.engineBestMove || "";
  const sessionCandidates = buildDrillCandidates(sessionIssue, sessionBestMove);
  const sessionReview = reviewForIssue(report, sessionIssue);
  const sessionGame = sessionReview ? report.gameSummaries.find(game => game.id === sessionReview.gameId) : undefined;
  const openSession = (patternId = "all") => {
    if (!activeIssues.length) return;
    setSessionPatternId(patternId);
    setCandidate("");
    setIndex(() => 0);
    setMode("session");
  };

  useEffect(() => {
    setSessionPatternId("all");
    setCandidate("");
    setIndex(() => 0);
  }, [drillPhase, setCandidate, setIndex]);

  if (mode === "session") {
    return (
      <MobileDrillSession
        issue={sessionIssue}
        issues={sessionIssues}
        index={sessionIndex}
        setIndex={setIndex}
        candidate={candidate}
        setCandidate={setCandidate}
        bestMove={sessionBestMove}
        candidates={sessionCandidates}
        back={() => setMode("picker")}
        openAnalysis={openAnalysis}
        analysisContext={{ gamePgn: sessionGame?.pgn, returnMistakeReviewId: sessionReview?.id }}
      />
    );
  }

  const patterns = sortDrillPatterns(buildDrillPatternCatalog(report, activeIssues), sortOrder);
  const total = patterns.reduce((sum, pattern) => sum + pattern.count, 0);
  const activeTotal = Math.max(total, activeIssues.length);
  const phaseTitle = drillPhase === "all" ? "All" : phaseLabels[drillPhase];
  const phaseCopy = drillPhase === "all" ? "all phases" : `${phaseLabels[drillPhase].toLowerCase()} only`;

  return (
    <section className="pc-mobile-surface pc-mobile-drill-picker">
      <MobilePageHead eyebrow={`${activeTotal} positions · ${patterns.length} sets`} title="Drill" />
      <div className="pc-mobile-chip-row">
        {([
          { id: "pressing" as const, label: "Most pressing" },
          { id: "new" as const, label: "New" },
          { id: "accuracy" as const, label: "Low accuracy" },
          { id: "quick" as const, label: "Quick (<2m)" },
        ]).map(({ id, label }) => (
          <button key={id} className={sortOrder === id ? "active" : ""} onClick={() => setSortOrder(id)}>{label}</button>
        ))}
      </div>
      <div className="pc-mobile-phase-tabs" role="tablist" aria-label="Drill phase">
        {phaseOptions.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={drillPhase === option.id}
            className={drillPhase === option.id ? "active" : ""}
            disabled={option.id !== "all" && option.count === 0}
            onClick={() => setDrillPhase(option.id)}
          >
            <span>{option.label}</span>
            <b>{option.count}</b>
          </button>
        ))}
      </div>
      <button className="pc-mobile-all-patterns" type="button" disabled={!activeIssues.length} onClick={() => openSession("all")}>
        <div>
          <Pill tone="idea">Mixed set</Pill>
          <h2>{phaseTitle} <i>patterns</i></h2>
          <p>{activeTotal} spots · {Math.max(1, Math.ceil(activeTotal / 5))} min</p>
          <span>{activeIssues.length ? `Drill ${phaseCopy}` : `No ${phaseCopy} positions yet`}</span>
        </div>
        <MobileDotMatrix />
      </button>
      <div className="pc-mobile-by-pattern"><span>{drillPhase === "all" ? "By pattern" : `${phaseTitle} sets`}</span><b>{patterns.length} active</b></div>
      <div className="pc-mobile-pattern-cards">
        {patterns.map(pattern => <MobilePatternCard key={pattern.id} pattern={pattern} onClick={() => openSession(pattern.id)} />)}
        {!patterns.length && <div className="pc-mobile-empty-inline">No recurring {phaseCopy} drill patterns in this report.</div>}
      </div>
    </section>
  );
}

function MobileDrillSession({ issue, issues, index, setIndex, candidate, setCandidate, bestMove, candidates, back, openAnalysis, analysisContext }: {
  issue: MoveIssue;
  issues: MoveIssue[];
  index: number;
  setIndex: (updater: (current: number) => number) => void;
  candidate: string;
  setCandidate: (candidate: string) => void;
  bestMove: string;
  candidates: string[];
  back: () => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: AnalysisOpenContext) => void;
  analysisContext?: AnalysisOpenContext;
}) {
  const moveSquares = issue.uci && /^[a-h][1-8][a-h][1-8]/.test(issue.uci) ? { from: issue.uci.slice(0, 2), to: issue.uci.slice(2, 4) } : null;
  const [hintOpen, setHintOpen] = useState(false);
  const [flipped, setFlipped] = useState(issue.color === "black");
  const target = formatMoveSan(issue.fenBefore, bestMove) || issue.san;

  useEffect(() => {
    setFlipped(issue.color === "black");
    setHintOpen(false);
    setCandidate("");
  }, [issue.id, issue.color, setCandidate]);

  return (
    <section className="pc-mobile-surface pc-mobile-drill-session">
      <div className="pc-mobile-session-top">
        <MobileCircleButton ariaLabel="Back to drill sets" onClick={back}>‹</MobileCircleButton>
        <span>{String(index + 1).padStart(2, "0")} / {issues.length || 14}</span>
        <span className="pc-mobile-circle-spacer" aria-hidden="true" />
      </div>
      <div className="pc-mobile-board-wrap">
        <DesignBoard
          fen={issue.fenBefore}
          size={361}
          flipped={flipped}
          lastMove={moveSquares || undefined}
          highlights={candidate && moveSquares ? { [moveSquares.to]: "you" } : hintOpen && bestMove && /^[a-h][1-8][a-h][1-8]/.test(bestMove) ? { [bestMove.slice(0, 2)]: "idea", [bestMove.slice(2, 4)]: "idea" } : {}}
          arrows={hintOpen && bestMove && /^[a-h][1-8][a-h][1-8]/.test(bestMove) ? [{ from: bestMove.slice(0, 2), to: bestMove.slice(2, 4), kind: "idea" }] : []}
          onAnalyze={() => openAnalysis(issue.fenBefore, issue.color === "black", issue.title, analysisContext)}
        />
      </div>
      <div className="pc-mobile-session-meta">
        <div>
          <span>{issue.phase === "opening" ? "Opening" : "Phase"}</span>
          <strong>{issue.phase === "opening" ? issue.opening || "Opening position" : phaseLabels[issue.phase]}</strong>
        </div>
        <div><span>Pattern</span><strong>{issue.title}</strong></div>
      </div>
      <div className="pc-mobile-candidate-strip">
        {candidates.slice(0, 5).map(move => <button key={move} className={candidate === move ? "active" : ""} onClick={() => { setCandidate(move); setHintOpen(false); }}>{move}</button>)}
      </div>
      {hintOpen && <p className="pc-mobile-drill-feedback">Hint: {target}</p>}
      <div className="pc-mobile-session-actions">
        <button type="button" aria-label="First position" onClick={() => setIndex(() => 0)}>⏮</button>
        <button type="button" aria-label="Previous position" onClick={() => setIndex(current => (current - 1 + Math.max(1, issues.length)) % Math.max(1, issues.length))}>◀</button>
        <button type="button" aria-label="Flip board" onClick={() => setFlipped(value => !value)}>⇅</button>
        <button type="button" aria-label="Hint" onClick={() => setHintOpen(value => !value)}>✦</button>
        <button type="button" aria-label="Next position" onClick={() => setIndex(current => (current + 1) % Math.max(1, issues.length))}>▶</button>
        <button type="button" aria-label="Last position" onClick={() => setIndex(() => Math.max(0, issues.length - 1))}>⏭</button>
      </div>
    </section>
  );
}

function MobileAnalysisSurface({ history, index, setIndex, entry, flipped, setFlipped, back, report, start, onExplainMove }: {
  history: ReturnType<typeof buildAnalysisHistory>;
  index: number;
  setIndex: (updater: number | ((current: number) => number)) => void;
  entry: AnalysisHistoryEntry;
  flipped: boolean;
  setFlipped: (updater: boolean | ((current: boolean) => boolean)) => void;
  back: () => void;
  report: AnalysisReport;
  start?: ShellAnalysisStart | null;
  onExplainMove: (entry?: AnalysisHistoryEntry) => void;
}) {
  const moves = useMemo(() => buildMobileAnalysisRows(history, report, start?.returnMistakeReviewId), [history, report, start?.returnMistakeReviewId]);
  const selectedMoveIndex = moves.findIndex(move => move.entryIndex === index);
  const selectedRowIndex = selectedMoveIndex >= 0 ? selectedMoveIndex : 0;
  const [openIdx, setOpenIdx] = useState(selectedRowIndex);
  const [whyOpenKey, setWhyOpenKey] = useState("");
  const [whyBeatIndex, setWhyBeatIndex] = useState(0);
  const [playback, setPlayback] = useState<AnalysisPlaybackState | null>(null);
  const [positionCache, setPositionCache] = useState<Record<string, EngineEvaluation>>({});
  const [pairCache, setPairCache] = useState<Record<string, MoveEngineResult>>({});
  const [engineLoadingKey, setEngineLoadingKey] = useState("");
  const [manualFen, setManualFen] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState("");
  const [manualLastMove, setManualLastMove] = useState<{ from: string; to: string } | null>(null);
  const { ready: engineReady, analyzePosition, analyzeMovePair } = useStockfish();
  useEffect(() => {
    if (selectedMoveIndex >= 0) setOpenIdx(selectedMoveIndex);
  }, [selectedMoveIndex]);
  useEffect(() => {
    setWhyOpenKey("");
    setWhyBeatIndex(0);
    setPlayback(null);
  }, [start?.returnMistakeReviewId]);
  useEffect(() => {
    if (!playback || playback.index >= playback.frames.length - 1) return undefined;
    const timer = window.setTimeout(() => {
      setPlayback(current => current && current.key === playback.key
        ? { ...current, index: Math.min(current.frames.length - 1, current.index + 1) }
        : current);
    }, playback.index === 0 ? 260 : 760);
    return () => window.clearTimeout(timer);
  }, [playback]);
  const current = moves[selectedRowIndex] || moves[openIdx] || moves[0];
  const activeEntry = current?.entry || entry;
  const playbackFrame = playback?.frames[playback.index] || null;
  const baseFen = activeEntry?.fen || entry?.fen || new Chess().fen();
  const fen = playbackFrame?.fen || manualFen || baseFen;
  const positionKey = fen ? comparableFen(fen) : "";
  const livePosition = positionKey ? positionCache[positionKey] : undefined;
  const livePair = current?.key ? pairCache[current.key] : undefined;

  useEffect(() => {
    setManualFen(null);
    setManualLastMove(null);
    setSelectedSquare("");
  }, [baseFen]);

  useEffect(() => {
    if (!engineReady || !fen || positionCache[positionKey]) return undefined;
    const controller = new AbortController();
    setEngineLoadingKey(positionKey);
    analyzePosition({
      fen,
      depth: DEFAULT_ENGINE_DEPTH,
      multipv: DEFAULT_ENGINE_MULTIPV,
      timeoutMs: Math.max(3500, DEFAULT_ENGINE_DEPTH * 500),
      signal: controller.signal,
    }).then(result => {
      setPositionCache(cache => ({ ...cache, [positionKey]: result }));
    }).finally(() => {
      setEngineLoadingKey(current => current === positionKey ? "" : current);
    });
    return () => controller.abort();
  }, [analyzePosition, engineReady, fen, positionCache, positionKey]);

  useEffect(() => {
    if (!engineReady || !current?.uci || !current.entry.fenBefore || pairCache[current.key]) return undefined;
    const controller = new AbortController();
    analyzeMovePair({
      fenBefore: current.entry.fenBefore,
      playedUci: current.uci,
      depth: DEFAULT_ENGINE_DEPTH,
      multipv: DEFAULT_ENGINE_MULTIPV,
      signal: controller.signal,
    }).then(result => {
      setPairCache(cache => ({ ...cache, [current.key]: result }));
    }).catch(() => {
      // The position panel still works from stored analysis when the live engine times out.
    });
    return () => controller.abort();
  }, [analyzeMovePair, current?.entry.fenBefore, current?.key, current?.uci, engineReady, pairCache]);

  const evalScore = normalizedEvalToPawns(livePosition) ?? current?.eval ?? 0;
  const evalDelta = typeof livePair?.evalLossCp === "number" ? -livePair.evalLossCp / 100 : current?.delta ?? 0;
  const moveRange = moves.length ? `${Math.max(1, current?.ply ? current.ply - 1 : 1)}–${Math.min(Math.max(1, current?.ply || 1) + 1, moves.length)} / ${Math.max(history.length - 1, moves.length)}` : "0 / 0";
  const engineLines = buildAnalysisLineOptionsFromPosition(fen, livePosition);
  const displayEngineLines = engineLines.length ? engineLines : current?.engineOptions?.length ? current.engineOptions : [];
  const whyBeats = current ? buildAnalysisWhyBeats(current, displayEngineLines, livePair, moves[selectedRowIndex + 1]) : [];
  const activeWhyBeat = whyOpenKey === current?.key ? whyBeats[Math.min(whyBeatIndex, Math.max(0, whyBeats.length - 1))] : null;
  const playLine = (move: ReturnType<typeof buildMobileAnalysisRows>[number], rawPv = move.pv, sourceFen = move.entry.fenBefore || move.entry.fen) => {
    const frames = buildAnalysisPlaybackFrames(sourceFen, rawPv || [move.uci, move.bestUci].filter(Boolean).join(" "));
    const key = `${move.key}:${rawPv || "line"}`;
    if (playback?.key === key) {
      setPlayback(null);
      setWhyOpenKey("");
      return;
    }
    setPlayback({ key, frames, index: 0 });
    setWhyOpenKey(move.key);
  };
  const toggleWhy = (move: ReturnType<typeof buildMobileAnalysisRows>[number]) => {
    if (whyOpenKey === move.key) {
      setWhyOpenKey("");
      setPlayback(null);
      return;
    }
    setWhyOpenKey(move.key);
    setWhyBeatIndex(0);
    setPlayback(null);
  };
  const legalSquares = useMemo(() => {
    if (!selectedSquare || playbackFrame) return [];
    try {
      const board = new Chess(fen);
      return (board.moves({ square: selectedSquare as never, verbose: true }) as Array<{ to: string }>).map(move => move.to);
    } catch {
      return [];
    }
  }, [fen, playbackFrame, selectedSquare]);
  const handleBoardSquare = useCallback((square: string) => {
    if (playbackFrame) {
      setPlayback(null);
      return;
    }
    try {
      const board = new Chess(fen);
      const piece = board.get(square as never);
      if (!selectedSquare) {
        if (piece && piece.color === board.turn()) setSelectedSquare(square);
        return;
      }
      if (selectedSquare === square) {
        setSelectedSquare("");
        return;
      }
      const move = board.move({ from: selectedSquare, to: square, promotion: "q" });
      if (move) {
        setManualFen(board.fen());
        setManualLastMove({ from: move.from, to: move.to });
        setSelectedSquare("");
        setWhyOpenKey("");
        setPlayback(null);
        return;
      }
      if (piece && piece.color === board.turn()) setSelectedSquare(square);
      else setSelectedSquare("");
    } catch {
      setSelectedSquare("");
    }
  }, [fen, playbackFrame, selectedSquare]);
  const boardHighlights = playbackFrame?.highlights || {
    ...(current?.squares || (activeEntry.lastMove ? { [activeEntry.lastMove.to]: "sel" } : {})),
    ...(selectedSquare ? { [selectedSquare]: "sel" } : {}),
    ...Object.fromEntries(legalSquares.map(square => [square, "idea"])),
  };
  const boardArrows = playbackFrame?.arrows || [];
  const boardLastMove = playbackFrame?.lastMove || manualLastMove || activeEntry.lastMove;
  const liveDepth = livePosition?.depth || livePair?.depth || current?.depth || DEFAULT_ENGINE_DEPTH;
  const activeWhyLines = displayEngineLines.length
    ? displayEngineLines
    : current
      ? [{ move: current.better?.san || "Review", evalLabel: formatSignedEval(evalDelta), pv: current.headline, rawPv: current.pv, sourceFen: fen }] as AnalysisLineOption[]
      : [];

  return (
    <section className="pc-mobile-surface pc-mobile-analysis">
      <div className="pc-mobile-analysis-top">
        <MobileCircleButton ariaLabel="Back" onClick={back}>‹</MobileCircleButton>
        <span>{start?.title || "Analysis"} · #{entry?.moveNumber || current?.ply || 1}</span>
        <span className="pc-mobile-circle-spacer" aria-hidden="true" />
      </div>
      <MobileAnalysisEvalPanel evalScore={evalScore} loading={engineLoadingKey === positionKey} depth={liveDepth} />
      <div className="pc-mobile-analysis-board-row">
        <EvalBar score={evalScore} height={325} />
        <DesignBoard
          fen={fen}
          size={313}
          flipped={flipped}
          lastMove={boardLastMove}
          highlights={boardHighlights}
          arrows={boardArrows}
          spotlight={activeWhyBeat}
          showAnalyze={false}
          selectedSquare={selectedSquare}
          legalSquares={legalSquares}
          onSquareClick={handleBoardSquare}
        />
      </div>
      <div className="pc-mobile-analysis-controls-row">
        <button className="pc-mobile-analysis-flip" onClick={() => setFlipped(value => !value)}>⇄</button>
        <div className="pc-mobile-analysis-controls">
          <button onClick={() => setIndex(0)}>⏮</button>
          <button onClick={() => setIndex(currentIndex => Math.max(0, currentIndex - 1))}>◀</button>
          <button onClick={() => setIndex(currentIndex => Math.min(history.length - 1, currentIndex + 1))}>▶</button>
          <button onClick={() => setIndex(history.length - 1)}>⏭</button>
        </div>
      </div>
      {current && (
        <MobileAnalysisEngineSlot
          activeWhyBeat={null}
          whyBeats={whyBeats}
          whyBeatIndex={whyBeatIndex}
          setWhyBeatIndex={setWhyBeatIndex}
          current={current}
          displayEngineLines={displayEngineLines}
          playbackKey={playback?.key}
          activeFen={fen}
          evalDelta={evalDelta}
          playLine={playLine}
        />
      )}
      <div className="pc-mobile-moves-head">
        <span>Moves</span>
        <b>{moveRange}</b>
      </div>
      <div className="pc-mobile-analysis-moves">
        {moves.map((move) => (
          <MobileAnalysisMove
            key={`${move.entryIndex}-${move.san}`}
            move={move}
            open={move.entryIndex === index}
            whyOpen={whyOpenKey === move.key}
            onToggle={() => {
              const nextIndex = moves.findIndex(item => item.key === move.key);
              setOpenIdx(nextIndex >= 0 ? nextIndex : 0);
              setIndex(move.entryIndex);
            }}
            onWhy={() => {
              setIndex(move.entryIndex);
              toggleWhy(move);
            }}
            whyPanel={whyOpenKey === move.key && current?.key === move.key && whyBeats.length ? (
              <MobileWhyWhisperCard
                beats={whyBeats}
                index={whyBeatIndex}
                setIndex={setWhyBeatIndex}
                move={current}
                bestLine={activeWhyLines[0]}
              />
            ) : null}
          />
        ))}
        {!moves.length && <div className="pc-mobile-empty-inline">No played moves available for this position.</div>}
      </div>
    </section>
  );
}

function MobileAnalysisMove({ move, open, whyOpen, onToggle, onWhy, whyPanel }: {
  move: ReturnType<typeof buildMobileAnalysisRows>[number];
  open: boolean;
  whyOpen: boolean;
  onToggle: () => void;
  onWhy: () => void;
  whyPanel?: ReactNode;
}) {
  return (
    <div className={`${open ? "open" : ""} why-enabled quality-${move.quality} ${whyOpen ? "why-open" : ""}`.trim()}>
      <button type="button" onClick={onToggle}>
        <span>{move.ply}.{move.side === "b" ? ".." : ""}</span>
        <i className={move.side === "w" ? "white" : "black"} />
        <strong>{move.san}<em className={move.quality} /></strong>
        <b>{move.deltaLabel || (move.delta === 0 ? "·" : formatSignedEval(move.delta))}</b>
        <small>{move.label}</small>
      </button>
      <button className="pc-mobile-why-row" type="button" onClick={onWhy}>
        <span>why</span><em>{whyOpen ? "▴" : "▾"}</em>
      </button>
      {whyPanel && <div className="pc-mobile-inline-why">{whyPanel}</div>}
    </div>
  );
}

function MobileAnalysisEvalPanel({ evalScore, loading, depth }: { evalScore: number; loading: boolean; depth: number }) {
  return (
    <div className="pc-mobile-analysis-eval">
      <div>
        <span>Evaluation</span>
        <strong>{formatSignedEval(evalScore)}</strong>
      </div>
      <div className="pc-mobile-engine-status">
        <span>{loading ? "Thinking" : "Engine"}</span>
        <small>SF · d{depth}</small>
      </div>
    </div>
  );
}

function MobileAnalysisEngineSlot({
  activeWhyBeat,
  whyBeats,
  whyBeatIndex,
  setWhyBeatIndex,
  current,
  displayEngineLines,
  playbackKey,
  activeFen,
  evalDelta,
  playLine,
}: {
  activeWhyBeat: AnalysisWhyBeat | null;
  whyBeats: AnalysisWhyBeat[];
  whyBeatIndex: number;
  setWhyBeatIndex: (index: number) => void;
  current: ReturnType<typeof buildMobileAnalysisRows>[number];
  displayEngineLines: AnalysisLineOption[];
  playbackKey?: string;
  activeFen: string;
  evalDelta: number;
  playLine: (move: ReturnType<typeof buildMobileAnalysisRows>[number], rawPv?: string, sourceFen?: string) => void;
}) {
  const lines = displayEngineLines.length
    ? displayEngineLines
    : [{ move: current.better?.san || "Review", evalLabel: formatSignedEval(evalDelta), pv: current.headline, rawPv: current.pv, sourceFen: activeFen }] as AnalysisLineOption[];
  return (
    <section className="pc-mobile-analysis-engine-slot" aria-live="polite">
      {activeWhyBeat ? (
        <MobileWhyWhisperCard
          beats={whyBeats}
          index={whyBeatIndex}
          setIndex={setWhyBeatIndex}
          move={current}
          bestLine={lines[0]}
        />
      ) : (
        <MobileEngineLinesPanel
          lines={lines}
          current={current}
          playbackKey={playbackKey}
          activeFen={activeFen}
          playLine={playLine}
        />
      )}
    </section>
  );
}

function MobileEngineLinesPanel({ lines, current, playbackKey, activeFen, playLine }: {
  lines: AnalysisLineOption[];
  current: ReturnType<typeof buildMobileAnalysisRows>[number];
  playbackKey?: string;
  activeFen: string;
  playLine: (move: ReturnType<typeof buildMobileAnalysisRows>[number], rawPv?: string, sourceFen?: string) => void;
}) {
  return (
    <>
      <div className="pc-mobile-analysis-engine-head"><span>Engine lines</span><b>{Math.min(3, lines.length)} lines</b></div>
      <section className="pc-mobile-analysis-suggestion">
        {lines.slice(0, 3).map((line, lineIndex) => (
          <button
            key={`${line.rawPv}-${lineIndex}`}
            type="button"
            onClick={() => playLine(current, line.rawPv, line.sourceFen || activeFen)}
            className={playbackKey === `${current.key}:${line.rawPv || "line"}` ? "active" : ""}
          >
            <em>{lineIndex + 1}</em>
            <b>{line.evalLabel}</b>
            <strong>{line.move}</strong>
            <small>{lineContinuation(line)}</small>
          </button>
        ))}
      </section>
    </>
  );
}

function MobileWhyWhisperCard({ beats, index, setIndex, move, bestLine }: {
  beats: AnalysisWhyBeat[];
  index: number;
  setIndex: (index: number) => void;
  move: ReturnType<typeof buildMobileAnalysisRows>[number];
  bestLine?: AnalysisLineOption;
}) {
  const beat = beats[Math.min(index, Math.max(0, beats.length - 1))];
  const swipeStartXRef = useRef<number | null>(null);
  const swipeOffsetRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const setSwipe = (value: number) => {
    swipeOffsetRef.current = value;
    setSwipeOffset(value);
  };
  const startSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (beats.length < 2) return;
    swipeStartXRef.current = event.clientX;
    setSwipe(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (swipeStartXRef.current === null) return;
    setSwipe(clampNumber(event.clientX - swipeStartXRef.current, -96, 96));
  };
  const finishSwipe = () => {
    if (swipeStartXRef.current === null) return;
    const distance = swipeOffsetRef.current;
    if (Math.abs(distance) > 42 && beats.length > 1) {
      setIndex(clampNumber(index + (distance < 0 ? 1 : -1), 0, Math.max(0, beats.length - 1)));
    }
    swipeStartXRef.current = null;
    setSwipe(0);
  };
  if (!beat) return null;
  return (
    <section
      className={`pc-mobile-whisper-card ${beat.toneName}`}
      style={{ "--pc-swipe-x": `${swipeOffset * 0.18}px` } as CSSProperties}
      onPointerDown={startSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
      onPointerLeave={finishSwipe}
    >
      <div className="pc-mobile-whisper-main">
        <i />
        <p>{beat.caption}</p>
      </div>
      <footer>
        <span>{beat.tag}</span>
        <b>{move.better?.san || bestLine?.move || "Find the idea"}</b>
      </footer>
      <nav aria-label="Why pages">
        {beats.map((item, itemIndex) => (
          <button
            key={`${item.tag}-${itemIndex}`}
            className={itemIndex === index ? "active" : ""}
            type="button"
            onClick={() => setIndex(itemIndex)}
            aria-label={`Show ${item.tag}`}
          />
        ))}
      </nav>
    </section>
  );
}

function MoveExplainerSheet({ state, close }: { state: MoveExplainerState; close: () => void }) {
  if (!state.open) return null;
  const data = state.data;
  return (
    <div className="pc-explainer-backdrop" role="presentation" onClick={close}>
      <section className="pc-explainer-sheet" role="dialog" aria-modal="true" aria-label="Move explanation" aria-live="polite" onClick={event => event.stopPropagation()}>
        <i className="pc-explainer-handle" />
        <header>
          <div><span>WHY</span><strong>{state.title || data?.title || "Move explanation"}</strong></div>
          <button type="button" onClick={close}>×</button>
        </header>
        {state.loading && (
          <div className="pc-explainer-loading">
            <b>Analysing the position</b>
            <p>Checking opening book first, then comparing engine before/after evaluations.</p>
          </div>
        )}
        {!state.loading && state.error && <div className="pc-explainer-error">{state.error}</div>}
        {!state.loading && data && (
          <>
            <div className="pc-explainer-title">
              <Pill tone={data.source === "opening" ? "idea" : data.source === "engine" ? "neutral" : "you"}>{data.source}</Pill>
              <h2>{data.title}</h2>
              <p>{data.explanation}</p>
            </div>
            <div className="pc-explainer-evals">
              <span><b>Before</b><strong>{data.evalBefore || "..."}</strong></span>
              <span><b>After</b><strong>{data.evalAfter || "..."}</strong></span>
              <span><b>Loss</b><strong>{data.evalLoss || "0.0"}</strong></span>
            </div>
            <ExplainerList title="Key Ideas" items={data.keyIdeas} />
            <ExplainerList title="Plan" items={data.plan} ordered />
            {(data.bestMove || data.nextMoves.length > 0) && (
              <section className="pc-explainer-lines">
                <span>Next moves</span>
                <div>{data.nextMoves.map(item => <b key={item}>{item}</b>)}</div>
                {data.bestMove && <p>Best idea: <strong>{data.bestMove}</strong></p>}
                {data.pv && <p>PV: {data.pv}</p>}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ExplainerList({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <section className="pc-explainer-list">
      <span>{title}</span>
      <ListTag>
        {items.map(item => <li key={item}>{item}</li>)}
      </ListTag>
    </section>
  );
}

function MobilePageHead({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <header className="pc-mobile-head">
      <div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1></div>
      {right}
    </header>
  );
}

function MobileCircleButton({ children, onClick, ariaLabel }: { children: ReactNode; onClick: () => void; ariaLabel?: string }) {
  return <button className="pc-mobile-circle" type="button" aria-label={ariaLabel} onClick={onClick}>{children}</button>;
}

function MobileSectionHead({ eyebrow, meta, action, onAction }: { eyebrow: string; meta?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pc-mobile-section-head">
      <div><span>{eyebrow}</span>{meta && <b>· {meta}</b>}</div>
      {action && onAction && <button type="button" onClick={onAction}>{action} ›</button>}
    </div>
  );
}

function MobileDotMatrix() {
  const tones = ["you", "them", "idea", "miss", "mistake", "neutral", "you", "them", "idea", "miss", "mistake", "neutral"];
  return <div className="pc-mobile-dot-matrix">{tones.map((tone, i) => <i key={i} className={tone} />)}</div>;
}

function MobilePatternCard({ pattern, onClick }: { pattern: ReturnType<typeof buildDrillPatternCatalog>[number]; onClick: () => void }) {
  return (
    <button className="pc-mobile-pattern-card" type="button" onClick={onClick}>
      <div>
        <span className="pc-mobile-pattern-phase"><i style={{ background: pattern.tone }} />{pattern.subPhase || phaseLabels[pattern.phase]}</span>
        <b>{pattern.count} pos</b>
      </div>
      <MiniPatternBoard pattern={pattern} />
      <h3>{pattern.name}</h3>
      <p>{pattern.desc}</p>
      <footer><span>ACC</span><b style={{ width: `${pattern.accuracy}%`, background: pattern.tone }} /><strong>{pattern.accuracy}</strong><em>›</em></footer>
    </button>
  );
}

function MiniPatternBoard({ pattern }: { pattern: ReturnType<typeof buildDrillPatternCatalog>[number] }) {
  return (
    <div className="pc-mini-board">
      {Array.from({ length: 16 }).map((_, index) => {
        const r = Math.floor(index / 4);
        const c = index % 4;
        const mark = pattern.marks.find(item => item[0] === r && item[1] === c);
        const piece = pattern.pieces.find(item => item[0] === r && item[1] === c);
        return <span key={index} className={(r + c) % 2 === 0 ? "light" : "dark"}>{mark && <i style={{ background: mark[2] }} />}{piece && <b>{piece[2]}</b>}</span>;
      })}
      {pattern.arrow && <svg viewBox="0 0 108 108"><line x1={pattern.arrow[0]} y1={pattern.arrow[1]} x2={pattern.arrow[2]} y2={pattern.arrow[3]} /></svg>}
    </div>
  );
}

function buildMobileQualityStats(report: AnalysisReport) {
  const specs = [
    { key: "blunder", short: "BLUNDER", quality: "blunder" as MoveReviewQuality, count: report.moveQuality.blunders, glyph: "" },
    { key: "mistake", short: "MISTAKE", quality: "mistake" as MoveReviewQuality, count: report.moveQuality.mistakes, glyph: "" },
    { key: "inacc", short: "INACC", quality: "inaccuracy" as MoveReviewQuality, count: report.moveQuality.inaccuracies, glyph: "" },
    { key: "miss", short: "MISSED", quality: "miss" as MoveReviewQuality, count: report.moveQuality.misses, glyph: "×" },
  ];
  return specs.map(spec => {
    const trend = qualityTrend(report, spec.quality);
    const count = spec.count || report.moveReviews.filter(review => review.quality === spec.quality).length;
    return { ...spec, count, delta: trend.delta, spark: trend.spark };
  });
}

function buildMobilePatterns(report: AnalysisReport) {
  const summaries = report.summaries.length
    ? report.summaries
    : groupedPatternSummaries(report.issues);
  const trainable = getTrainableReviews(report);
  const visible = summaries.slice(0, 6).map(summary => {
    const reviewCount = trainable.filter(review => review.issueIds.some(id => String(id) === String(summary.id))).length;
    return { ...summary, displayTotal: reviewCount || summary.total };
  });
  const max = Math.max(...visible.map(summary => summary.displayTotal), 1);
  const tones = ["var(--pc-you)", "var(--pc-them)", "var(--pc-idea)", "#7e7bc9", "#d17a3e", "var(--pc-neutral)"];
  return visible.map((summary, i) => ({
    id: String(summary.id),
    title: summary.title,
    count: summary.displayTotal,
    pct: Math.max(0.18, summary.displayTotal / max),
    tone: tones[i % tones.length],
  }));
}

type PatternBuildContext = {
  trainable: MoveReview[];
  gamesById: Map<number, GameSummary>;
  gamesByOpeningKey: Map<string, GameSummary[]>;
  chronological: GameSummary[];
  timelines: Map<number, GameTimelineMove[]>;
};

function buildPatternModel(report: AnalysisReport): PatternModel {
  const context = createPatternBuildContext(report);
  const traps = buildPatternTrapRows(report, context);
  const heatmaps = buildPatternHeatmaps(report, traps, context);
  const clusters = buildWeaknessClusters(traps, heatmaps);
  return {
    traps,
    phaseStats: buildPatternPhaseStats(report, traps),
    heatmaps,
    struggleMaps: buildPatternStruggleMaps(report),
    openings: buildPatternOpeningNodes(report, traps),
    clusters,
    trainingPlans: buildPatternTrainingPlans(clusters, traps),
    progress: buildPatternProgress(clusters, traps),
  };
}

function buildPatternStruggleMaps(report: AnalysisReport): Record<StrugglePhase, StruggleMap> {
  return {
    all: buildStruggleMap(report, "all"),
    opening: buildStruggleMap(report, "opening"),
    middlegame: buildStruggleMap(report, "middlegame"),
    endgame: buildStruggleMap(report, "endgame"),
  };
}

function createPatternBuildContext(report: AnalysisReport): PatternBuildContext {
  const gamesById = new Map(report.gameSummaries.map(game => [game.id, game]));
  const gamesByOpeningKey = new Map<string, GameSummary[]>();
  for (const game of report.gameSummaries) {
    const key = normalizeOpeningKey(game.opening || "Unclassified games");
    gamesByOpeningKey.set(key, [...(gamesByOpeningKey.get(key) || []), game]);
  }
  return {
    trainable: getTrainableReviews(report).filter(review => review.opening || review.issueIds.length),
    gamesById,
    gamesByOpeningKey,
    chronological: chronologicalGames(report),
    timelines: new Map(),
  };
}

function getCachedTimeline(context: PatternBuildContext, game?: GameSummary) {
  if (!game) return [];
  const cached = context.timelines.get(game.id);
  if (cached) return cached;
  const timeline = buildGameTimeline(game, []);
  context.timelines.set(game.id, timeline);
  return timeline;
}

function buildPatternPhaseStats(report: AnalysisReport, traps: PatternTrap[]) {
  const trainable = getTrainableReviews(report);
  return (["opening", "middlegame", "endgame"] as const).map(phase => {
    const fromReviews = trainable.filter(review => review.phase === phase).length;
    const fromTraps = traps.filter(trap => trap.phase === phase).reduce((sum, trap) => sum + trap.count, 0);
    return {
      phase,
      label: phaseLabels[phase],
      count: fromReviews || fromTraps || report.phaseTotals[phase] || 0,
    };
  });
}

function buildPatternFilterOptions(phaseStats: Array<{ phase: Phase; label: string; count: number }>): Array<{ id: PatternViewFilter; label: string; count: number }> {
  const total = phaseStats.reduce((sum, stat) => sum + stat.count, 0);
  return [
    { id: "all", label: "All", count: total },
    ...phaseStats.map(stat => ({
      id: stat.phase,
      label: stat.phase === "middlegame" ? "Middle" : stat.label,
      count: stat.count,
    })),
  ];
}

function buildPatternTrapRows(report: AnalysisReport, context = createPatternBuildContext(report)): PatternTrap[] {
  const trainable = context.trainable;
  if (!trainable.length) return [];

  const groups = new Map<string, MoveReview[]>();
  for (const review of trainable) {
    const patternId = dominantPatternId([review]) || String(review.issueIds[0] || "engineMistake");
    const key = [
      review.phase,
      patternId,
      normalizeOpeningKey(review.opening || "Unclassified games"),
      review.color,
    ].join(":");
    const list = groups.get(key) || [];
    list.push(review);
    groups.set(key, list);
  }

  const rows = [...groups.entries()]
    .map(([key, reviews]) => {
      const orderedReviews = orderPatternReviews(reviews);
      const first = orderedReviews[0];
      const patternId = dominantPatternId(orderedReviews) || String(first.issueIds[0] || "engineMistake");
      const issue = issueForReview(report, first, patternId) || undefined;
      const summary = report.summaries.find(item => String(item.id) === patternId);
      const opening = first.opening || "Unclassified games";
      const openingFamily = openingFamilyName(opening);
      const openingKey = normalizeOpeningKey(opening);
      const impactedGameIds = new Set(orderedReviews.map(review => review.gameId));
      const impactedGames = report.gameSummaries.filter(game => impactedGameIds.has(game.id));
      const matchingGames = (context.gamesByOpeningKey.get(openingKey) || report.gameSummaries.filter(game => normalizeOpeningKey(game.opening || "") === openingKey))
        .filter(game => game.color === first.color);
      const visibleGames = impactedGames.length ? impactedGames : matchingGames;
      const wins = visibleGames.filter(game => game.result === "win").length;
      const winRate = visibleGames.length ? Math.round((wins / visibleGames.length) * 100) : 0;
      const engineLosses = orderedReviews.map(accurateReviewLossCp).filter((loss): loss is number => typeof loss === "number");
      const totalLossCp = engineLosses.length ? engineLosses.reduce((sum, loss) => sum + loss, 0) : null;
      const averageLossCp = engineLosses.length ? totalLossCp! / engineLosses.length : null;
      const bestMove = issue?.engineBestMove || first.engineBestMove || "";
      const hasDifferentBestMove = Boolean(bestMove && !sameUciMove(bestMove, first.uci));
      const cureAction = hasDifferentBestMove ? "Play" : "Review";
      const cureMove = hasDifferentBestMove
        ? formatMoveSan(first.fenBefore, bestMove) || formatUci(bestMove) || "this position in analysis"
        : "this position in analysis";
      const rawTitle = summary?.title || first.title || "Recurring pattern";
      const baseTitle = openingPatternTitle(opening, rawTitle, first.phase);
      const game = context.gamesById.get(first.gameId);
      const timeline = getCachedTimeline(context, game);
      const reply = game ? nextMoveAfterReview(game, first, timeline) : null;
      const playedSquares = squaresForUci(first.uci);
      const replySquares = squaresForUci(reply?.uci);
      const bestSquares = squaresForUci(bestMove);
      const title = patternTrapTitle(baseTitle, reply?.san, replySquares?.to, bestSquares?.to);
      const highlights: Record<string, string> = {};
      if (playedSquares) {
        highlights[playedSquares.from] = "them";
        highlights[playedSquares.to] = "them";
      }
      if (bestSquares) {
        highlights[bestSquares.from] = "idea";
        highlights[bestSquares.to] = "idea";
      }
      if (replySquares) {
        highlights[replySquares.to] = "you";
      }
      const arrows: DesignArrow[] = [];
      if (playedSquares) arrows.push({ ...playedSquares, kind: "them" });
      if (replySquares) arrows.push({ ...replySquares, kind: "you" });
      if (bestSquares) arrows.push({ ...bestSquares, kind: "idea" });
      const streak = patternStreaks(report, orderedReviews, context.chronological);
      const recentTimeline = patternRecentTimeline(report, orderedReviews, context.chronological);
      const recentFirings = recentTimeline.filter(Boolean).length;
      const mainLineMoves = mostCommonOpeningLine(context, orderedReviews);
      const mainLine = formatMoveSequenceSan(mainLineMoves);
      const engineLine = engineLineCopy(first);
      const cueCopy = reply?.san
        ? `${reply.san} appears after ${formatMoveLabel(first)}`
        : mainLine ? `${mainLine} reaches ${formatMoveLabel(first)}` : `${formatMoveLabel(first)} is the recurring choice`;
      const cureNote = bestMove
        ? hasDifferentBestMove ? "- engine-preferred prevention" : "- engine is reviewing this spot"
        : "- open analysis for the exact engine line";
      const weaknessCopy = patternWeaknessCopy(openingFamily, title, orderedReviews, averageLossCp, engineLosses.length);
      const trainingFocus = trainingFocusCopy(rawTitle, cureMove, mainLine, hasDifferentBestMove);
      const openingPlan = openingPlanCopy(openingFamily, rawTitle, mainLine);
      const momentCopy = patternMomentCopy(reply?.san, replySquares?.to, bestMove, first, title);

      return {
        key,
        patternId,
        opening,
        openingFamily,
        playerColor: first.color,
        title,
        phase: first.phase,
        count: orderedReviews.length,
        gameCount: impactedGameIds.size || visibleGames.length,
        gameIds: [...impactedGameIds],
        winRate,
        averageLossCp,
        totalLossCp,
        engineReviewedCount: engineLosses.length,
        cleanGames: streak.cleanGames,
        lastReset: streak.lastReset,
        personalBest: streak.personalBest,
        recentFirings,
        recentTimeline,
        fen: first.fenBefore,
        evalLabel: formatLossCp(averageLossCp),
        cueCopy,
        cureAction,
        cureMove,
        cureNote,
        mainLine,
        mainLineMoves,
        engineLine,
        weaknessCopy,
        trainingFocus,
        openingPlan,
        momentCopy,
        trigger: patternTriggerCopy(title, orderedReviews, engineLosses.length),
        insight: issue?.explanation || first.explanation || "This pattern repeats in the selected phase.",
        highlights,
        arrows,
        lastMove: playedSquares,
        formation: buildPatternFormation(report, first, context), // buildPatternFormation(report, first)
        issue,
        reviews: orderedReviews,
      } satisfies PatternTrap;
    })
    .sort((a, b) =>
      phaseSortWeight(a.phase) - phaseSortWeight(b.phase) ||
      (b.totalLossCp ?? 0) - (a.totalLossCp ?? 0) ||
      b.count - a.count
    );

  return rows;
}

function buildPatternHeatmaps(report: AnalysisReport, traps: PatternTrap[], context: PatternBuildContext): Record<Phase, PatternHeatmap> {
  return (["opening", "middlegame", "endgame"] as const).reduce((acc, phase) => {
    acc[phase] = buildPatternHeatmap(report, phase, traps, context);
    return acc;
  }, {} as Record<Phase, PatternHeatmap>);
}

function buildPatternHeatmap(report: AnalysisReport, phase: Phase, traps: PatternTrap[], context: PatternBuildContext): PatternHeatmap {
  const reviews = context.trainable.filter(review => review.phase === phase);
  const phaseTraps = traps.filter(trap => trap.phase === phase);
  const leadTrap = phaseTraps[0];
  const squareStats = new Map<string, { count: number; lossCp: number; played: number; cure: number; reply: number }>();

  const addSquare = (square: string | undefined, role: "played" | "cure" | "reply", lossCp: number, weight: number) => {
    if (!square || !/^[a-h][1-8]$/.test(square)) return;
    const stat = squareStats.get(square) || { count: 0, lossCp: 0, played: 0, cure: 0, reply: 0 };
    stat.count += 1;
    stat.lossCp += lossCp * weight;
    stat[role] += lossCp * weight;
    squareStats.set(square, stat);
  };

  for (const review of reviews) {
    const loss = heatScoreCp(review);
    const played = squaresForUci(review.uci);
    const best = squaresForUci(review.engineBestMove || review.engineLines?.[0]?.bestMove);
    const game = context.gamesById.get(review.gameId);
    const reply = game ? nextMoveAfterReview(game, review, getCachedTimeline(context, game)) : null;
    const replyMove = squaresForUci(reply?.uci);
    addSquare(played?.to, "played", loss, 1);
    addSquare(played?.from, "played", loss, 0.45);
    if (best && !sameUciMove(review.uci, review.engineBestMove || review.engineLines?.[0]?.bestMove)) {
      addSquare(best.to, "cure", loss, 0.78);
      addSquare(best.from, "cure", loss, 0.32);
    }
    addSquare(replyMove?.to, "reply", loss, 0.58);
  }

  const maxLoss = Math.max(1, ...[...squareStats.values()].map(stat => stat.lossCp));
  const squares = [...squareStats.entries()]
    .map(([square, stat]) => {
      const role = stat.cure > stat.played && stat.cure > stat.reply
        ? "cure"
        : stat.reply > stat.played
          ? "reply"
          : "played";
      return {
        square,
        count: stat.count,
        lossCp: stat.lossCp,
        pct: clampNumber(stat.lossCp / maxLoss, 0.12, 1),
        role,
        label: role === "cure" ? "engine cure square" : role === "reply" ? "reply pressure" : "played-move leak",
      } satisfies PatternHeatSquare;
    })
    .sort((a, b) => b.lossCp - a.lossCp || b.count - a.count)
    .slice(0, 18);

  const engineLosses = reviews.map(accurateReviewLossCp).filter((loss): loss is number => typeof loss === "number");
  const totalLossCp = engineLosses.length ? engineLosses.reduce((sum, loss) => sum + loss, 0) : null;
  const focus = squares[0];
  const dominantOpening = leadTrap?.openingFamily || dominantOpeningForReviews(reviews);
  const playerColor = leadTrap?.playerColor || dominantPlayerColorForReviews(reviews);
  const line = leadTrap?.mainLine || formatMoveSequenceSan(mostCommonOpeningLine(context, reviews));
  const summary = focus
    ? `${reviews.length} positions analyzed. ${focus.label} on ${focus.square} is the biggest ${phaseLabels[phase].toLowerCase()} leak${dominantOpening ? ` in ${dominantOpening}` : ""}.`
    : `${phaseLabels[phase]} positions are clean in the imported report.`;

  return {
    phase,
    playerColor,
    count: reviews.length,
    engineReviewedCount: engineLosses.length,
    totalLossCp,
    evalLabel: formatLossCp(totalLossCp),
    fen: leadTrap?.fen || reviews[0]?.fenBefore || new Chess().fen(),
    squares,
    focus,
    opening: dominantOpening,
    line,
    summary,
  };
}

function buildPatternOpeningNodes(report: AnalysisReport, traps: PatternTrap[]): PatternOpeningNode[] {
  const trapGroups = new Map<string, PatternTrap[]>();
  for (const trap of traps) {
    const family = trap.openingFamily || "Unclassified games";
    const key = [family, trap.playerColor].join(":");
    trapGroups.set(key, [...(trapGroups.get(key) || []), trap]);
  }

  const gameGroups = new Map<string, GameSummary[]>();
  for (const game of report.gameSummaries) {
    const family = openingFamilyName(game.opening);
    const key = [family, game.color].join(":");
    gameGroups.set(key, [...(gameGroups.get(key) || []), game]);
  }

  const allKeys = new Set([...gameGroups.keys(), ...trapGroups.keys()]);
  return [...allKeys]
    .map((key) => {
      const [family, color] = key.split(":");
      const playerColor = color === "black" ? "black" : "white";
      const group = trapGroups.get(key) || [];
      const topTrap = group.length ? topTrapByLoss(group) : null;
      const games = gameGroups.get(key) || [];
      const impactedGameIds = uniqueGameIds(group.flatMap(trap => trap.reviews));
      const impactedGames = report.gameSummaries.filter(game => impactedGameIds.has(game.id));
      const gameCount = games.length || impactedGameIds.size || group.reduce((sum, trap) => sum + trap.gameCount, 0);
      const statGames = games.length ? games : impactedGames;
      const wins = statGames.filter(game => game.result === "win").length;
      const winRate = statGames.length ? Math.round((wins / statGames.length) * 100) : topTrap?.winRate || 0;
      const totalLossCp = group.length ? sumTrapLoss(group) : 0;
      const reviewedCount = group.reduce((sum, trap) => sum + trap.engineReviewedCount, 0);
      const avgLossCp = reviewedCount ? totalLossCp / reviewedCount : null;
      const commonTraps = uniqueStrings(group.map(trap => trap.title)).slice(0, 3);
      const sampleOpening = games.find(game => game.opening)?.opening || topTrap?.opening || family;
      return {
        id: stableSlug(`${family}-${playerColor}`),
        phase: "opening",
        family,
        variation: openingVariationName(family),
        playerColor,
        lineName: topTrap?.mainLine || sampleOpening,
        movePath: topTrap?.mainLineMoves.slice(0, 10) || [],
        gameCount,
        patternCount: group.reduce((sum, trap) => sum + trap.count, 0),
        winRate,
        avgLossCp,
        totalLossCp: reviewedCount ? totalLossCp : null,
        topTrapKey: topTrap?.key || "",
        plans: uniqueStrings(group.map(trap => trap.openingPlan)).slice(0, 2),
        commonTraps,
      } satisfies PatternOpeningNode;
    })
    .sort((a, b) =>
      (b.totalLossCp ?? 0) - (a.totalLossCp ?? 0) ||
      b.patternCount - a.patternCount ||
      b.gameCount - a.gameCount
    );
}

function sortPatternOpenings(openings: PatternOpeningNode[], sort: PatternOpeningSort) {
  return openings.slice().sort((a, b) => {
    if (sort === "games") return b.gameCount - a.gameCount || a.family.localeCompare(b.family);
    if (sort === "win") return a.winRate - b.winRate || b.gameCount - a.gameCount || a.family.localeCompare(b.family);
    if (sort === "name") return a.family.localeCompare(b.family) || a.playerColor.localeCompare(b.playerColor);
    return (b.totalLossCp ?? 0) - (a.totalLossCp ?? 0) ||
      (b.avgLossCp ?? 0) - (a.avgLossCp ?? 0) ||
      b.gameCount - a.gameCount ||
      a.family.localeCompare(b.family);
  });
}

function buildWeaknessClusters(traps: PatternTrap[], heatmaps: Record<Phase, PatternHeatmap>): WeaknessCluster[] {
  return traps.map(trap => {
    const heatmap = heatmaps[trap.phase];
    const focusSquares = heatmap.squares
      .filter(square => square.role === "played" || trap.highlights[square.square])
      .slice(0, 4);
    const status = patternClusterStatus(trap);
    return {
      id: trap.key,
      title: trap.title,
      openingFamily: trap.openingFamily || trap.opening,
      lineName: trap.mainLine || trap.opening || "Imported line",
      motifName: patternTheme(trap.title || trap.insight),
      phase: trap.phase,
      count: trap.count,
      avgLossCp: trap.averageLossCp,
      totalLossCp: trap.totalLossCp,
      winRate: trap.winRate,
      focusSquares,
      topTrapKey: trap.key,
      trainingGoal: trap.trainingFocus,
      status,
    } satisfies WeaknessCluster;
  }).sort((a, b) =>
    (b.totalLossCp ?? 0) - (a.totalLossCp ?? 0) ||
    b.count - a.count
  );
}

function buildPatternTrainingPlans(clusters: WeaknessCluster[], traps: PatternTrap[]): PatternTrainingPlan[] {
  const trapsByKey = new Map(traps.map(trap => [trap.key, trap]));
  return clusters.slice(0, 6).map((cluster, index) => {
    const trap = trapsByKey.get(cluster.topTrapKey);
    const mode = trainingModeForCluster(cluster, trap);
    const positions = Math.min(20, Math.max(1, cluster.count));
    const targetMove = trap?.cureMove || "engine line";
    return {
      id: `${cluster.id}:training`,
      clusterId: cluster.id,
      trapKey: cluster.topTrapKey,
      mode,
      title: trainingModeTitle(mode, cluster),
      description: trap?.trainingFocus || cluster.trainingGoal,
      positions,
      targetMove,
      successRule: trainingSuccessRule(mode, targetMove),
      durationMin: Math.max(2, Math.ceil(positions * 0.35)),
      priority: Math.max(1, 6 - index),
    } satisfies PatternTrainingPlan;
  });
}

function buildPatternProgress(clusters: WeaknessCluster[], traps: PatternTrap[]): PatternProgressSnapshot {
  const improvingClusters = clusters.filter(cluster => cluster.status === "improving").length;
  const worseningClusters = clusters.filter(cluster => cluster.status === "worsening").length;
  const cleanStreak = traps.length ? Math.max(...traps.map(trap => trap.cleanGames)) : 0;
  const personalBest = traps.length ? Math.max(...traps.map(trap => trap.personalBest)) : 0;
  const last30Firings = traps.reduce((sum, trap) => sum + trap.recentFirings, 0);
  const headline = worseningClusters
    ? `${worseningClusters} cluster${worseningClusters === 1 ? "" : "s"} need attention before the next session.`
    : improvingClusters
      ? `${improvingClusters} cluster${improvingClusters === 1 ? "" : "s"} are improving.`
      : clusters.length
        ? "Patterns are active; build a clean streak to prove the fix."
        : "No active pattern clusters yet.";
  return {
    activeClusters: clusters.length,
    improvingClusters,
    worseningClusters,
    cleanStreak,
    personalBest,
    last30Firings,
    headline,
  };
}

function heatScoreCp(review: MoveReview) {
  return accurateReviewLossCp(review) ?? Math.max(45, review.severity * 45);
}

function topTrapByLoss(traps: PatternTrap[]) {
  return traps.slice().sort((a, b) =>
    (b.totalLossCp ?? 0) - (a.totalLossCp ?? 0) ||
    b.count - a.count
  )[0] || traps[0];
}

function sumTrapLoss(traps: PatternTrap[]) {
  return traps.reduce((sum, trap) => sum + (trap.totalLossCp ?? 0), 0);
}

function uniqueGameIds(reviews: MoveReview[]) {
  return new Set(reviews.map(review => review.gameId));
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function openingVariationName(family: string) {
  const [, variation] = family.split(",").map(part => part.trim());
  return variation || "Main line";
}

function patternClusterStatus(trap: PatternTrap): WeaknessCluster["status"] {
  const recent = trap.recentTimeline;
  if (!recent.length) return "active";
  const lastTen = recent.slice(-10);
  const previous = recent.slice(Math.max(0, recent.length - 20), Math.max(0, recent.length - 10));
  const recentFirings = lastTen.filter(Boolean).length;
  const previousFirings = previous.filter(Boolean).length;
  if (trap.cleanGames >= Math.max(3, trap.count) || (lastTen.length && recentFirings === 0)) return "improving";
  if (previous.length && recentFirings > previousFirings) return "worsening";
  return "active";
}

function trainingModeForCluster(cluster: WeaknessCluster, trap?: PatternTrap): PatternTrainingPlan["mode"] {
  const text = `${cluster.title} ${cluster.motifName} ${trap?.cueCopy || ""}`.toLowerCase();
  if (text.includes("reply") || text.includes("forcing") || text.includes("tactic")) return "calculation";
  if (text.includes("outpost") || text.includes("diagonal") || text.includes("file") || text.includes("prevention")) return "prevention";
  if (cluster.phase === "opening") return "repertoire";
  return "recognition";
}

function trainingModeTitle(mode: PatternTrainingPlan["mode"], cluster: WeaknessCluster) {
  if (mode === "calculation") return `Calculate ${cluster.title.replace(/\.$/, "")}`;
  if (mode === "prevention") return `Prevent ${cluster.title.replace(/\.$/, "")}`;
  if (mode === "repertoire") return `Rehearse ${cluster.openingFamily}`;
  return `Recognize ${cluster.title.replace(/\.$/, "")}`;
}

function trainingSuccessRule(mode: PatternTrainingPlan["mode"], targetMove: string) {
  if (mode === "calculation") return `Name the forcing reply, then choose ${targetMove}.`;
  if (mode === "prevention") return `Play ${targetMove} before the threat appears.`;
  if (mode === "repertoire") return "Recall the line, plan, and danger square without prompting.";
  return "Identify the cue before choosing a candidate move.";
}

function patternWindowLabel(report: AnalysisReport) {
  const times = report.gameSummaries
    .map(game => game.endTime)
    .filter((time): time is number => typeof time === "number" && time > 0);
  if (times.length >= 2) {
    const days = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86400) + 1);
    const displayDays = days >= 75 && days <= 105
      ? Math.round(days / 30) * 30
      : days >= 45
        ? Math.round(days / 7) * 7
        : days;
    return `${displayDays} ${displayDays === 1 ? "day" : "days"}`;
  }
  return `${report.games} ${report.games === 1 ? "game" : "games"}`;
}

function dominantPatternId(reviews: MoveReview[]) {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    for (const id of review.issueIds) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function orderPatternReviews(reviews: MoveReview[]) {
  return reviews.slice().sort((a, b) => {
    const timeDelta = (b.endTime ?? b.gameId) - (a.endTime ?? a.gameId);
    if (timeDelta !== 0) return timeDelta;
    const lossDelta = (accurateReviewLossCp(b) ?? -1) - (accurateReviewLossCp(a) ?? -1);
    if (lossDelta !== 0) return lossDelta;
    return b.severity - a.severity;
  });
}

function accurateReviewLossCp(review: MoveReview) {
  if (typeof review.engineEvalLoss === "number") return Math.max(0, review.engineEvalLoss);
  if (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number") {
    const playerSign = review.color === "white" ? 1 : -1;
    return Math.max(0, (review.engineEvalBefore - review.engineEvalAfter) * playerSign);
  }
  return null;
}

function formatLossCp(loss: number | null) {
  if (loss === null) return "pending";
  if (!loss || loss <= 0) return "0.0";
  if (isMateLikeCp(loss)) return "-M";
  if (loss >= 3000) return "-30+";
  const pawns = Math.max(0.1, loss / 100);
  return `-${pawns.toFixed(loss >= 1000 ? 0 : 1)}`;
}

function formatAccurateReviewLoss(review: MoveReview) {
  return formatLossCp(accurateReviewLossCp(review));
}

function patternLossPct(trap: PatternTrap, traps: PatternTrap[]) {
  const maxLoss = Math.max(1, ...traps.map(item => item.totalLossCp ?? 0));
  return clampNumber(((trap.totalLossCp ?? 0) / maxLoss) * 100, 8, 100);
}

function patternStreaks(report: AnalysisReport, reviews: MoveReview[], chronological = chronologicalGames(report)) {
  const firingGameIds = new Set(reviews.map(review => review.gameId));
  const games = chronological.filter(game => game.id);
  let current = 0;
  let personalBest = 0;
  let lastReset = "";

  for (const game of games) {
    if (firingGameIds.has(game.id)) {
      personalBest = Math.max(personalBest, current);
      current = 0;
      lastReset = formatGameDate(game.endTime);
    } else {
      current += 1;
    }
  }

  personalBest = Math.max(personalBest, current);
  return {
    cleanGames: current,
    personalBest,
    lastReset: lastReset || "Never",
  };
}

function patternRecentTimeline(report: AnalysisReport, reviews: MoveReview[], chronological = chronologicalGames(report)) {
  const firingGameIds = new Set(reviews.map(review => review.gameId));
  const recentGames = chronological.slice(-30);
  return recentGames.length
    ? recentGames.map(game => firingGameIds.has(game.id))
    : reviews.slice(-30).map(() => true);
}

const chronologicalGamesCache = new WeakMap<AnalysisReport, GameSummary[]>();

function chronologicalGames(report: AnalysisReport) {
  const cached = chronologicalGamesCache.get(report);
  if (cached) return cached;
  const ordered = report.gameSummaries.slice().sort((a, b) =>
    (a.endTime ?? a.id) - (b.endTime ?? b.id)
  );
  chronologicalGamesCache.set(report, ordered);
  return ordered;
}

function buildPatternFormation(report: AnalysisReport, review: MoveReview, context?: PatternBuildContext): PatternFormationStep[] {
  const game = context?.gamesById.get(review.gameId) || report.gameSummaries.find(item => item.id === review.gameId);
  const fallback: PatternFormationStep = {
    ply: String(review.moveNumber),
    label: review.san || "Position",
    fen: review.fenBefore,
    lastMove: null,
  };
  if (!game?.pgn) return [fallback];

  const timeline = context ? getCachedTimeline(context, game) : buildGameTimeline(game, []);
  const playedIndex = timeline.findIndex(move =>
    comparableFen(move.fenBefore) === comparableFen(review.fenBefore) &&
    move.uci === review.uci
  );
  if (playedIndex < 0) return [fallback];

  return timeline
    .slice(Math.max(0, playedIndex - 3), playedIndex + 1)
    .map(move => ({
      ply: String(move.ply),
      label: move.san || formatUci(move.uci) || "Move",
      fen: move.fenAfter,
      lastMove: move.lastMove,
    }));
}

function patternTriggerCopy(title: string, reviews: MoveReview[], engineReviewedCount: number) {
  const cleaned = title.replace(/\.$/, "").trim() || "This pattern";
  const spots = `${reviews.length} ${reviews.length === 1 ? "spot" : "spots"}`;
  const engine = engineReviewedCount === reviews.length
    ? "engine-reviewed"
    : `${engineReviewedCount}/${reviews.length} engine-reviewed`;
  return `${cleaned} appears in ${spots} from this report (${engine}).`;
}

function patternTitleForReview(report: AnalysisReport, review: MoveReview) {
  const id = review.issueIds[0];
  return report.summaries.find(summary => String(summary.id) === String(id))?.title || review.title;
}

function normalizeOpeningKey(value: string) {
  const base = value
    .replace(/^[A-E][0-9]{2}\s+/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stableSlug(base || "imported-games");
}

function stableSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function openingFamilyName(opening?: string) {
  const cleaned = (opening || "Unclassified games")
    .replace(/^[A-E][0-9]{2}\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "Unclassified games") return "Unclassified games";
  const known: Array<[RegExp, string]> = [
    [/caro[-\s]?kann/i, "Caro-Kann"],
    [/italian/i, "Italian"],
    [/sicilian/i, "Sicilian"],
    [/french/i, "French"],
    [/queen'?s gambit/i, "Queen's Gambit"],
    [/slav/i, "Slav"],
    [/ruy lopez|spanish/i, "Ruy Lopez"],
    [/king'?s indian/i, "King's Indian"],
    [/english/i, "English"],
    [/reti|réti/i, "Reti"],
    [/king'?s gambit/i, "King's Gambit"],
    [/modern/i, "Modern"],
  ];
  const base = known.find(([pattern]) => pattern.test(cleaned))?.[1] || cleaned.split(/[:,-]/)[0].replace(/\bDefense\b|\bGame\b|\bOpening\b/gi, "").trim();
  const variations: Array<[RegExp, string]> = [
    [/two knights/i, "Two Knights"],
    [/najdorf/i, "Najdorf"],
    [/advance/i, "Advance"],
    [/fried liver/i, "Fried Liver"],
    [/giuoco piano/i, "Giuoco Piano"],
    [/open sicilian/i, "Open"],
    [/berlin/i, "Berlin"],
    [/slav/i, base === "Slav" ? "" : "Slav"],
  ];
  const variation = variations.find(([pattern]) => pattern.test(cleaned))?.[1];
  return [base || cleaned, variation].filter(Boolean).join(", ");
}

function openingPatternTitle(opening: string, rawTitle: string, phase: Phase) {
  const family = openingFamilyName(opening);
  const theme = patternTheme(rawTitle);
  if (phase === "opening" && family !== "Unclassified games") return theme;
  return theme;
}

function patternTrapTitle(baseTitle: string, replySan?: string, replyTo?: string, bestTo?: string) {
  const target = replyTo || bestTo || "";
  if (target) {
    const piece = replySan ? sanPieceName(replySan) : "";
    const central = /^(c|d|e|f)(4|5)$/.test(target);
    if (piece === "knight" && central) return `The ${target} outpost.`;
    if (piece === "queen") return `The ${target} queen entry.`;
    if (piece === "bishop") return `The ${target} diagonal.`;
    if (piece === "rook") return `The ${target} file.`;
    return `The ${target} reply.`;
  }
  return `${patternDetailTitle(baseTitle)}.`;
}

function patternTheme(rawTitle: string) {
  const lower = rawTitle.toLowerCase();
  if (lower.includes("opponent replies") || lower.includes("reply") || lower.includes("blindspot")) return "Reply tactic missed";
  if (lower.includes("forcing")) return "Missed forcing line";
  if (lower.includes("loose")) return "Loose-piece tactic";
  if (lower.includes("tempo")) return "Development tempo";
  if (lower.includes("queen")) return "Queen tempo";
  if (lower.includes("castle") || lower.includes("center")) return "King safety timing";
  if (lower.includes("shelter") || lower.includes("king")) return "King shelter";
  if (lower.includes("endgame")) return "Endgame king route";
  if (lower.includes("simpl")) return "Conversion choice";
  if (lower.includes("engine")) return "Engine swing";
  return patternDetailTitle(rawTitle);
}

function dominantOpeningForReviews(reviews: MoveReview[]) {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    const family = openingFamilyName(review.opening);
    if (family === "Unclassified games") continue;
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function dominantPlayerColorForReviews(reviews: MoveReview[]): "white" | "black" {
  const black = reviews.filter(review => review.color === "black").length;
  return black > reviews.length - black ? "black" : "white";
}

function mostCommonOpeningLine(context: PatternBuildContext, reviews: MoveReview[]) {
  const lines = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const review of reviews.slice(0, 48)) {
    const game = context.gamesById.get(review.gameId);
    const timeline = getCachedTimeline(context, game);
    const line = openingLineForReview(timeline, review);
    if (!line.length) continue;
    const key = line.join(" ");
    lines.set(key, line);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
  return best ? lines.get(best) || [] : [];
}

function openingLineForReview(timeline: GameTimelineMove[], review: MoveReview) {
  if (!timeline.length) return [];
  const playedIndex = timeline.findIndex(move =>
    comparableFen(move.fenBefore) === comparableFen(review.fenBefore) &&
    move.uci === review.uci
  );
  const end = playedIndex >= 0 ? playedIndex + 1 : Math.min(timeline.length, 10);
  return timeline.slice(0, Math.min(end, 10)).map(move => move.san).filter(Boolean);
}

function formatMoveSequenceSan(moves: string[]) {
  if (!moves.length) return "";
  const parts: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNumber = Math.floor(i / 2) + 1;
    const white = moves[i];
    const black = moves[i + 1];
    parts.push(`${moveNumber}. ${[white, black].filter(Boolean).join(" ")}`);
  }
  return parts.join(" ");
}

function engineLineCopy(review: MoveReview) {
  const line = review.engineLines?.[0];
  const source = line?.pv || review.engineBestMove || "";
  if (!source) return "Engine line pending";
  const san = formatPvSan(review.fenBefore, source, 5);
  const depth = line?.depth || review.engineDepth;
  return `Engine line ${san}${depth ? ` · d${depth}` : ""}`;
}

function patternWeaknessCopy(opening: string, title: string, reviews: MoveReview[], averageLossCp: number | null, engineReviewedCount: number) {
  const loss = averageLossCp === null ? "pending engine loss" : `${formatLossCp(averageLossCp)} average loss`;
  const coverage = engineReviewedCount ? `${engineReviewedCount}/${reviews.length} engine-reviewed` : "engine review pending";
  return `${opening} is where this cluster hurts most: ${title.toLowerCase()} across ${reviews.length} positions, ${loss}, ${coverage}.`;
}

function patternMomentCopy(replySan: string | undefined, replyTo: string | undefined, bestMove: string, review: MoveReview, title: string) {
  if (replySan) {
    const piece = sanPieceName(replySan);
    const target = replyTo || sanDestination(replySan);
    const verb = piece === "knight" ? "jump" : piece === "bishop" || piece === "rook" || piece === "queen" ? "reach" : piece === "king" ? "step" : "move";
    return `The moment of choice. Their ${piece} will ${verb}${target ? ` to ${target}` : ""} next.`;
  }
  if (bestMove) {
    const move = formatMoveSan(review.fenBefore, bestMove) || formatUci(bestMove) || "the engine move";
    return `The moment of choice. ${move} is the engine line to know before ${formatMoveLabel(review)}.`;
  }
  return `The moment of choice. ${patternDetailTitle(title)} keeps recurring here.`;
}

function sanPieceName(san: string) {
  if (/^O-O/.test(san)) return "king";
  const piece = san.replace(/[+#?!]+/g, "").match(/^[KQRBN]/)?.[0];
  if (piece === "N") return "knight";
  if (piece === "B") return "bishop";
  if (piece === "R") return "rook";
  if (piece === "Q") return "queen";
  if (piece === "K") return "king";
  return "pawn";
}

function sanDestination(san: string) {
  return san.replace(/[+#?!]+/g, "").match(/[a-h][1-8](?:=[QRBN])?$/)?.[0]?.slice(0, 2) || "";
}

function trainingFocusCopy(rawTitle: string, cureMove: string, mainLine: string, hasDifferentBestMove: boolean) {
  const theme = patternTheme(rawTitle).toLowerCase();
  const move = hasDifferentBestMove ? cureMove : "the engine line";
  const line = mainLine ? ` from ${mainLine}` : "";
  return `Train ${move}${line}; stop when the ${theme} cue appears before you move.`;
}

function openingPlanCopy(opening: string, rawTitle: string, mainLine: string) {
  const theme = patternTheme(rawTitle).toLowerCase();
  if (opening.includes("Caro-Kann")) return `Caro-Kann plans revolve around d4/e5 tension; this line needs the ${theme} solved before memorizing more branches.`;
  if (opening.includes("Italian")) return `Italian positions turn on c3-d4 timing and f7 tactics; this line asks for the ${theme} before the attack starts.`;
  if (opening.includes("Sicilian")) return `Sicilian structures punish loose move orders; lock the ${theme} into the main line before expanding the repertoire.`;
  if (opening.includes("French")) return `French Advance games are about e5/d4 tension and breaks; train the ${theme} at the branch point.`;
  return `${opening} reaches ${mainLine || "this recurring structure"}; train the ${theme} where it first appears.`;
}

function patternDetailTitle(title: string) {
  return title.replace(/\.$/, "").trim() || "Pattern detail";
}

function buildDrillPatternCatalog(report: AnalysisReport, issues: MoveIssue[]) {
  const summaries = groupedPatternSummaries(issues).map(summary => {
    const globalSummary = report.summaries.find(item => String(item.id) === String(summary.id) || item.title === summary.title);
    return {
      ...summary,
      title: globalSummary?.title || summary.title,
      advice: globalSummary?.advice || summary.advice,
      severity: Math.max(summary.severity, globalSummary?.severity || 0),
    };
  });
  const tones = ["var(--pc-you)", "var(--pc-them)", "var(--pc-idea)", "#7e7bc9", "#d17a3e", "var(--pc-neutral)"];
  return summaries.slice(0, 8).map((summary, i) => {
    const examples = "examples" in summary ? summary.examples : [];
    const matchingIssues = issues.filter(issue => String(issue.id) === String(summary.id) || issue.title === summary.title);
    const matchingReviews = matchingIssues.length
      ? report.moveReviews.filter(review => matchingIssues.some(issue => issueMatchesReview(issue, review)))
      : report.moveReviews.filter(review => review.issueIds.some(id => String(id) === String(summary.id)) || review.title === summary.title);
    const example = examples?.[0] || matchingIssues[0];
    const tone = tones[i % tones.length];
    const mini = miniPatternFor(summary.title, tone);
    const phase = dominantDrillPhase(matchingIssues, matchingReviews);
    return {
      id: String(summary.id),
      name: summary.title,
      desc: summary.advice || example?.explanation || "Drill this recurring pattern from your games.",
      count: summary.total || matchingIssues.length || matchingReviews.length,
      accuracy: patternAccuracy(matchingReviews, summary.severity),
      phase,
      subPhase: drillSubPhaseLabel(String(summary.id), summary.title, matchingIssues, matchingReviews, phase),
      tone,
      ...mini,
    };
  });
}

function sortDrillPatterns<T extends { count: number; accuracy: number; phase: Phase; name: string }>(patterns: T[], order: "pressing" | "new" | "accuracy" | "quick") {
  return patterns.slice().sort((a, b) => {
    if (order === "accuracy") return a.accuracy - b.accuracy || b.count - a.count;
    if (order === "quick") return a.count - b.count || a.accuracy - b.accuracy;
    if (order === "new") return phaseSortWeight(a.phase) - phaseSortWeight(b.phase) || a.name.localeCompare(b.name);
    return b.count - a.count || a.accuracy - b.accuracy;
  });
}

function buildDrillPhaseOptions(issues: MoveIssue[]): Array<{ id: DrillPhaseFilter; label: string; count: number }> {
  const phases: Array<{ id: DrillPhaseFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "opening", label: "Opening" },
    { id: "middlegame", label: "Middle" },
    { id: "endgame", label: "Endgame" },
  ];
  return phases.map(option => ({
    ...option,
    count: option.id === "all" ? issues.length : issues.filter(issue => issue.phase === option.id).length,
  }));
}

function issueMatchesReview(issue: MoveIssue, review: MoveReview) {
  return comparableFen(issue.fenBefore) === comparableFen(review.fenBefore) &&
    (issue.uci === review.uci || issue.san === review.san);
}

function dominantDrillPhase(issues: MoveIssue[], reviews: MoveReview[]): Phase {
  const counts = new Map<Phase, number>();
  for (const item of [...issues, ...reviews]) {
    counts.set(item.phase, (counts.get(item.phase) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || phaseSortWeight(a[0]) - phaseSortWeight(b[0]))[0]?.[0] || "middlegame";
}

function drillSubPhaseLabel(id: string, title: string, issues: MoveIssue[], reviews: MoveReview[], phase: Phase) {
  if (phase !== "endgame") return "";
  const lower = `${id} ${title}`.toLowerCase();
  if (lower.includes("king")) return "King activity";
  if (lower.includes("conversion") || lower.includes("convert")) return "Conversion";
  if (lower.includes("mate")) return "Checkmate";
  const fens = [...issues.map(item => item.fenBefore), ...reviews.map(item => item.fenBefore)].filter(Boolean);
  if (fens.some(isPawnOnlyEndgame)) return "Pawn endgame";
  if (fens.some(isRookEndgame)) return "Rook endgame";
  return "Endgame";
}

function isPawnOnlyEndgame(fen: string) {
  const board = fen.split(" ")[0] || "";
  return !/[qrbnQRBN]/.test(board) && /[pP]/.test(board);
}

function isRookEndgame(fen: string) {
  const board = fen.split(" ")[0] || "";
  return /[rR]/.test(board) && !/[qQ]/.test(board) && (board.match(/[bnBN]/g) || []).length <= 1;
}

function buildDrillCandidates(issue: MoveIssue | undefined, bestMove: string) {
  if (!issue) return [];
  const fen = issue.fenBefore;
  if (!fen) return [issue.san].filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  const add = (move: string) => {
    if (!move || seen.has(move)) return;
    seen.add(move);
    result.push(move);
  };

  add(formatMoveSan(fen, bestMove) || bestMove);
  add(issue.san);

  try {
    const board = new Chess(fen);
    const legalSanMoves = board.moves({ verbose: true }).map(m => m.san);
    for (const m of legalSanMoves) {
      if (result.length >= 6) break;
      add(m);
    }
  } catch {
    // fall back to displayed moves only
  }

  return result;
}

function buildQualityFilterOptions(reviews: MoveReview[]): Array<{ id: MoveReviewQuality | "all"; label: string; count: number }> {
  const qualities: Array<{ id: MoveReviewQuality | "all"; label: string }> = [
    { id: "all", label: "All" },
    { id: "blunder", label: "Blunders" },
    { id: "mistake", label: "Mistakes" },
    { id: "miss", label: "Misses" },
    { id: "inaccuracy", label: "Inaccuracies" },
  ];
  return qualities.map(option => ({
    ...option,
    count: option.id === "all" ? reviews.length : reviews.filter(review => review.quality === option.id).length,
  })).filter(option => option.id === "all" || option.count > 0);
}

function buildMobileAnalysisRows(history: AnalysisHistoryEntry[], report: AnalysisReport, preferredReviewId?: string) {
  const preferredReview = preferredReviewId ? report.moveReviews.find(review => review.id === preferredReviewId) : undefined;
  const entries = history.length > 1
    ? history.slice(1)
    : preferredReview
      ? [entryFromReview(preferredReview)]
      : [];

  return entries.map((entry, i) => {
    const review = reviewForAnalysisEntry(report, entry, preferredReviewId);
    const issue = review ? issueForReview(report, review) : null;
    const quality = review ? qualityClass(review.quality) : "good";
    const uci = review?.uci || entry.uci || "";
    const evalAfter = normalizeReviewEvalToPawns(review);
    const delta = review ? -reviewLossCp(review) / 100 : 0;
    const best = review?.engineBestMove || review?.engineLines?.[0]?.bestMove || issue?.engineBestMove || "";
    const pv = review?.engineLines?.[0]?.pv || [uci, best].filter(Boolean).join(" ");
    const entryIndex = Math.max(0, history.indexOf(entry));
    return {
      key: `${entryIndex}-${entry.san || review?.san || i}`,
      entry,
      entryIndex: entryIndex >= 0 ? entryIndex : i + 1,
      ply: entry.moveNumber || review?.moveNumber || i + 1,
      side: entry.side || (review?.color === "black" ? "b" : "w"),
      san: entry.san || review?.san || "Move",
      uci,
      bestUci: best,
      eval: evalAfter,
      delta,
      deltaLabel: review ? formatReviewLoss(review) : "",
      quality,
      label: review ? qualityShortLabel(review.quality) : "OK",
      headline: issue?.title || review?.title || "No issue flagged",
      body: review ? visualConsequenceCopy(review, issue) : "This move was not flagged as a mistake in the imported report.",
      tags: review ? [phaseLabels[review.phase], review.opening, qualityLabel(review.quality)].filter(Boolean) as string[] : ["Clean"],
      better: best ? { san: formatMoveSan(entry.fenBefore || review?.fenBefore || entry.fen, best), note: "engine preference" } : null,
      pv,
      depth: review?.engineDepth || review?.engineLines?.[0]?.depth,
      engineOptions: buildAnalysisLineOptions(entry.fenBefore || review?.fenBefore || entry.fen, review, issue),
      squares: squaresFromUci(uci, review && isTrainableQuality(review.quality) ? "them" : "sel"),
    };
  });
}

function buildAnalysisLineOptions(fen: string, review?: MoveReview, issue?: MoveIssue | null): AnalysisLineOption[] {
  const lines = (review?.engineLines || [])
    .slice()
    .sort((a, b) => a.multipv - b.multipv)
    .slice(0, 4)
    .map(line => ({
      move: formatMoveSan(fen, line.bestMove) || formatUci(line.bestMove) || "Move",
      evalLabel: formatCp(line.evalCp, line.mate),
      pv: formatPvSan(fen, line.pv, 6),
      rawPv: line.pv || line.bestMove,
      sourceFen: fen,
    }));
  if (lines.length) return lines;
  const fallback = review?.engineBestMove || issue?.engineBestMove || "";
  if (!fallback) return [];
  return [{
    move: formatMoveSan(fen, fallback) || formatUci(fallback) || "Move",
    evalLabel: typeof review?.engineEvalBefore === "number" ? formatCp(review.engineEvalBefore) : "...",
    pv: formatPvSan(fen, fallback, 1),
    rawPv: fallback,
    sourceFen: fen,
  }];
}

function buildAnalysisLineOptionsFromPosition(fen: string, evaluation?: EngineEvaluation): AnalysisLineOption[] {
  if (!evaluation) return [];
  const sourceLines = evaluation.lines?.length
    ? evaluation.lines
    : evaluation.bestMove
      ? [{ multipv: 1, bestMove: evaluation.bestMove, evalCp: evaluation.evalCp, mate: evaluation.mate, pv: evaluation.pv || evaluation.bestMove, depth: evaluation.depth }]
      : [];
  return sourceLines.slice(0, 4).map(line => ({
    move: formatMoveSan(fen, line.bestMove) || formatUci(line.bestMove) || "Move",
    evalLabel: formatCp(line.evalCp, line.mate),
    pv: formatPvSan(fen, line.pv || line.bestMove, 6),
    rawPv: line.pv || line.bestMove,
    sourceFen: fen,
  }));
}

function normalizedEvalToPawns(evaluation?: EngineEvaluation) {
  if (!evaluation) return null;
  if (typeof evaluation.mate === "number") return evaluation.mate > 0 ? 4 : -4;
  return typeof evaluation.evalCp === "number" ? cpToDisplayPawns(evaluation.evalCp) : null;
}

function normalizeReviewEvalToPawns(review?: MoveReview) {
  if (!review || typeof review.engineEvalAfter !== "number") return 0;
  return cpToDisplayPawns(review.engineEvalAfter);
}

function cpToDisplayPawns(cp: number) {
  if (Math.abs(cp) >= MATE_CP_THRESHOLD) return cp > 0 ? 4 : -4;
  return clampNumber(cp / 100, -12, 12);
}

function buildAnalysisWhyBeats(
  move: ReturnType<typeof buildMobileAnalysisRows>[number],
  engineLines: AnalysisLineOption[],
  pair?: MoveEngineResult,
  reply?: ReturnType<typeof buildMobileAnalysisRows>[number],
): AnalysisWhyBeat[] {
  const playedSquares = squaresForUci(move.uci);
  const nextLine = engineLines[0];
  const nextUci = nextLine?.rawPv?.split(/\s+/).find(Boolean) || reply?.uci || "";
  const nextSquares = squaresForUci(nextUci);
  const bestUci = move.bestUci || "";
  const bestSquares = squaresForUci(bestUci);
  const likelyMove = nextLine?.move || reply?.san || "the forcing reply";
  const bestMove = move.better?.san || formatMoveSan(move.entry.fenBefore || move.entry.fen, bestUci) || "the safer move";
  const loss = typeof pair?.evalLossCp === "number" ? pair.evalLossCp : Math.abs(move.delta * 100);
  return [
    {
      toneName: "you",
      tag: move.label === "OK" ? "Move idea" : move.headline,
      caption: move.body || `${move.san} changes the forcing line.`,
      spotlights: playedSquares ? [playedSquares.from, playedSquares.to] : [],
      arrows: playedSquares ? [{ ...playedSquares, kind: "you" }] : [],
    },
    {
      toneName: "them",
      tag: "Reply",
      caption: `Check ${likelyMove} before choosing ${move.san}.`,
      spotlights: nextSquares ? [nextSquares.from, nextSquares.to] : [],
      arrows: nextSquares ? [{ ...nextSquares, kind: "them" }] : [],
    },
    {
      toneName: "idea",
      tag: loss >= 120 ? "Better" : "Improve",
      caption: `Better: ${bestMove}. It covers the urgent line.`,
      spotlights: bestSquares ? [bestSquares.from, bestSquares.to] : [],
      arrows: bestSquares ? [{ ...bestSquares, kind: "idea" }] : [],
    },
  ];
}

function formatPvSan(fen: string, pv = "", limit = 6) {
  const moves = pv.split(/\s+/).filter(Boolean).slice(0, limit);
  if (!moves.length) return "No line available";
  try {
    const board = new Chess(fen);
    const san: string[] = [];
    for (const uci of moves) {
      if (!/^[a-h][1-8][a-h][1-8]/.test(uci)) continue;
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!move) break;
      san.push(move.san);
    }
    return san.length ? san.join(" ") : moves.map(formatUci).join(" ");
  } catch {
    return moves.map(formatUci).join(" ");
  }
}

function buildAnalysisPlaybackFrames(fen: string, rawPv = ""): AnalysisPlaybackFrame[] {
  const fallbackFrame = { fen: fen || new Chess().fen(), lastMove: null, highlights: {}, arrows: [] };
  if (!rawPv.trim()) return [fallbackFrame];
  try {
    const board = new Chess(fen);
    const frames: AnalysisPlaybackFrame[] = [{ fen: board.fen(), lastMove: null, highlights: {}, arrows: [] }];
    const moves = rawPv.split(/\s+/).filter(Boolean).slice(0, 6);
    for (const [index, uci] of moves.entries()) {
      if (!/^[a-h][1-8][a-h][1-8]/.test(uci)) continue;
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const move = board.move({ from, to, promotion: uci[4] });
      if (!move) break;
      const kind: DesignArrow["kind"] = index % 2 === 0 ? "idea" : "them";
      frames.push({
        fen: board.fen(),
        lastMove: { from, to },
        highlights: { [from]: kind || "idea", [to]: kind || "idea" },
        arrows: [{ from, to, kind }],
      });
    }
    return frames.length > 1 ? frames : [fallbackFrame];
  } catch {
    return [fallbackFrame];
  }
}

function groupedPatternSummaries(issues: MoveIssue[]) {
  const grouped = new Map<string, { id: string; title: string; total: number; severity: number; advice: string; examples: MoveIssue[] }>();
  for (const issue of issues) {
    const key = String(issue.id || issue.title);
    const existing = grouped.get(key);
    if (existing) {
      existing.total += 1;
      existing.severity = Math.max(existing.severity, issue.severity);
      existing.examples.push(issue);
    } else {
      grouped.set(key, {
        id: key,
        title: issue.title,
        total: 1,
        severity: issue.severity,
        advice: issue.advice,
        examples: [issue],
      });
    }
  }
  return [...grouped.values()].sort((a, b) => b.total - a.total || b.severity - a.severity);
}

function qualityTrend(report: AnalysisReport, quality: MoveReviewQuality) {
  const matching = report.moveReviews.filter(review => review.quality === quality);
  const timestamped = matching
    .map(review => ({ review, time: reviewTimestamp(report, review) }))
    .filter(item => item.time > 0);
  if (!timestamped.length) return { delta: 0, spark: bucketCounts(matching.length, matching.map((_, index) => index), 20) };

  const now = Math.max(...timestamped.map(item => item.time));
  const day = 86_400;
  const recentStart = now - 30 * day;
  const previousStart = now - 60 * day;
  const recent = timestamped.filter(item => item.time >= recentStart);
  const previous = timestamped.filter(item => item.time >= previousStart && item.time < recentStart);
  const spark = Array.from({ length: 20 }, () => 0);
  for (const item of recent) {
    const slot = clampNumber(Math.floor(((item.time - recentStart) / (30 * day)) * spark.length), 0, spark.length - 1);
    spark[slot] += 1;
  }
  return { delta: recent.length - previous.length, spark };
}

function buildWeeklyTrend(report: AnalysisReport) {
  const trainable = report.moveReviews.filter(review => isTrainableQuality(review.quality));
  const timestamped = trainable
    .map(review => ({ review, time: reviewTimestamp(report, review) }))
    .filter(item => item.time > 0);
  if (!timestamped.length) {
    const games = report.gameSummaries.slice(-14);
    const currentGames = games.slice(-7);
    const previousGames = games.slice(0, Math.max(0, games.length - 7));
    const currentIds = new Set(currentGames.map(game => game.id));
    const previousIds = new Set(previousGames.map(game => game.id));
    const days = currentGames.map((game, index) => {
      const reviews = trainable.filter(review => review.gameId === game.id);
      return {
        day: game.result === "win" ? "W" : game.result === "loss" ? "L" : game.result === "draw" ? "D" : String(index + 1),
        b: reviews.filter(review => review.quality === "blunder" || review.quality === "miss").length,
        m: reviews.filter(review => review.quality === "mistake").length,
        i: reviews.filter(review => review.quality === "inaccuracy").length,
      };
    });
    while (days.length < 7) days.unshift({ day: String(days.length + 1), b: 0, m: 0, i: 0 });
    const total = trainable.filter(review => currentIds.has(review.gameId)).length;
    const previous = trainable.filter(review => previousIds.has(review.gameId)).length;
    const changePct = previous ? Math.round(((total - previous) / previous) * 100) : total ? 100 : 0;
    return {
      days,
      total,
      max: Math.max(1, ...days.map(item => item.b + item.m + item.i)),
      changePct,
      label: "Last 7 games",
      compareLabel: "vs prev set",
    };
  }

  const day = 86_400;
  const now = Math.max(...timestamped.map(item => item.time));
  const start = now - 6 * day;
  const days = Array.from({ length: 7 }, (_, i) => {
    const stamp = start + i * day;
    return {
      day: new Date(stamp * 1000).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1).toUpperCase(),
      b: 0,
      m: 0,
      i: 0,
    };
  });

  for (const item of timestamped) {
    const slot = Math.floor((item.time - start) / day);
    if (slot < 0 || slot > 6) continue;
    if (item.review.quality === "blunder" || item.review.quality === "miss") days[slot].b += 1;
    else if (item.review.quality === "mistake") days[slot].m += 1;
    else if (item.review.quality === "inaccuracy") days[slot].i += 1;
  }

  const total = days.reduce((sum, item) => sum + item.b + item.m + item.i, 0);
  const previous = timestamped.filter(item => item.time >= start - 7 * day && item.time < start).length;
  const changePct = previous ? Math.round(((total - previous) / previous) * 100) : total ? 100 : 0;
  const max = Math.max(1, ...days.map(item => item.b + item.m + item.i));
  return { days, total, max, changePct, label: "Last 7 days", compareLabel: "vs prev wk" };
}

function reviewTimestamp(report: AnalysisReport, review: MoveReview) {
  return review.endTime || report.gameSummaries.find(game => game.id === review.gameId)?.endTime || 0;
}

function bucketCounts(total: number, indexes: number[], bucketTotal: number) {
  const buckets = Array.from({ length: bucketTotal }, () => 0);
  if (!total) return buckets;
  for (const index of indexes) {
    const bucket = clampNumber(Math.floor((index / total) * bucketTotal), 0, bucketTotal - 1);
    buckets[bucket] += 1;
  }
  return buckets;
}

function patternAccuracy(reviews: MoveReview[], severity = 3) {
  if (!reviews.length) return clampNumber(Math.round(100 - severity * 9), 20, 92);
  const avgLoss = reviews.reduce((sum, review) => sum + reviewLossCp(review), 0) / reviews.length;
  return clampNumber(Math.round(100 - avgLoss / 6), 12, 94);
}

function miniPatternFor(title: string, tone: string) {
  const lower = title.toLowerCase();
  const pieces: Array<[number, number, string]> = [];
  const marks: Array<[number, number, string]> = [[2, 1, "rgba(226,96,74,0.34)"]];
  let arrow: [number, number, number, number] | null = null;
  if (lower.includes("king")) pieces.push([0, 2, "♔"]);
  else if (lower.includes("queen")) pieces.push([1, 2, "♕"]);
  else if (lower.includes("end")) pieces.push([1, 1, "♔"], [2, 2, "♚"]);
  else if (lower.includes("pin") || lower.includes("skewer")) pieces.push([2, 0, "♗"]);
  else pieces.push([2, 1, "♘"]);
  if (lower.includes("reply") || lower.includes("miss") || lower.includes("forcing")) {
    marks.push([0, 3, "rgba(233,162,74,0.3)"]);
    arrow = [40, 68, 94, 16];
  }
  marks.push([0, 1, tone]);
  return { pieces, marks, arrow };
}

function entryFromReview(review: MoveReview): AnalysisHistoryEntry {
  const lastMove = review.uci && /^[a-h][1-8][a-h][1-8]/.test(review.uci)
    ? { from: review.uci.slice(0, 2), to: review.uci.slice(2, 4) }
    : undefined;
  return {
    fen: review.fenAfter || review.fenBefore,
    fenBefore: review.fenBefore,
    uci: review.uci,
    lastMove,
    san: review.san,
    side: review.color === "black" ? "b" : "w",
    moveNumber: review.moveNumber,
  };
}

function squaresFromUci(uci: string, tone: string) {
  if (!/^[a-h][1-8][a-h][1-8]/.test(uci)) return null;
  return { [uci.slice(0, 2)]: tone, [uci.slice(2, 4)]: tone };
}

function squaresForUci(uci?: string) {
  if (!uci || !/^[a-h][1-8][a-h][1-8]/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function sameUciMove(left?: string, right?: string) {
  if (!left || !right) return false;
  return left.slice(0, 5).toLowerCase() === right.slice(0, 5).toLowerCase();
}

function patternHeadline(title: string): ReactNode {
  const lower = title.toLowerCase();
  if (lower.includes("repl") || lower.includes("forcing")) return <>You move <i>before</i> seeing the reply.</>;
  if (lower.includes("king")) return <>Your king safety is the <i>priority</i>.</>;
  if (lower.includes("queen")) return <>Your queen moves need <i>tempo</i>.</>;
  return <>Tighten <i>{title.toLowerCase()}</i>.</>;
}

function formatSignedCount(value: number) {
  if (value === 0) return "→0";
  return `${value < 0 ? "↓" : "↑"}${Math.abs(value)}`;
}

function formatSignedPercent(value: number) {
  if (value === 0) return "→ 0%";
  return `${value < 0 ? "▼" : "▲"} ${Math.abs(value)}%`;
}

function formatSignedEval(value: number) {
  if (Math.abs(value) >= 99) return value > 0 ? "+M" : "-M";
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function qualityClass(quality: MoveReviewQuality) {
  return quality === "inaccuracy" ? "inacc" : quality;
}

function qualityShortLabel(quality: MoveReviewQuality) {
  return quality === "blunder" ? "BLNDR" :
    quality === "inaccuracy" ? "INACC" :
    quality === "mistake" ? "MISTAKE" :
    quality === "miss" ? "MISS" :
    quality === "best" ? "BEST" :
    "OK";
}

function formatMoveLabel(review: Pick<MoveReview, "moveNumber" | "color" | "san">) {
  return `${review.moveNumber}${review.color === "black" ? "..." : "."} ${review.san}`;
}

function lineContinuation(line: AnalysisLineOption) {
  const parts = line.pv.split(/\s+/).filter(Boolean);
  if (!parts.length || line.pv === "No line available") return "No continuation";
  const first = parts[0]?.replace(/[+#?!]+$/g, "");
  const move = line.move.replace(/[+#?!]+$/g, "");
  const continuation = first === move ? parts.slice(1) : parts;
  return continuation.length ? continuation.join(" ") : "Best move";
}

function normalizeMoveText(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function Frame({ children, nav, setActiveView, openProfile, report }: {
  children: ReactNode;
  nav: "dashboard" | "games" | "lab" | "patterns" | "drill" | "analysis";
  setActiveView: (view: AppView) => void | undefined;
  openProfile?: () => void;
  report?: AnalysisReport;
}) {
  return (
    <div className="pc-frame">
      <NavRail active={nav} setActiveView={setActiveView} openProfile={openProfile} report={report} />
      <main className="pc-main">{children}</main>
    </div>
  );
}

function NavRail({ active, setActiveView, openProfile, report }: {
  active: "dashboard" | "games" | "lab" | "patterns" | "drill" | "analysis";
  setActiveView: (view: AppView) => void | undefined;
  openProfile?: () => void;
  report?: AnalysisReport;
}) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: "◎", view: "dashboard" },
    { id: "games", label: "Games", icon: "□", view: "games" },
    { id: "lab", label: "Mistake Lab", icon: "◇", view: "mistakes" },
    { id: "patterns", label: "Patterns", icon: "▥", view: "patterns" },
    { id: "drill", label: "Drill", icon: "△", view: "drill" },
    { id: "analysis", label: "Analysis", icon: "◯", view: "analysis" },
  ] as const;

  const totalGames = report?.games ?? 0;
  const initials = (report?.username || "PC").slice(0, 2).toUpperCase();
  const rating = report?.skillProfile?.estimatedRating ?? 1200;
  const peakRating = report?.peakRating ?? rating;

  return (
    <aside className="pc-nav">
      <BrandMark compact />
      <nav>
        {items.map(item => (
          <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActiveView(item.view)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="pc-nav-bottom">
        <div className="pc-streak-card">
          <span>Games</span><strong>{totalGames}</strong><small>imported</small>
          <div className="pc-streak-bars-small">
            {Array.from({ length: 14 }).map((_, i) => {
              const threshold = Math.max(1, Math.floor(totalGames / 14));
              return <i key={i} className={i < Math.min(14, Math.floor(totalGames / threshold)) ? "on" : ""} />;
            })}
          </div>
        </div>
        <button className="pc-profile-mini" onClick={openProfile}>
          <b>{initials}</b><span>{rating} · {peakRating > rating ? `peak ${peakRating}` : "rating"}</span>
        </button>
      </div>
    </aside>
  );
}

function TopBar({ title, eyebrow, right }: { title: ReactNode; eyebrow?: ReactNode; right?: ReactNode }) {
  return (
    <header className="pc-topbar">
      <div>
        {eyebrow && <div className="pc-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {right}
    </header>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`pc-brand ${compact ? "compact" : ""}`}>
      <div className="pc-brand-mark" />
      <span>Pattern <i>Coach</i></span>
    </div>
  );
}

function Button({ children, primary, ghost, small, disabled, onClick }: {
  children?: ReactNode;
  primary?: boolean;
  ghost?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`pc-btn ${primary ? "primary" : ""} ${ghost ? "ghost" : ""} ${small ? "small" : ""}`.trim()} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Pill({ children, tone = "neutral", subtle = false }: { children: ReactNode; tone?: "you" | "them" | "idea" | "neutral"; subtle?: boolean }) {
  return <span className={`pc-pill ${tone} ${subtle ? "subtle" : ""}`}>{children}</span>;
}

function ReplyOrbit({ title, total }: { title: string; total: number }) {
  return (
    <div className="pc-orbit">
      <svg viewBox="0 0 600 320" aria-hidden="true">
        <ellipse cx="300" cy="160" rx="270" ry="135" />
        <ellipse cx="300" cy="160" rx="200" ry="100" />
        <path className="you" d="M 110 90 Q 220 70 300 90" />
        <path className="them" d="M 500 90 Q 510 220 380 250" />
        <path className="idea" d="M 220 250 Q 80 200 110 90" />
      </svg>
      <div className="pc-orbit-title">You move <i>before</i> seeing the reply.</div>
      <OrbitNode className="you" label="You" move="Bc4" hint="developed bishop" />
      <OrbitNode className="them" label="Them" move="Nxh5" hint="wins the queen" />
      <OrbitNode className="idea" label="Idea" move="Nf3" hint="defends, develops" />
      <div className="pc-orbit-caption">{title} · {total} spots</div>
    </div>
  );
}

function OrbitNode({ className, label, move, hint }: { className: string; label: string; move: string; hint: string }) {
  return (
    <div className={`pc-orbit-node ${className}`}>
      <div><i /><span>{label}</span><strong>{move}</strong></div>
      <small>{hint}</small>
    </div>
  );
}

function MetricBlock({ label, value, unit, hint, trend, divider }: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  trend?: string;
  divider?: boolean;
}) {
  return (
    <div className={`pc-metric-block ${divider ? "divider" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>{unit && <em>{unit}</em>}
      {(hint || trend) && <small className={trend?.startsWith("-") ? "bad" : ""}>{hint || `${trend} pts`}</small>}
    </div>
  );
}

function ExamplesCard({ examples, review }: { examples: MoveReview[]; review: () => void }) {
  return (
    <section className="pc-card pc-examples-card">
      <div className="pc-card-head">
        <div><span>Top examples</span><strong>Where this pattern shows up</strong></div>
        <small>{examples.length} shown</small>
      </div>
      <div>
        {examples.map(example => (
          <button key={example.id} onClick={review}>
            <span>{example.moveNumber}.</span>
            <div><strong>{example.san}</strong><small>vs. {example.opponent || "Opponent"}</small></div>
            <b>{formatReviewLoss(example)}</b><i>›</i>
          </button>
        ))}
        {!examples.length && <button onClick={review}><span>0.</span><div><strong>No examples yet</strong><small>Sync more games</small></div><b>0.0</b><i>›</i></button>}
      </div>
    </section>
  );
}

function MobileStatsPanel({ report }: { report: AnalysisReport }) {
  const stats = buildMobileQualityStats(report).map(stat => ({ ...stat, label: stat.short }));
  const total = Math.max(1, stats.reduce((sum, stat) => sum + stat.count, 0));
  const weekly = buildWeeklyTrend(report);
  return (
    <section className="pc-mobile-stats">
      <SectionHead eyebrow="Move quality" meta="Last 30 days" />
      <div className="pc-stat-grid">
        {stats.map(stat => (
          <div key={stat.key} className={`pc-stat-tile ${stat.key}`}>
            <div><i /><span>{stat.label.toUpperCase().slice(0, 7)}</span><b>{stat.delta < 0 ? "↓" : "↑"}{Math.abs(stat.delta)}</b></div>
            <strong>{stat.count}</strong>{stat.glyph && <em>{stat.glyph}</em>}
            <Sparkline colorKey={stat.key} data={stat.spark} />
          </div>
        ))}
      </div>
      <div className="pc-severity-bar">
        {stats.map(stat => <i key={stat.key} className={stat.key} style={{ width: `${Math.max(4, (stat.count / total) * 100)}%` }} />)}
      </div>
      <div className="pc-severity-meta"><span>{total} flagged moves</span><b>{weekly.changePct < 0 ? "▼" : "▲"} {Math.abs(weekly.changePct)}% {weekly.compareLabel}</b></div>
    </section>
  );
}

function Sparkline({ colorKey, data = [] }: { colorKey: string; data?: number[] }) {
  const values = data.length ? data : Array.from({ length: 20 }, () => 0);
  const step = values.length > 1 ? 160 / (values.length - 1) : 160;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 160 22" preserveAspectRatio="none" className={`pc-spark ${colorKey}`}>
      <polyline points={points} />
    </svg>
  );
}

function TodayCard({ report }: { report: AnalysisReport }) {
  const weekly = buildWeeklyTrend(report);
  const maxBar = Math.max(1, ...weekly.days.map(d => d.b + d.m + d.i));
  return (
    <section className="pc-card pc-today-card">
      <div className="pc-panel-label">{weekly.label}</div>
      <div className="pc-week-bars">
        {weekly.days.map((d, i) => (
          <div key={i}>
            <i style={{ height: maxBar ? ((d.b + d.m + d.i) / maxBar) * 44 : 4 }} className={i === weekly.days.length - 1 ? "today" : ""} />
            <span>{d.day}</span>
          </div>
        ))}
      </div>
      <div className="pc-week-stats">
        <MetricBlock label="Total" value={String(weekly.total)} />
        <MetricBlock label="Avg/day" value={String(Math.round(weekly.total / Math.max(1, weekly.days.length)))} divider />
        <MetricBlock label={weekly.compareLabel} value={`${weekly.changePct > 0 ? "+" : ""}${weekly.changePct}%`} divider />
      </div>
    </section>
  );
}

function LatestGames({ games, openGame }: { games: GameSummary[]; openGame: (gameId: number) => void }) {
  return (
    <section className="pc-card pc-latest-games">
      <div className="pc-card-head"><div><span>Latest games</span><strong>Recently imported</strong></div><small>{games.length}</small></div>
      {games.map(game => (
        <button key={game.id} onClick={() => openGame(game.id)}>
          <span className={game.result}>{game.result[0]?.toUpperCase() || "G"}</span>
          <div><strong>{game.opponent || "Unknown opponent"}</strong><small>{[game.timeClass, game.opening || formatGameDate(game.endTime)].filter(Boolean).join(" · ")}</small></div>
          <b>{game.issues}</b><i>›</i>
        </button>
      ))}
    </section>
  );
}

function GameRow({ game, selected, onClick }: { game: GameSummary; selected: boolean; onClick: () => void }) {
  const result = game.result === "win" ? "W" : game.result === "loss" ? "L" : game.result === "draw" ? "D" : "?";
  return (
    <button className={`pc-game-row ${selected ? "active" : ""}`} onClick={onClick}>
      <span className={game.result}>{result}</span>
      <div><strong>{game.opponent || "Unknown opponent"}</strong><small>{[game.opening, game.timeClass, formatGameDate(game.endTime)].filter(Boolean).join(" · ")}</small></div>
      <b>{Math.max(0, game.moveCount * 2 || 0)}</b>
      <i>{game.issues || "—"}</i>
    </button>
  );
}

function ReplayControls({ selectedPly, total, setSelectedPly, jumpBy }: {
  selectedPly: number;
  total: number;
  setSelectedPly: (value: number) => void;
  jumpBy: (delta: number) => void;
}) {
  return (
    <div className="pc-replay-controls">
      <button onClick={() => setSelectedPly(0)} disabled={selectedPly <= 0}>⏪</button>
      <button onClick={() => jumpBy(-1)} disabled={selectedPly <= 0}>◀</button>
      <div><i style={{ width: `${total ? (selectedPly / total) * 100 : 0}%` }} /></div>
      <button onClick={() => jumpBy(1)} disabled={selectedPly >= total}>▶</button>
      <button onClick={() => setSelectedPly(total)} disabled={selectedPly >= total}>⏩</button>
    </div>
  );
}

function MoveLog({ timeline, selectedPly, setSelectedPly }: { timeline: GameTimelineMove[]; selectedPly: number; setSelectedPly: (ply: number) => void }) {
  const pairs = [];
  for (let i = 0; i < timeline.length; i += 2) pairs.push([timeline[i], timeline[i + 1]]);
  return (
    <section className="pc-move-log">
      <header>
        <span>Move log</span>
        <div><Legend className="idea" label="Good" /><Legend className="you" label="Inaccuracy" /><Legend className="them" label="Blunder" /></div>
      </header>
      <div className="pc-move-log-scroll">
        {pairs.map(([white, black], index) => (
          <div key={index} className={(white?.ply === selectedPly || black?.ply === selectedPly) ? "active" : ""}>
            <span>{index + 1}.</span>
            <MoveCell move={white} selectedPly={selectedPly} setSelectedPly={setSelectedPly} />
            <MoveCell move={black} selectedPly={selectedPly} setSelectedPly={setSelectedPly} />
          </div>
        ))}
      </div>
    </section>
  );
}

function MoveCell({ move, selectedPly, setSelectedPly }: { move?: GameTimelineMove; selectedPly: number; setSelectedPly: (ply: number) => void }) {
  if (!move) return <span />;
  return (
    <button className={move.ply === selectedPly ? "active" : ""} onClick={() => setSelectedPly(move.ply)}>
      {move.san}{move.review && <i className={qualityTone(move.review.quality)} />}
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="pc-legend"><i className={className} />{label}</span>;
}

function PatternHeader({ summaries, activeId }: { summaries: AnalysisReport["summaries"]; activeId: string }) {
  const active = activeId === "all" ? summaries[0] : summaries.find(summary => summary.id === activeId);
  return (
    <div className="pc-pattern-head">
      <div><i /><strong>{active?.title || "All patterns"}</strong><span>{active?.total || summaries.reduce((sum, item) => sum + item.total, 0)} · {summaries.length} patterns</span></div>
      <div>{[6, 4, 3, 1].map((value, i) => <i key={i} style={{ flex: value }} />)}</div>
    </div>
  );
}

function MistakeRow({ review, selected, onClick }: { review: MoveReview; selected: boolean; onClick: () => void }) {
  return (
    <button className={`pc-mistake-row quality-${qualityClass(review.quality)} ${selected ? "active" : ""}`} onClick={onClick}>
      <div>
        <div>
          <small>{review.moveNumber}{review.color === "black" ? "..." : "."}</small>
          <strong>{review.san}</strong>
          <b className={`pc-quality-badge ${mistakeEvalTone(review.quality)}`}>{qualityLabel(review.quality)}</b>
        </div>
      </div>
      <em className={`pc-eval-chip ${mistakeEvalTone(review.quality)}`}>{formatReviewLoss(review)}</em>
    </button>
  );
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ id: T; label: string; tone: "you" | "them" | "idea" }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="pc-segmented">
      {options.map(option => (
        <button key={option.id} className={option.id === value ? "active" : ""} onClick={() => onChange(option.id)}>
          <i className={option.tone} />{option.label}
        </button>
      ))}
    </div>
  );
}

function MoveMap({ you, them, idea, insight, compact = false }: { you?: string; them?: string; idea?: string; insight?: string; compact?: boolean }) {
  return (
    <section className={`pc-move-map ${compact ? "compact" : ""}`}>
      <div className="pc-panel-label">Move map</div>
      <div className="pc-map-nodes">
        <MapNode label="You" move={you} tone="you" />
        <ArrowIcon />
        <MapNode label="Them" move={them} tone="them" dim={!them} />
        <ArrowIcon dim={!idea} />
        <MapNode label="Idea" move={idea} tone="idea" dim={!idea} />
      </div>
      {insight && <p>{insight}</p>}
    </section>
  );
}

function MapNode({ label, move, tone, dim }: { label: string; move?: string; tone: "you" | "them" | "idea"; dim?: boolean }) {
  return (
    <div className={dim ? "dim" : ""}>
      <span>{label}</span>
      <strong><i className={tone} />{move || "—"}</strong>
    </div>
  );
}

function ArrowIcon({ dim }: { dim?: boolean }) {
  return <svg className={dim ? "dim" : ""} width="16" height="10" viewBox="0 0 16 10"><path d="M 0 5 L 13 5 M 9 1 L 13 5 L 9 9" /></svg>;
}

function EngineDrawer({ review }: { review: MoveReview }) {
  const lines = review.engineLines?.length ? review.engineLines : [];
  return (
    <section className="pc-engine-drawer">
      <header><span>▾ Engine lines</span><b>{review.engineDepth ? `depth ${review.engineDepth}` : "stockfish"}</b></header>
      {lines.slice(0, 3).map(line => (
        <p key={`${line.multipv}-${line.pv}`}><b>{formatCp(line.evalCp, line.mate)}</b><span>{formatPrincipalVariation(line.pv || line.bestMove)}</span></p>
      ))}
      {!lines.length && <p><b>...</b><span>Engine line will appear after background review.</span></p>}
    </section>
  );
}

function SideMeta({ issue }: { issue: MoveIssue }) {
  return (
    <aside className="pc-side-meta">
      <Meta label="Side" value={titleCase(issue.color)} accent />
      <Meta label="Phase" value={phaseLabels[issue.phase]} />
      <Meta label="Opening" value={issue.opening || "Game position"} />
      <Meta label="Pattern" value={issue.title} tone="you" />
    </aside>
  );
}

function Meta({ label, value, tone, accent }: { label: string; value: string; tone?: "you"; accent?: boolean }) {
  return <div><span>{label}</span><strong className={tone || (accent ? "accent" : "")}>{value}</strong></div>;
}

function EvalBar({ score = 0.4, height = 480 }: { score?: number; height?: number }) {
  const clamped = Math.max(-4, Math.min(4, score));
  const whitePct = (clamped + 4) / 8;
  return <div className="pc-eval-bar" style={{ height }}><i style={{ height: `${whitePct * 100}%` }} /></div>;
}

function DesignBoard({ fen = new Chess().fen(), highlights = {}, arrows = [], lastMove, size = 480, showCoords = true, flipped = false, onAnalyze, showAnalyze = true, spotlight, onSquareClick, selectedSquare, legalSquares = [], squareStyles = {} }: {
  fen?: string;
  highlights?: Record<string, string>;
  squareStyles?: Record<string, CSSProperties>;
  arrows?: DesignArrow[];
  lastMove?: { from: string; to: string } | null;
  size?: number;
  showCoords?: boolean;
  flipped?: boolean;
  onAnalyze?: () => void;
  showAnalyze?: boolean;
  spotlight?: AnalysisWhyBeat | null;
  onSquareClick?: (square: string) => void;
  selectedSquare?: string;
  legalSquares?: string[];
}) {
  const id = useId().replace(/:/g, "");
  const grid = useMemo(() => {
    let parsed = parseFen(fen);
    if (flipped) parsed = parsed.slice().reverse().map(row => row.slice().reverse());
    return parsed;
  }, [fen, flipped]);
  const legalSet = useMemo(() => new Set(legalSquares), [legalSquares]);
  const squareNames = (row: number, col: number) => {
    const fileIdx = flipped ? 7 - col : col;
    const rankIdx = flipped ? row : 7 - row;
    return `${"abcdefgh"[fileIdx]}${rankIdx + 1}`;
  };

  return (
    <div className={`pc-board ${onSquareClick ? "interactive" : ""}`} style={{ "--pc-board-size": `${size}px` } as CSSProperties}>
      <div className="pc-board-grid">
        {grid.flatMap((row, r) => row.map((piece, c) => {
          const square = squareNames(r, c);
          const tone = selectedSquare === square ? "sel" : highlights[square];
          const squareStyle = squareStyles[square];
          const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
          const className = `pc-square ${(r + c) % 2 === 0 ? "light" : "dark"} ${tone ? `hi-${tone}` : ""} ${squareStyle ? "struggle" : ""} ${legalSet.has(square) ? "legal" : ""} ${selectedSquare === square ? "selected" : ""} ${isLast && !tone ? "last" : ""}`;
          const content = (
            <>
              {showCoords && c === 0 && <span className="pc-rank">{square[1]}</span>}
              {showCoords && r === 7 && <span className="pc-file">{square[0]}</span>}
              {piece && <strong className={piece === piece.toUpperCase() ? "white" : "black"}>{pieceGlyphs[piece]}</strong>}
            </>
          );
          if (onSquareClick) {
            return (
              <button key={`${r}-${c}`} type="button" className={className} style={squareStyle} onClick={() => onSquareClick(square)} aria-label={square}>
                {content}
              </button>
            );
          }
          return (
            <div key={`${r}-${c}`} className={className} style={squareStyle}>
              {content}
            </div>
          );
        }))}
      </div>
      {arrows.length > 0 && (
        <svg className="pc-board-arrows" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            {(["you", "them", "idea", "neutral"] as const).map(kind => (
              <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={kind} />
              </marker>
            ))}
          </defs>
          {arrows.map((arrow, i) => {
            const from = squareCenterPct(arrow.from, flipped);
            const to = squareCenterPct(arrow.to, flipped);
            const kind = arrow.kind || "neutral";
            return <line key={`${arrow.from}-${arrow.to}-${i}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={kind} markerEnd={`url(#${id}-${kind})`} />;
          })}
        </svg>
      )}
      {spotlight && <BoardSoftSpotlight beat={spotlight} flipped={flipped} />}
      {showAnalyze && <button className="pc-analyse-chip" type="button" onClick={onAnalyze} disabled={!onAnalyze}><Search size={11} /> Analyze</button>}
    </div>
  );
}

function BoardSoftSpotlight({ beat, flipped }: { beat: AnalysisWhyBeat; flipped: boolean }) {
  const tone = beat.toneName === "you" ? "var(--pc-you)" :
    beat.toneName === "them" ? "var(--pc-them)" :
      beat.toneName === "idea" ? "var(--pc-idea)" : "var(--pc-text)";
  return (
    <svg className="pc-board-spotlight" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="#06060a" opacity="0.12" />
      {beat.spotlights.map(square => {
        const point = squareCenterPct(square, flipped);
        return (
          <g key={`${square}-heat`}>
            <rect x={point.x - 6.1} y={point.y - 6.1} width="12.2" height="12.2" rx="1.4" fill={tone} opacity="0.18" />
            <rect x={point.x - 6.1} y={point.y - 6.1} width="12.2" height="12.2" rx="1.4" fill="none" stroke={tone} strokeWidth="0.42" opacity="0.34" />
          </g>
        );
      })}
    </svg>
  );
}

function PreviewMini({ kind, label, san }: { kind: "you" | "them" | "idea"; label: string; san: string }) {
  return <div className={`pc-preview-mini ${kind}`}><i /><span>{label}</span><strong>{san}</strong></div>;
}

function SectionHead({ eyebrow, meta, action }: { eyebrow: string; meta?: string; action?: string }) {
  return <div className="pc-section-head"><span>{eyebrow}</span>{meta && <b>· {meta}</b>}{action && <button>{action} ›</button>}</div>;
}

function StatusOverlay() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setTime(`${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="pc-status">
      <span>{time}</span>
      <div><i /><i /><i /><b /></div>
    </header>
  );
}

function HomeIndicator() {
  return <div className="pc-home-indicator"><i /></div>;
}

function MobileTabBar({ activeView, analysisReturnView, setActiveView, openMenu, openProfile }: {
  activeView: AppView;
  analysisReturnView: Exclude<AppView, "analysis">;
  setActiveView: (view: AppView) => void;
  openMenu: () => void;
  openProfile: () => void;
}) {
  const tabs = [
    { id: "dashboard", label: "Home", icon: MobileHomeIcon },
    { id: "games", label: "Games", icon: MobileGamesIcon },
    { id: "mistakes", label: "Lab", icon: MobileLabIcon },
    { id: "patterns", label: "Patterns", icon: MobilePatternsIcon },
    { id: "drill", label: "Drill", icon: MobileDrillIcon },
  ] as const;
  return (
    <nav className="pc-tabbar">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={activeView === id || (activeView === "analysis" && analysisReturnView === id) ? "active" : ""}
          onClick={() => setActiveView(id)}
        >
          <Icon size={20} /><span>{label}</span>
        </button>
      ))}
      <button type="button" onClick={openMenu}><MobileMeIcon size={20} /><span>Menu</span></button>
    </nav>
  );
}

function MobileHomeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function MobileGamesIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MobileLabIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3 L17 10 L10 17 L3 10 Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MobileDrillIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 4 L16 4 L10 16 Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MobilePatternsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 15 L4 5 M8 15 L8 8 M12 15 L12 4 M16 15 L16 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3 15.5 H17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MobileMeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 18 Q10 12 17 18" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function getTrainableReviews(report: AnalysisReport) {
  return report.moveReviews
    .filter(review => isTrainableQuality(review.quality))
    .slice()
    .sort((a, b) => (b.engineEvalLoss ?? b.severity * 45) - (a.engineEvalLoss ?? a.severity * 45));
}

function orderReviewsForVisualList(reviews: MoveReview[]) {
  return reviews.slice().sort((a, b) => {
    const sparseDelta = Number(countFenPieces(a.fenBefore) <= 6) - Number(countFenPieces(b.fenBefore) <= 6);
    if (sparseDelta !== 0) return sparseDelta;
    const phaseDelta = phaseSortWeight(a.phase) - phaseSortWeight(b.phase);
    if (phaseDelta !== 0) return phaseDelta;
    return (b.engineEvalLoss ?? b.severity * 45) - (a.engineEvalLoss ?? a.severity * 45);
  });
}

function phaseSortWeight(phase: Phase) {
  return phase === "opening" ? 0 : phase === "middlegame" ? 1 : 2;
}

function countFenPieces(fen: string) {
  return (fen.split(" ")[0]?.match(/[prnbqkPRNBQK]/g) || []).length;
}

function isTrainableQuality(quality: MoveReviewQuality) {
  return quality === "blunder" || quality === "miss" || quality === "mistake" || quality === "inaccuracy";
}

function qualityBucket(quality: MoveReviewQuality): MoveReviewQuality {
  return quality;
}

function qualityLabel(quality: MoveReviewQuality) {
  return quality === "best" ? "Best" :
    quality === "good" ? "Good" :
    quality === "blunder" ? "Blunder" :
    quality === "miss" ? "Miss" :
    quality === "inaccuracy" ? "Inaccuracy" :
    "Mistake";
}

function qualityTone(quality: MoveReviewQuality) {
  return quality === "blunder" || quality === "miss" ? "them" :
    quality === "mistake" || quality === "inaccuracy" ? "you" :
    "idea";
}

function mistakeEvalTone(quality: MoveReviewQuality) {
  return quality === "blunder" || quality === "miss" ? "bad" : "warn";
}

function issueForReview(report: AnalysisReport, review: MoveReview, preferredPatternId?: string): MoveIssue | null {
  const preferred = preferredPatternId && preferredPatternId !== "all" && review.issueIds.includes(preferredPatternId as never)
    ? preferredPatternId
    : undefined;
  const exact = report.issues.find(issue =>
    (!preferred || issue.id === preferred) &&
    issue.fenBefore === review.fenBefore &&
    (issue.san === review.san || issue.uci === review.uci)
  ) || (!preferred ? report.issues.find(issue => issue.fenBefore === review.fenBefore && (issue.san === review.san || issue.uci === review.uci)) : undefined);
  if (exact) return exact;
  const patternId = preferred || review.issueIds[0];
  const summary = report.summaries.find(item => item.id === patternId);
  return {
    id: patternId || "engineMistake",
    phase: review.phase,
    quality: review.quality,
    severity: review.severity,
    title: summary?.title || review.title,
    explanation: review.explanation,
    advice: summary?.advice || "Compare the move map, then drill this pattern.",
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
  } as MoveIssue;
}

function reviewForIssue(report: AnalysisReport, issue?: MoveIssue) {
  if (!issue) return undefined;
  return report.moveReviews.find(review =>
    comparableFen(review.fenBefore) === comparableFen(issue.fenBefore) &&
    (review.uci === issue.uci || review.san === issue.san)
  );
}

function reviewForAnalysisEntry(report: AnalysisReport, entry: AnalysisHistoryEntry, preferredReviewId?: string) {
  const preferred = preferredReviewId ? report.moveReviews.find(review => review.id === preferredReviewId) : undefined;
  if (preferred) {
    const sameBefore = entry.fenBefore && comparableFen(preferred.fenBefore) === comparableFen(entry.fenBefore);
    const sameAfter = entry.fen && comparableFen(preferred.fenAfter) === comparableFen(entry.fen);
    const sameMove = entry.uci ? preferred.uci === entry.uci : entry.san ? preferred.san === entry.san : true;
    if (sameBefore || sameAfter || sameMove) return preferred;
  }
  return report.moveReviews.find(review => {
    const sameBefore = entry.fenBefore && comparableFen(review.fenBefore) === comparableFen(entry.fenBefore);
    const sameAfter = entry.fen && comparableFen(review.fenAfter) === comparableFen(entry.fen);
    const sameMove = entry.uci ? review.uci === entry.uci : entry.san ? review.san === entry.san : true;
    return (sameBefore && sameMove) || sameAfter;
  });
}

function buildGameTimeline(game: GameSummary, reviews: MoveReview[]): GameTimelineMove[] {
  const source = new Chess();
  try {
    source.loadPgn(game.pgn, { strict: false });
  } catch {
    return [];
  }
  const replay = new Chess();
  return source.history({ verbose: true }).flatMap((move, index) => {
    const fenBefore = replay.fen();
    const uci = `${move.from}${move.to}${move.promotion || ""}`;
    const review = reviews.find(item => item.fenBefore === fenBefore && item.uci === uci);
    const played = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!played) return [];
    return [{
      ply: index + 1,
      moveNumber: Math.ceil((index + 1) / 2),
      san: played.san,
      uci,
      color: played.color,
      fenBefore,
      fenAfter: replay.fen(),
      lastMove: { from: played.from, to: played.to },
      review,
    }];
  });
}

function nextMoveAfterReview(game: GameSummary, review: MoveReview, timeline = buildGameTimeline(game, [])): GameTimelineMove | null {
  const playedIndex = timeline.findIndex(move =>
    comparableFen(move.fenBefore) === comparableFen(review.fenBefore) &&
    move.uci === review.uci
  );
  if (playedIndex < 0) return null;
  return timeline[playedIndex + 1] || null;
}

type AnalysisHistoryEntry = {
  fen: string;
  fenBefore?: string;
  uci?: string;
  lastMove?: { from: string; to: string };
  san?: string;
  side?: "w" | "b";
  moveNumber?: number;
};

function buildAnalysisHistory(start?: ShellAnalysisStart | null): AnalysisHistoryEntry[] {
  if (!start?.gamePgn) return [{ fen: start?.fen || new Chess().fen() }];
  try {
    const source = new Chess();
    source.loadPgn(start.gamePgn, { strict: false });
    const moves = source.history({ verbose: true });
    const replay = new Chess();
    const entries: AnalysisHistoryEntry[] = [{ fen: replay.fen(), san: "Start", moveNumber: 0 }];
    for (const [index, move] of moves.entries()) {
      const fenBefore = replay.fen();
      const uci = `${move.from}${move.to}${move.promotion || ""}`;
      const played = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (!played) break;
      entries.push({
        fen: replay.fen(),
        fenBefore,
        uci,
        lastMove: { from: move.from, to: move.to },
        san: move.san,
        side: played.color,
        moveNumber: Math.ceil((index + 1) / 2),
      });
    }
    return entries.length ? entries : [{ fen: start.fen }];
  } catch {
    return [{ fen: start?.fen || new Chess().fen() }];
  }
}

function findHistoryIndex(history: AnalysisHistoryEntry[], fen?: string) {
  if (!fen) return 0;
  const target = comparableFen(fen);
  const index = history.findIndex(entry => comparableFen(entry.fen) === target);
  return index >= 0 ? index : 0;
}

function comparableFen(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function parseFen(fen: string) {
  const board = (fen || new Chess().fen()).split(" ")[0];
  const ranks = board.split("/");
  if (ranks.length !== 8) return parseFenRows(new Chess().fen().split(" ")[0]);
  const parsed = parseFenRows(board);
  return parsed.every(row => row.length === 8) ? parsed : parseFenRows(new Chess().fen().split(" ")[0]);
}

function parseFenRows(board: string) {
  return board.split("/").map(rank => {
    const row: Array<string | null> = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else if (/^[prnbqkPRNBQK]$/.test(ch)) {
        row.push(ch);
      }
    }
    return row;
  });
}

function squareCenterPct(square: string, flipped: boolean) {
  const file = "abcdefgh".indexOf(square[0]);
  const rank = Number(square[1]);
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank - 1 : 8 - rank;
  return { x: col * 12.5 + 6.25, y: row * 12.5 + 6.25 };
}

function sideToMove(fen: string) {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function phaseAbbrev(phase: Phase) {
  return phase === "opening" ? "OPN" : phase === "middlegame" ? "MID" : "END";
}

function visualConsequenceCopy(review: MoveReview, issue?: MoveIssue | null) {
  if (issue?.explanation) return issue.explanation.replace(/\.$/, "");
  const loss = reviewLossCp(review);
  if (loss >= 250) return "Major consequence";
  if (loss >= 120) return "Position slipped";
  if (loss >= 50) return "Small edge lost";
  return "Pattern to review";
}

function reviewLossCp(review: MoveReview) {
  if (typeof review.engineEvalLoss === "number") return Math.max(0, review.engineEvalLoss);
  if (typeof review.engineEvalBefore === "number" && typeof review.engineEvalAfter === "number") {
    const playerSign = review.color === "white" ? 1 : -1;
    return Math.max(0, (review.engineEvalBefore - review.engineEvalAfter) * playerSign);
  }
  return Math.max(0, review.severity * 45);
}

function formatReviewLoss(review: MoveReview) {
  const loss = reviewLossCp(review);
  if (!loss || loss <= 0) return "0.0";
  if (isMateLikeCp(loss) || isMateLikeCp(review.engineEvalAfter) || review.engineLines?.some(line => typeof line.mate === "number")) return "-M";
  return `-${Math.max(0.1, loss / 100).toFixed(loss >= 1000 ? 0 : 1)}`;
}

function isMateLikeCp(value?: number) {
  return typeof value === "number" && Math.abs(value) >= MATE_CP_THRESHOLD;
}

function formatUci(uci?: string) {
  if (!uci || !/^[a-h][1-8][a-h][1-8]/.test(uci)) return "";
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ""}`;
}

function formatMoveSan(fen: string, uci?: string) {
  if (!fen || !uci || !/^[a-h][1-8][a-h][1-8]/.test(uci)) return "";
  try {
    const board = new Chess(fen);
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return move?.san || formatUci(uci);
  } catch {
    return formatUci(uci);
  }
}

function formatPrincipalVariation(pv?: string) {
  const moves = (pv || "").split(" ").filter(Boolean).slice(0, 7);
  if (!moves.length) return "...";
  return moves.map(formatUci).filter(Boolean).join(" ");
}

function formatCp(evalCp?: number, mate?: number) {
  if (typeof mate === "number") return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (typeof evalCp !== "number") return "...";
  if (isMateLikeCp(evalCp)) return evalCp > 0 ? "+M" : "-M";
  return `${evalCp >= 0 ? "+" : ""}${(evalCp / 100).toFixed(1)}`;
}

function playerVsOpponent(game?: GameSummary) {
  if (!game) return "Pattern_Coach vs Opponent";
  const headers = gameHeaders(game.pgn);
  const white = headers.White || (game.color === "white" ? "Pattern_Coach" : game.opponent || "Opponent");
  const black = headers.Black || (game.color === "black" ? "Pattern_Coach" : game.opponent || "Opponent");
  return `${white} vs ${black}`;
}

function gameHeaders(pgn: string) {
  const headers: Record<string, string> = {};
  for (const line of pgn.split(/\r?\n/)) {
    const match = line.match(/^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/);
    if (match) headers[match[1]] = match[2];
  }
  return headers;
}

function formatGameDate(endTime?: number) {
  return endTime ? new Date(endTime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "PGN";
}

function formatRelativeGameDate(endTime?: number) {
  if (!endTime) return "PGN";
  const days = Math.max(0, Math.floor((Date.now() - endTime * 1000) / 86_400_000));
  if (days <= 0) return "today";
  if (days < 14) return `${days}d ago`;
  return formatGameDate(endTime);
}

function cleanDisplayName(name: string) {
  const cleaned = name.trim();
  if (!cleaned || cleaned.toLowerCase() === "sample") return "Chess player";
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}...` : cleaned;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function todayShortLabel() {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "short" });
  const month = now.toLocaleDateString(undefined, { month: "short" });
  return `${weekday} · ${month} ${now.getDate()}`;
}

function syncLabel(syncMeta?: SyncMeta) {
  if (syncMeta?.status === "error") return "sync needs retry";
  if (!syncMeta?.lastSyncedAt) return syncMeta?.message || "synced";
  const diff = Math.max(1, Math.round((Date.now() - syncMeta.lastSyncedAt) / 60_000));
  return `synced ${diff < 60 ? `${diff}m` : `${Math.round(diff / 60)}h`} ago`;
}

function friendlySyncMessage(message?: string) {
  if (!message) return "";
  if (/worker failed/i.test(message)) return "Sync needs retry.";
  return message;
}
