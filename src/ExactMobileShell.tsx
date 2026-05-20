import { ReactNode, useState } from "react";
import { BookOpen, Grid2X2, Skull, Sword, User } from "lucide-react";
import type { AnalysisReport, MoveIssue, MoveReview, MoveReviewQuality } from "./analysis/patterns";
import ChessBoard from "./components/ChessBoard";

type AppView = "dashboard" | "games" | "mistakes" | "drill" | "analysis";

type ExactShellProps = {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  analysisReturnView: Exclude<AppView, "analysis">;
  report: AnalysisReport;
  username: string;
  openProfile: () => void;
  gamesPanel: ReactNode;
  labPanel: ReactNode;
  drillPanel: ReactNode;
  analysisPanel: ReactNode;
  startDrill: (quality?: MoveReviewQuality | "all", patternId?: string, issue?: MoveIssue) => void;
  openAnalysis: (fen?: string, flipped?: boolean, title?: string, context?: { gamePgn?: string }) => void;
  openGame: (gameId: number) => void;
};

const demoFen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w kq - 4 7";
const detailFen = "r1bqk2r/pppp1ppp/2n2n2/2b1p2Q/2B1P3/5N2/PPPP1PPP/RNB1K2R b kq - 3 6";

export function ExactPatternCoachMobile({
  activeView,
  setActiveView,
  analysisReturnView,
  report,
  username,
  openProfile,
  gamesPanel,
  labPanel,
  drillPanel,
  analysisPanel,
  startDrill,
  openAnalysis,
  openGame,
}: ExactShellProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <main className="exact-phone-shell">
      <TopChrome />
      <div className="exact-phone-scroll">
        {activeView === "dashboard" && (
          <ExactDashboard
            report={report}
            username={username}
            openGame={openGame}
            train={() => startDrill("all")}
            review={() => setActiveView("mistakes")}
          />
        )}
        {activeView === "mistakes" && (
          <section className="exact-route-panel exact-route-lab">
            {labPanel}
          </section>
        )}
        {activeView === "games" && (
          <section className="exact-route-panel exact-route-games">
            {gamesPanel}
          </section>
        )}
        {activeView === "drill" && (
          <section className="exact-drill-panel-wrap">
            {drillPanel}
          </section>
        )}
        {activeView === "analysis" && (
          <section className="exact-route-panel exact-route-analysis">
            {analysisPanel || <ExactAnalysis back={() => setActiveView("mistakes")} analyze={() => openAnalysis(demoFen, false, "Analysis Board")} />}
          </section>
        )}
      </div>
      <ExactTabBar activeView={activeView} analysisReturnView={analysisReturnView} setActiveView={setActiveView} openProfile={openProfile} />
      {detailOpen && (
        <ExactMistakeDetail
          close={() => setDetailOpen(false)}
          train={() => {
            setDetailOpen(false);
            startDrill("all");
          }}
          analyze={() => {
            setDetailOpen(false);
            openAnalysis(detailFen, false, "Bc4 · Reply ignored");
            setActiveView("analysis");
          }}
        />
      )}
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
  error,
}: {
  username: string;
  setUsername: (value: string) => void;
  connectAndSync: () => void;
  loading: boolean;
  openProfile: () => void;
  loadSample: () => void;
  error: string;
}) {
  return (
    <main className="exact-phone-shell exact-import">
      <div className="exact-import-brand">
        <div className="exact-mark" />
        <span>Pattern <i>Coach</i></span>
      </div>
      <div className="exact-import-copy">
        <div className="exact-eyebrow">Connect</div>
        <h1>Bring in <i className="you">your games.</i> We'll find the shapes you keep <i className="them">misreading.</i></h1>
      </div>
      <div className="exact-import-form">
        <label className="exact-form-row">
          <span>Chess.com username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="magrios" />
        </label>
        <div className="exact-import-grid">
          <div className="exact-form-row"><span>Range</span><strong>3 months</strong></div>
          <div className="exact-form-row"><span>Cap</span><strong>200 games</strong></div>
        </div>
        <div className="exact-form-row">
          <span>Time controls</span>
          <div className="exact-time-chips">
            <b>Bullet</b><b>Blitz</b><b className="active">Rapid</b><b>Daily</b>
          </div>
        </div>
        {error && <div className="exact-inline-error">{error}</div>}
      </div>
      <div className="exact-import-actions">
        <button onClick={connectAndSync} disabled={loading || !username.trim()}>{loading ? "Syncing..." : "Sync games"} <span>↗</span></button>
        <div>
          <button onClick={openProfile}>Paste PGN</button>
          <span>·</span>
          <button onClick={loadSample}>Try sample</button>
        </div>
      </div>
    </main>
  );
}

