import { useRef, useCallback, useEffect, useState } from "react";

export interface EngineEvaluation {
  fen: string;
  bestMove: string;
  evalCp?: number; // centipawns
  mate?: number; // mate in N (positive = white wins)
  pv: string;
  depth: number;
}

class StockfishEngine {
  private worker: Worker | null = null;
  private ready = false;
  private pending: Map<string, { resolve: Function; reject: Function }> = new Map();
  private initPromise: Promise<void> | null = null;

  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve) => {
      try {
        this.worker = new Worker("/stockfish.wasm.js");
        this.worker.onmessage = (e: MessageEvent<string>) => this.handleMessage(e.data);
        this.worker.onerror = () => {
          this.ready = false;
        };
        this.send("uci");
        this.send("setoption name Threads value 2");
        this.send("setoption name Hash value 128");
        this.send("isready");
        // Wait a moment for init
        setTimeout(() => {
          this.ready = true;
          resolve();
        }, 1500);
      } catch {
        resolve();
      }
    });
    return this.initPromise;
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private handleMessage(data: string) {
    const line = typeof data === "string" ? data : String(data);
    if (line.startsWith("bestmove")) {
      const parts = line.split(" ");
      const bestMove = parts[1];
      const pendingKey = parts[3] || "go";
      const cb = this.pending.get(pendingKey);
      if (cb) {
        cb.resolve({ bestMove });
        this.pending.delete(pendingKey);
      }
    }
  }

  async evaluate(fen: string, depth = 12): Promise<string> {
    await this.init();
    if (!this.worker || !this.ready) return "";
    return new Promise((resolve) => {
      const key = Date.now().toString();
      let bestMove = "";
      const handler = (e: MessageEvent<string>) => {
        const msg = typeof e.data === "string" ? e.data : String(e.data);
        if (msg.startsWith("bestmove")) {
          bestMove = msg.split(" ")[1] || "";
          this.worker!.removeEventListener("message", handler);
          resolve(bestMove);
        }
      };
      this.worker!.addEventListener("message", handler);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      // Timeout
      setTimeout(() => {
        this.worker!.removeEventListener("message", handler);
        resolve(bestMove);
      }, 3000);
    });
  }

  async compareMoves(fen: string, move: string, depth = 12): Promise<{ bestMove: string; evalLoss: number }> {
    await this.init();
    if (!this.worker || !this.ready) return { bestMove: "", evalLoss: 0 };
    return new Promise((resolve) => {
      let bestMove = "";
      const handler = (e: MessageEvent<string>) => {
        const msg = typeof e.data === "string" ? e.data : String(e.data);
        if (msg.startsWith("bestmove")) {
          bestMove = msg.split(" ")[1] || "";
          this.worker!.removeEventListener("message", handler);
          resolve({ bestMove, evalLoss: bestMove && bestMove !== move ? 1 : 0 });
        }
      };
      this.worker!.addEventListener("message", handler);
      setTimeout(() => {
        this.worker!.removeEventListener("message", handler);
        resolve({ bestMove, evalLoss: bestMove && bestMove !== move ? 1 : 0 });
      }, 3000);
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

const engine = new StockfishEngine();

export function useStockfish() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    engine.init().then(() => setReady(true));
    return () => engine.terminate();
  }, []);

  const evaluate = useCallback(async (fen: string, depth?: number): Promise<string> => {
    return engine.evaluate(fen, depth);
  }, []);

  const compareMoves = useCallback(async (fen: string, move: string, depth?: number) => {
    return engine.compareMoves(fen, move, depth);
  }, []);

  return { ready, evaluate, compareMoves, engine };
}
