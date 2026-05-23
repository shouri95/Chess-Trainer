import { useCallback, useEffect, useState } from "react";
import {
  engineService,
  StockfishEngineService,
  type AnalyzePositionRequest,
  type EvaluatePositionOptions,
  type EngineEvaluation,
  type EngineLine,
  type MoveEngineResult,
} from "./EngineService";

export type { EngineEvaluation, EngineLine, MoveEngineResult };

export function useStockfish(engine: StockfishEngineService = engineService) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    engine.init()
      .then(() => {
        if (!cancelled) {
          setReady(true);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReady(false);
          setError(err instanceof Error ? err.message : "Stockfish failed to start.");
        }
      });
    return () => { cancelled = true; };
  }, [engine]);

  const evaluate = useCallback(async (fen: string, depth?: number): Promise<string> => {
    try {
      setError("");
      return await engine.evaluate(fen, depth);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return "";
    }
  }, [engine]);

  const evaluatePosition = useCallback(async (fen: string, depth?: number, options?: EvaluatePositionOptions): Promise<EngineEvaluation> => {
    try {
      setError("");
      return await engine.evaluatePosition(fen, depth, options);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { fen, bestMove: "", pv: "", depth: 0, confidence: "failed", error: err.message };
      }
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return { fen, bestMove: "", pv: "", depth: 0, confidence: "failed", error: message };
    }
  }, [engine]);

  const analyzePosition = useCallback(async (request: AnalyzePositionRequest): Promise<EngineEvaluation> => {
    try {
      setError("");
      return await engine.analyzePosition(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return { fen: request.fen, bestMove: "", pv: "", depth: 0, confidence: "failed", error: message };
    }
  }, [engine]);

  const analyzeMovePair = useCallback(async (request: {
    fenBefore: string;
    playedUci: string;
    depth: number;
    multipv: number;
    signal?: AbortSignal;
  }): Promise<MoveEngineResult> => {
    try {
      setError("");
      return await engine.analyzeMovePair(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish move analysis failed.");
      throw err;
    }
  }, [engine]);

  const compareMoves = useCallback(async (fen: string, move: string, depth?: number) => {
    try {
      setError("");
      return await engine.compareMoves(fen, move, depth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish comparison failed.");
      return { bestMove: "", evalLoss: 0 };
    }
  }, [engine]);

  return { ready, error, evaluate, evaluatePosition, analyzePosition, analyzeMovePair, compareMoves, engine };
}