function TopChrome() {
  return (
    <header className="exact-top">
      <span>9:41</span>
      <div className="exact-status-icons" aria-hidden="true"><i /><i /><i /><b /></div>
    </header>
  );
}

function ExactDashboard({ report, username, openGame, train, review }: {
  report: AnalysisReport;
  username: string;
  openGame: (gameId: number) => void;
  train: () => void;
  review: () => void;
}) {
  const topPattern = report.summaries[0];
  const trainable = report.moveReviews
    .filter((review) => isTrainableReview(review.quality))
    .slice()
    .sort((a, b) => (b.engineEvalLoss ?? b.severity * 45) - (a.engineEvalLoss ?? a.severity * 45))
    .slice(0, 3);
  const latestGames = report.gameSummaries
    .slice()
    .sort((a, b) => (b.endTime ?? b.id) - (a.endTime ?? a.id))
    .slice(0, 3);
  const displayName = cleanDisplayName(username || report.username);
  const topTitle = topPattern?.title || "Your games are mapped";
  const topTotal = topPattern?.total || trainable.length;
  const reviewedMoves = Math.max(1, report.moveReviews.length);
  const cleanPct = Math.round(((report.moveQuality.good + report.moveQuality.excellent) / reviewedMoves) * 100);
  return (
    <section className="exact-screen">
      <PageHead eyebrow={report.games ? `${report.games} games synced` : "Ready"} title={<span>Hi, <i>{displayName}</i></span>} right={<CircleButton>↗</CircleButton>} />
      <section className="exact-hero-card">
        <div className="exact-hero-row">
          <Pill tone="you">Main weakness</Pill>
          <span className="exact-stable"><i /> STABLE</span>
        </div>
        <MobileReplyOrbit title={topTitle} total={topTotal} />
        <div className="exact-metrics">
          <Metric label="Spots" value={String(topTotal)} />
          <Metric label="Review" value={String(Math.max(2, Math.ceil(trainable.length / 18)))} unit="min" />
          <Metric label="Clean" value={String(cleanPct)} unit="%" />
        </div>
        <div className="exact-action-row">
          <button className="exact-primary" onClick={train}>Train · 4m</button>
          <button className="exact-secondary" onClick={review}>Review</button>
        </div>
      </section>
      <section className="exact-list-section">
        <div className="exact-section-line">
          <span>Top examples</span>
          <b>{trainable.length} of {topTotal || trainable.length} ›</b>
        </div>
        {trainable.map((item) => (
          <button className="exact-example-row" key={item.id} onClick={review}>
            <span>{item.moveNumber}.</span>
            <div><strong>{item.san}</strong><small>vs. {item.opponent || "Opponent"}</small></div>
            <b>{formatReviewLoss(item)}</b>
            <i>›</i>
          </button>
        ))}
        {!trainable.length && (
          <button className="exact-example-row" onClick={review}>
            <span>0.</span>
            <div><strong>No issues yet</strong><small>Sync or import more games</small></div>
            <b>0.0</b>
            <i>›</i>
          </button>
        )}
      </section>
      <section className="exact-list-section">
        <div className="exact-section-line">
          <span>Latest games</span>
          <b>{report.gameSummaries.length} total ›</b>
        </div>
        {latestGames.map((game) => (
          <button className="exact-example-row" key={game.id} onClick={() => openGame(game.id)}>
            <span>{game.result[0]?.toUpperCase() || "G"}</span>
            <div><strong>{game.opponent || "Unknown opponent"}</strong><small>{[game.timeClass, game.opening || formatGameDate(game.endTime)].filter(Boolean).join(" · ")}</small></div>
            <b>{game.issues}</b>
            <i>›</i>
          </button>
        ))}
      </section>
    </section>
  );
}

function isTrainableReview(quality: MoveReviewQuality) {
  return quality === "blunder" || quality === "miss" || quality === "mistake" || quality === "inaccuracy";
}

function formatReviewLoss(review: MoveReview) {
  const loss = review.engineEvalLoss ?? review.severity * 45;
  if (!loss || loss <= 0) return "0.0";
  return `-${Math.max(0.1, loss / 100).toFixed(loss >= 1000 ? 0 : 1)}`;
}

