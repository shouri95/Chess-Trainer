export type ChessComColor = {
  username: string;
  rating?: number;
  result?: string;
};

export type ChessComGame = {
  url: string;
  pgn: string;
  end_time?: number;
  time_class?: "daily" | "rapid" | "blitz" | "bullet";
  time_control?: string;
  rated?: boolean;
  rules?: string;
  eco?: string;
  accuracies?: {
    white?: number;
    black?: number;
  };
  white: ChessComColor;
  black: ChessComColor;
};

export type ImportProgress = {
  label: string;
  done: number;
  total: number;
};

type ArchiveResponse = {
  archives: string[];
};

type GamesResponse = {
  games: ChessComGame[];
};

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function cleanUsername(username: string) {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export async function fetchChessComGames(
  username: string,
  monthLimit: number,
  timeClass: "all" | "rapid" | "blitz" | "bullet" | "daily",
  onProgress?: (progress: ImportProgress) => void
) {
  const user = cleanUsername(username);
  if (!user) {
    throw new Error("Enter a Chess.com username first.");
  }

  onProgress?.({ label: "Finding monthly archives", done: 0, total: 1 });
  const archiveResponse = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);

  if (archiveResponse.status === 404) {
    throw new Error(`No public Chess.com profile was found for "${username}".`);
  }

  if (!archiveResponse.ok) {
    throw new Error(`Chess.com returned ${archiveResponse.status} while reading archives.`);
  }

  const archiveData = (await archiveResponse.json()) as ArchiveResponse;
  const selectedArchives = archiveData.archives.slice(-monthLimit);
  const games: ChessComGame[] = [];

  for (const [index, archiveUrl] of selectedArchives.entries()) {
    const month = archiveUrl.split("/").slice(-2).join("/");
    onProgress?.({ label: `Importing ${month}`, done: index, total: selectedArchives.length });

    const response = await fetch(archiveUrl);
    if (response.status === 429) {
      throw new Error("Chess.com rate-limited the import. Try fewer months or wait a minute.");
    }
    if (!response.ok) {
      throw new Error(`Chess.com returned ${response.status} while reading ${month}.`);
    }

    const data = (await response.json()) as GamesResponse;
    games.push(
      ...data.games.filter((game) => {
        const isStandardChess = !game.rules || game.rules === "chess";
        const hasPgn = Boolean(game.pgn);
        const matchesTimeClass = timeClass === "all" || game.time_class === timeClass;
        return isStandardChess && hasPgn && matchesTimeClass;
      })
    );

    await pause(280);
  }

  onProgress?.({ label: "Import complete", done: selectedArchives.length, total: selectedArchives.length });
  return games;
}

export function splitPgnText(pgnText: string) {
  return pgnText
    .trim()
    .split(/\n(?=\[Event\s)/g)
    .map((pgn) => pgn.trim())
    .filter(Boolean);
}
