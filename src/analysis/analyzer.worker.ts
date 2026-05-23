import { ChessComGame } from "./chesscom";
import { analyzeChessComGames, analyzePgnText } from "./patterns";

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

const workerScope = self as unknown as WorkerScope;

type WorkerRequest =
  | {
      kind: "chesscom";
      username: string;
      games: ChessComGame[];
    }
  | {
      kind: "pgn";
      username: string;
      pgnText: string;
    };

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const payload = event.data;
    const report =
      payload.kind === "chesscom"
        ? await analyzeChessComGames(payload.username, payload.games)
        : await analyzePgnText(payload.username, payload.pgnText);
    workerScope.postMessage({ ok: true, report });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Analysis failed."
    });
  }
};