function formatGameDate(endTime?: number) {
  return endTime ? new Date(endTime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "PGN";
}

function cleanDisplayName(name: string) {
  const cleaned = name.trim();
  if (!cleaned || cleaned.toLowerCase() === "sample") return "You";
  return cleaned.length > 12 ? `${cleaned.slice(0, 12)}…` : cleaned;
}

function MobileReplyOrbit({ title, total }: { title: string; total: number }) {
  return (
    <div className="exact-orbit">
      <svg viewBox="0 0 320 240" aria-hidden="true">
        <ellipse cx="160" cy="120" rx="140" ry="100" />
        <ellipse cx="160" cy="120" rx="95" ry="70" />
        <path className="you" d="M 55 50 Q 160 30 265 50" />
        <path className="them" d="M 265 50 Q 290 180 195 205" />
        <path className="idea" d="M 125 205 Q 30 175 55 50" />
      </svg>
      <div className="exact-orbit-title">You move <i>before</i> seeing the reply.</div>
      <OrbitNode className="you" label="You" move="Bc4" />
      <OrbitNode className="them" label="Them" move="Nxh5" />
      <OrbitNode className="idea" label="Idea" move="Nf3" />
      <div className="exact-orbit-caption">{title} · {total} spots</div>
    </div>
  );
}

function OrbitNode({ className, label, move }: { className: string; label: string; move: string }) {
  return (
    <div className={`exact-orbit-node ${className}`}>
      <div><i /><strong>{move}</strong></div>
      <span>{label}</span>
    </div>
  );
}

function ExactMistakeLab({ openDetail, drill }: {
  report: AnalysisReport;
  openDetail: () => void;
  drill: () => void;
}) {
  const rows = [
    { phase: "OPN", ply: "14.", san: "Bc4", title: "Reply ignored", consequence: "Nxh5 wins the queen" },
    { phase: "OPN", ply: "11.", san: "Qh4", title: "Queen out too early", consequence: "g3 traps and wins" },
    { phase: "MID", ply: "17.", san: "Nxe5", title: "Loose piece left", consequence: "Qxe5 hangs the knight" },
    { phase: "MID", ply: "22.", san: "f3?", title: "King shelter weakened", consequence: "Allows Qh4 attack" },
    { phase: "END", ply: "34.", san: "Kf2", title: "Passive king", consequence: "Loses tempo in pawn race" },
  ];
  const chips = [
    { title: "Reply ignored", total: 6 },
    { title: "Loose pieces", total: 4 },
    { title: "King safety", total: 3 },
    { title: "Endgame", total: 1 },
  ];
  return (
    <section className="exact-screen">
      <PageHead eyebrow="14 spots · 4 patterns" title="Mistake Lab" right={<CircleButton>⚙</CircleButton>} />
      <div className="exact-chip-rail">
        {chips.map((summary, index) => (
          <button key={summary.title} className={index === 0 ? "active" : ""}><i /> {summary.title}<b>{summary.total}</b></button>
        ))}
      </div>
      <div className="exact-lab-list">
        {rows.map((row) => (
          <button key={row.san} className="exact-mistake-row" onClick={openDetail}>
            <span>{row.phase}</span>
            <div>
              <p><small>{row.ply}</small><strong>{row.san}</strong><i /><b>{row.title.toUpperCase()}</b></p>
              <em>{row.consequence}</em>
            </div>
            <mark>›</mark>
          </button>
        ))}
      </div>
      <button className="exact-floating-action" onClick={drill}>Train shown</button>
    </section>
  );
}

function ExactMistakeDetail({ close, train, analyze }: { close: () => void; train: () => void; analyze: () => void }) {
  return (
    <div className="exact-sheet-backdrop">
      <section className="exact-detail-sheet">
        <button className="exact-grabber" onClick={close} aria-label="Close mistake details" />
        <div className="exact-detail-top">
          <button onClick={close}>‹</button>
          <span>03 / 14</span>
          <button>⋯</button>
        </div>
        <div className="exact-detail-title">
          <div><Pill tone="them">Blunder</Pill><Pill tone="you" subtle>Reply ignored</Pill></div>
          <h2>You moved <code>Bc4</code> without seeing <code className="them">Nxh5</code>.</h2>
        </div>
        <div className="exact-detail-board">
          <ChessBoard fen={detailFen} flipped={false} arrows={[{ from: "f6", to: "h5", color: "rgba(226,96,74,0.75)" }]} size={361} />
        </div>
        <div className="exact-segmented">
          <button>Your move</button><button className="active">Their reply</button><button>Idea</button>
        </div>
        <div className="exact-move-map">
          <div><span>You</span><strong>Bc4</strong></div>
          <div><span>Them</span><strong>Nxh5</strong></div>
          <div><span>Idea</span><strong>Nf3</strong></div>
          <p>The knight on f6 was already eyeing h5. Defend the queen before the bishop move.</p>
        </div>
        <div className="exact-action-row">
          <button className="exact-primary" onClick={train}>Train this position</button>
          <button className="exact-secondary" onClick={analyze}>↗</button>
        </div>
      </section>
    </div>
  );
}

function ExactGames({ openGame }: { report: AnalysisReport; openGame: (id: number) => void }) {
  const games = [
    { id: 1, opp: "NightForge_99", result: "L", tc: "10+0", opening: "Italian, Two Knights", date: "Today", mistakes: 3 },
    { id: 2, opp: "otto77", result: "W", tc: "15+10", opening: "Queen's Gambit Decl.", date: "Today", mistakes: 1 },
    { id: 3, opp: "larsa", result: "L", tc: "10+0", opening: "Caro-Kann Advance", date: "Yesterday", mistakes: 2 },
    { id: 4, opp: "m_g_b", result: "D", tc: "15+10", opening: "Ruy Lopez, Berlin", date: "Yesterday", mistakes: 0 },
    { id: 5, opp: "kasparov_fan", result: "W", tc: "10+0", opening: "Scotch Game", date: "May 18", mistakes: 1 },
    { id: 6, opp: "pearlsnap", result: "L", tc: "10+0", opening: "Sicilian, Najdorf", date: "May 18", mistakes: 4 },
  ];
  return (
    <section className="exact-screen">
      <PageHead eyebrow="74 games · last 30 days" title="Games" right={<CircleButton>↗</CircleButton>} />
      <div className="exact-chip-rail exact-games-filters">
        {["All", "With mistakes", "White", "Black"].map((item, index) => <button key={item} className={index === 1 ? "active" : ""}>{item}</button>)}
      </div>
      <div className="exact-games-list">
        {games.map((game, index) => (
          <button key={game.id} onClick={() => openGame(game.id)} className="exact-game-row">
            <span className={game.result === "W" ? "win" : game.result === "D" ? "draw" : "loss"}>{game.result}</span>
            <div><strong>{game.opp || `Opponent ${index + 1}`}</strong><small>{game.opening} · {game.tc} · {game.date}</small></div>
            <b>{game.mistakes || "—"}</b>
            <i>›</i>
          </button>
        ))}
      </div>
    </section>
  );
}

function ExactAnalysis({ back, analyze }: { back: () => void; analyze: () => void }) {
  return (
    <section className="exact-screen exact-analysis-screen">
      <div className="exact-detail-top">
        <button onClick={back}>‹</button>
        <span>vs NightForge · #9</span>
        <button>⇅</button>
      </div>
      <div className="exact-analysis-head">
        <div><span>Evaluation</span><strong>+0.4</strong></div>
        <div><span>Depth</span><strong>24</strong></div>
      </div>
      <div className="exact-analysis-board">
        <div className="exact-eval-bar"><i /></div>
        <ChessBoard fen={demoFen} flipped={false} lastMove={{ from: "f1", to: "c4" }} size={313} />
      </div>
      <div className="exact-analysis-controls"><button>⏮</button><button>◀</button><button>▶</button><button>⏭</button></div>
      <div className="exact-variations">
        <header><span>Variations</span><b>SF 16</b></header>
        {[
          ["+0.4", "O-O d6 h3 a6 a4 Ba7"],
          ["+0.3", "c3 d6 h3 a6 Bb3 Ba7"],
          ["+0.2", "d3 h6 c3 d6 h3 a6"],
        ].map(([score, pv]) => <p key={pv}><b>{score}</b><span>{pv}</span></p>)}
      </div>
    </section>
  );
}

function ExactTabBar({ activeView, analysisReturnView, setActiveView, openProfile }: { activeView: AppView; analysisReturnView: Exclude<AppView, "analysis">; setActiveView: (view: AppView) => void; openProfile: () => void }) {
  const tabs = [
    ["dashboard", "Home", Grid2X2],
    ["games", "Games", BookOpen],
    ["mistakes", "Lab", Skull],
    ["drill", "Drill", Sword],
  ] as const;
  return (
    <nav className="exact-tabbar">
      {tabs.map(([id, label, Icon]) => (
        <button key={id} className={activeView === id || (activeView === "analysis" && analysisReturnView === id) ? "active" : ""} onClick={() => setActiveView(id)}>
          <Icon size={20} /><span>{label}</span>
        </button>
      ))}
      <button onClick={openProfile}><User size={20} /><span>Me</span></button>
    </nav>
  );
}

function PageHead({ eyebrow, title, right }: { eyebrow: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="exact-page-head">
      <div><div className="exact-eyebrow">{eyebrow}</div><h2>{title}</h2></div>
      {right}
    </div>
  );
}

function CircleButton({ children }: { children: ReactNode }) {
  return <button className="exact-circle">{children}</button>;
}

function Pill({ children, tone, subtle }: { children: ReactNode; tone: "you" | "them" | "idea"; subtle?: boolean }) {
  return <span className={`exact-pill ${tone} ${subtle ? "subtle" : ""}`}>{children}</span>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className="exact-metric"><span>{label}</span><strong>{value}</strong>{unit && <em>{unit}</em>}</div>;
}
