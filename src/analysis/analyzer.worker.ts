import { ChessComGame } from "./chesscom";
import { analyzeChessComGames, analyzePgnText } from "./patterns";

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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const payload = event.data;
    const report =
      payload.kind === "chesscom"
        ? analyzeChessComGames(payload.username, payload.games)
        : analyzePgnText(payload.username, payload.pgnText);
    self.postMessage({ ok: true, report });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Analysis failed."
    });
  }
};
