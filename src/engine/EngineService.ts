import { Chess } from "chess.js";
import type { MoveReviewQuality } from "../analysis/patterns";

export type EngineConfidence = "book" | "high" | "medium" | "low" | "timeout" | "failed";

export type NormalizedEval = {
  cp?: number;
  mate?: number;
  wdl?: { win: number; draw: number; loss: number };
};

export interface EngineLine {
  multipv: number;
  bestMove: string;
  evalCp?: number;
  mate?: number;
  pv: string;
  depth: number;
}

export interface EngineEvaluation {
  fen: string;
  bestMove: string;
  evalCp?: number;
  mate?: number;
  pv: string;
  depth: number;
  nodes?: number;
  lines?: EngineLine[];
  confidence: EngineConfidence;
  error?: string;
}

export type AnalyzePositionRequest = {
  fen: string;
  depth: number;
  multipv: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type EvaluatePositionOptions = {
  multipv?: number;
  signal?: AbortSignal;
};

export type MoveEngineResult = {
  bestMove: string;
  playedMove: string;
  evalBefore: NormalizedEval;
  evalAfter: NormalizedEval;
  evalLossCp: number;
  depth: number;
  nodes?: number;
  multipv: EngineLine[];
  confidence: EngineConfidence;
};

export const DEFAULT_ENGINE_DEPTH = 12;
export const DEFAULT_ENGINE_MULTIPV = 4;
const ENGINE_CACHE_LIMIT = 300;

export function normalizeSearchEval(
  fen: string,
  score: Pick<EngineLine, "evalCp" | "mate">,
): NormalizedEval {
  const sideToMove = fen.split(/\s+/)[1] === "b" ? "b" : "w";
  const sign = sideToMove === "w" ? 1 : -1;
  return {
    cp: typeof score.evalCp === "number" ? score.evalCp * sign : undefined,
    mate: typeof score.mate === "number" ? score.mate * sign : undefined,
  };
}

export function scoreForColor(evaluation: NormalizedEval, color: "w" | "b") {
  const whiteScore = scoreForWhite(evaluation);
  return color === "w" ? whiteScore : -whiteScore;
}

const MATE_SCORE_OFFSET = 100_000;

function scoreForWhite(evaluation: NormalizedEval) {
  if (typeof evaluation.mate === "number") {
    return evaluation.mate > 0
      ? MATE_SCORE_OFFSET - Math.abs(evaluation.mate)
      : -MATE_SCORE_OFFSET + Math.abs(evaluation.mate);
  }
  return evaluation.cp ?? 0;
}

function isMateAgainstColor(evaluation: NormalizedEval, color: "w" | "b") {
  if (typeof evaluation.mate !== "number") return false;
  return color === "w" ? evaluation.mate < 0 : evaluation.mate > 0;
}

export function classifyMoveQuality({
  bestMove,
  playedMove,
  evalLossCp,
  evalBefore,
  evalAfter,
  playerColor,
  missedForcingMove = false,
  confidence = "high",
}: {
  bestMove: string;
  playedMove: string;
  evalLossCp: number;
  evalBefore: NormalizedEval;
  evalAfter: NormalizedEval;
  playerColor: "w" | "b";
  missedForcingMove?: boolean;
  confidence?: EngineConfidence;
}): MoveReviewQuality {
  if (confidence === "failed") return "good";
  const playerBefore = scoreForColor(evalBefore, playerColor);
  const playerAfter = scoreForColor(evalAfter, playerColor);
  const allowingMate = isMateAgainstColor(evalAfter, playerColor) && Math.abs(evalAfter.mate ?? 99) <= 3;
  const escapedMate = isMateAgainstColor(evalBefore, playerColor) && playerAfter > playerBefore;

  if (escapedMate) return "best";
  if (allowingMate || evalLossCp > 250 || playerAfter <= -99997) return "blunder";
  if (missedForcingMove && evalLossCp >= 60) return "miss";
  if (bestMove && sameMove(bestMove, playedMove)) return "best";
  if (evalLossCp <= 15) return "best";
  if (evalLossCp <= 50) return "good";
  if (evalLossCp <= 120) return "inaccuracy";
  if (evalLossCp <= 250) return "mistake";
  return "blunder";
}

export class StockfishEngineService {
  private worker: Worker | null = null;
  private ready = false;
  private failed = false;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, EngineEvaluation>();
  private inFlight = new Map<string, Promise<EngineEvaluation>>();

  init() {
    if (this.initPromise) return this.initPromise;
    this.failed = false;
    this.initPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(stockfishWorkerUrl());
        let uciReady = false;
        const uciProbe = setInterval(() => {
          if (!uciReady) this.send("uci");
        }, 250);
        const timeout = setTimeout(() => {
          cleanup();
          this.failed = true;
          this.resetWorker();
          reject(new Error("Stockfish did not finish initializing."));
        }, 90000);
        const cleanup = () => {
          clearTimeout(timeout);
          clearInterval(uciProbe);
          this.worker?.removeEventListener("message", handleMessage);
          this.worker?.removeEventListener("error", handleError);
        };
        const handleMessage = (event: MessageEvent<string>) => {
          const msg = typeof event.data === "string" ? event.data : String(event.data);
          if (msg === "uciok") {
            uciReady = true;
            this.send("setoption name Hash value 128");
            this.send(`setoption name MultiPV value ${DEFAULT_ENGINE_MULTIPV}`);
            this.send("isready");
          }
          if (msg === "readyok") {
            cleanup();
            this.ready = true;
            resolve();
          }
        };
        const handleError = () => {
          this.ready = false;
          this.failed = true;
          cleanup();
          this.resetWorker();
          reject(new Error("Stockfish failed to load."));
        };
        this.worker.addEventListener("message", handleMessage);
        this.worker.addEventListener("error", handleError);
        this.send("uci");
      } catch (error) {
        this.failed = true;
        this.resetWorker();
        reject(error instanceof Error ? error : new Error("Stockfish failed to start."));
      }
    });
    return this.initPromise;
  }

  async analyzePosition(request: AnalyzePositionRequest): Promise<EngineEvaluation> {
    const cacheKey = this.cacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;

    const run = this.enqueue(() => this.analyzePositionNow(request))
      .then(result => {
        if (result.confidence !== "failed" && result.depth > 0) {
          this.cache.set(cacheKey, result);
          this.trimCache();
        }
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, run);
    return run;
  }

  async evaluate(fen: string, depth = DEFAULT_ENGINE_DEPTH): Promise<string> {
    const result = await this.evaluatePosition(fen, depth);
    return result.bestMove;
  }

  async evaluatePosition(
    fen: string,
    depth = DEFAULT_ENGINE_DEPTH,
    optionsOrMultipv: EvaluatePositionOptions | number = DEFAULT_ENGINE_MULTIPV,
  ): Promise<EngineEvaluation> {
    const options = typeof optionsOrMultipv === "number"
      ? { multipv: optionsOrMultipv }
      : optionsOrMultipv;
    return this.analyzePosition({
      fen,
      depth,
      multipv: options.multipv ?? DEFAULT_ENGINE_MULTIPV,
      timeoutMs: Math.max(3500, depth * 450),
      signal: options.signal,
    });
  }

  async analyzeMovePair({
    fenBefore,
    playedUci,
    depth,
    multipv,
    signal,
  }: {
    fenBefore: string;
    playedUci: string;
    depth: number;
    multipv: number;
    signal?: AbortSignal;
  }): Promise<MoveEngineResult> {
    const before = await this.analyzePosition({
      fen: fenBefore,
      depth,
      multipv,
      timeoutMs: Math.max(3500, depth * 500),
      signal,
    });
    const board = new Chess(fenBefore);
    const played = board.move({
      from: playedUci.slice(0, 2),
      to: playedUci.slice(2, 4),
      promotion: playedUci[4],
    });
    if (!played) throw new Error("The played move is not legal in the source position.");
    const after = await this.analyzePosition({
      fen: board.fen(),
      depth,
      multipv,
      timeoutMs: Math.max(3500, depth * 500),
      signal,
    });
    const playerColor = fenBefore.split(/\s+/)[1] === "b" ? "b" : "w";
    const evalBefore: NormalizedEval = { cp: before.evalCp, mate: before.mate };
    const evalAfter: NormalizedEval = { cp: after.evalCp, mate: after.mate };
    const evalLossCp = Math.max(0, scoreForColor(evalBefore, playerColor) - scoreForColor(evalAfter, playerColor));
    const confidence = before.confidence === "timeout" || after.confidence === "timeout"
      ? "timeout"
      : before.confidence === "failed" || after.confidence === "failed"
        ? "failed"
        : before.depth >= depth && after.depth >= depth
          ? "high"
          : before.depth >= Math.floor(depth * 0.75)
            ? "medium"
            : "low";

    return {
      bestMove: before.bestMove,
      playedMove: playedUci,
      evalBefore,
      evalAfter,
      evalLossCp,
      depth: Math.min(before.depth, after.depth),
      nodes: before.nodes,
      multipv: before.lines ?? [],
      confidence,
    };
  }

  async compareMoves(fen: string, move: string, depth = DEFAULT_ENGINE_DEPTH): Promise<{ bestMove: string; evalLoss: number }> {
    const result = await this.analyzeMovePair({ fenBefore: fen, playedUci: move, depth, multipv: DEFAULT_ENGINE_MULTIPV });
    return { bestMove: result.bestMove, evalLoss: result.evalLossCp };
  }

  terminate() {
    this.resetWorker();
  }

  retry() {
    this.resetWorker();
    return this.init();
  }

  private resetWorker() {
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.failed = false;
    this.initPromise = null;
    this.queue = Promise.resolve();
    this.inFlight.clear();
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private cacheKey(request: Pick<AnalyzePositionRequest, "fen" | "depth" | "multipv">) {
    return `${request.depth}:${request.multipv}:${request.fen}`;
  }

  private trimCache() {
    while (this.cache.size > ENGINE_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) return;
      this.cache.delete(oldest);
    }
  }

  private async analyzePositionNow(request: AnalyzePositionRequest): Promise<EngineEvaluation> {
    if (request.signal?.aborted) throw new DOMException("Analysis was cancelled.", "AbortError");
    assertSafeFen(request.fen);
    await this.init();
    if (!this.worker || !this.ready || this.failed) {
      throw new Error("Stockfish is unavailable.");
    }
    return new Promise((resolve, reject) => {
      let bestMove = "";
      let rawEvalCp: number | undefined;
      let rawMate: number | undefined;
      let pv = "";
      let reachedDepth = 0;
      let nodes: number | undefined;
      const lines = new Map<number, EngineLine>();
      let settled = false;
      let timedOut = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(searchTimeout);
        request.signal?.removeEventListener("abort", abort);
        this.worker?.removeEventListener("message", handler);
        this.worker?.removeEventListener("error", workerError);
        const sortedLines = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
        const primary = sortedLines[0];
        const normalizedPrimary = primary
          ? { cp: primary.evalCp, mate: primary.mate }
          : normalizeSearchEval(request.fen, { evalCp: rawEvalCp, mate: rawMate });
        resolve({
          fen: request.fen,
          bestMove: bestMove || primary?.bestMove || pv.split(" ")[0] || "",
          evalCp: normalizedPrimary.cp,
          mate: normalizedPrimary.mate,
          pv: primary?.pv ?? pv,
          depth: primary?.depth ?? reachedDepth,
          nodes,
          lines: sortedLines,
          confidence: timedOut ? "timeout" : (reachedDepth >= request.depth ? "high" : reachedDepth >= Math.floor(request.depth * 0.75) ? "medium" : "low"),
        });
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(searchTimeout);
        request.signal?.removeEventListener("abort", abort);
        this.worker?.removeEventListener("message", handler);
        this.worker?.removeEventListener("error", workerError);
        reject(error);
      };

      const workerError = () => {
        this.resetWorker();
        fail(new Error("Stockfish worker crashed. Try the analysis again."));
      };

      const abort = () => {
        this.send("stop");
        fail(new DOMException("Analysis was cancelled.", "AbortError"));
      };
      const searchTimeout = setTimeout(() => {
        timedOut = true;
        this.send("stop");
        finish();
      }, request.timeoutMs);

      const handler = (e: MessageEvent<string>) => {
        const msg = typeof e.data === "string" ? e.data : String(e.data);
        if (msg.startsWith("info ")) {
          const depthMatch = msg.match(/\bdepth\s+(\d+)/);
          const multipvMatch = msg.match(/\bmultipv\s+(\d+)/);
          const cpMatch = msg.match(/\bscore cp\s+(-?\d+)/);
          const mateMatch = msg.match(/\bscore mate\s+(-?\d+)/);
          const pvMatch = msg.match(/\bpv\s+(.+)$/);
          const nodesMatch = msg.match(/\bnodes\s+(\d+)/);
          if (depthMatch) reachedDepth = Number(depthMatch[1]);
          if (nodesMatch) nodes = Number(nodesMatch[1]);
          if (cpMatch) rawEvalCp = Number(cpMatch[1]);
          if (mateMatch) rawMate = Number(mateMatch[1]);
          if (pvMatch) {
            pv = pvMatch[1];
            const multipv = multipvMatch ? Number(multipvMatch[1]) : 1;
            const normalized = normalizeSearchEval(request.fen, {
              evalCp: cpMatch ? Number(cpMatch[1]) : undefined,
              mate: mateMatch ? Number(mateMatch[1]) : undefined,
            });
            lines.set(multipv, {
              multipv,
              bestMove: pvMatch[1].split(" ")[0] || "",
              evalCp: normalized.cp,
              mate: normalized.mate,
              pv: pvMatch[1],
              depth: depthMatch ? Number(depthMatch[1]) : reachedDepth,
            });
          }
        }
        if (msg.startsWith("bestmove")) {
          bestMove = msg.split(" ")[1] || "";
          finish();
        }
      };

      request.signal?.addEventListener("abort", abort, { once: true });
      this.worker!.addEventListener("message", handler);
      this.worker!.addEventListener("error", workerError);
      this.send(`setoption name MultiPV value ${request.multipv}`);
      this.send(`position fen ${request.fen}`);
      this.send(`go depth ${request.depth}`);
    });
  }
}

function sameMove(a: string, b: string) {
  const left = normalizeUci(a);
  const right = normalizeUci(b);
  if (!left || !right) return false;
  return left === right;
}

function normalizeUci(move: string) {
  const match = move.trim().toLowerCase().match(/^([a-h][1-8][a-h][1-8][qrbn]?)/);
  return match?.[1] || "";
}

export const engineService = new StockfishEngineService();

function stockfishWorkerUrl() {
  if (typeof window === "undefined") {
    return "/stockfish-18-lite-single.js";
  }
  // Use document.baseURI when available; avoids SSR failures from querySelector.
  const base = typeof document !== "undefined" && document.baseURI
    ? document.baseURI
    : window.location.origin;
  return new URL("stockfish-18-lite-single.js", base).toString();
}

function assertSafeFen(fen: string) {
  if (/[\r\n]/.test(fen)) {
    throw new Error("Invalid FEN: line breaks are not allowed.");
  }
  try {
    new Chess(fen);
  } catch {
    throw new Error("Invalid FEN.");
  }
}
