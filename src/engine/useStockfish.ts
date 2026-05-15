import { useCallback, useEffect, useState } from "react";
import {
  engineService,
  type AnalyzePositionRequest,
  type EngineEvaluation,
  type EngineLine,
  type MoveEngineResult,
} from "./EngineService";

export type { EngineEvaluation, EngineLine, MoveEngineResult };

export function useStockfish() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    engineService.init()
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
  }, []);

  const evaluate = useCallback(async (fen: string, depth?: number): Promise<string> => {
    try {
      setError("");
      return await engineService.evaluate(fen, depth);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return "";
    }
  }, []);

  const evaluatePosition = useCallback(async (fen: string, depth?: number): Promise<EngineEvaluation> => {
    try {
      setError("");
      return await engineService.evaluatePosition(fen, depth);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return { fen, bestMove: "", pv: "", depth: 0, confidence: "failed", error: message };
    }
  }, []);

  const analyzePosition = useCallback(async (request: AnalyzePositionRequest): Promise<EngineEvaluation> => {
    try {
      setError("");
      return await engineService.analyzePosition(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stockfish evaluation failed.";
      setError(message);
      return { fen: request.fen, bestMove: "", pv: "", depth: 0, confidence: "failed", error: message };
    }
  }, []);

  const analyzeMovePair = useCallback(async (request: {
    fenBefore: string;
    playedUci: string;
    depth: number;
    multipv: number;
    signal?: AbortSignal;
  }): Promise<MoveEngineResult> => {
    try {
      setError("");
      return await engineService.analyzeMovePair(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish move analysis failed.");
      throw err;
    }
  }, []);

  const compareMoves = useCallback(async (fen: string, move: string, depth?: number) => {
    try {
      setError("");
      return await engineService.compareMoves(fen, move, depth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish comparison failed.");
      return { bestMove: "", evalLoss: 0 };
    }
  }, []);

  return { ready, error, evaluate, evaluatePosition, analyzePosition, analyzeMovePair, compareMoves, engine: engineService };
}
