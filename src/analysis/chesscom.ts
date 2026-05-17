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

export type ChessComProfile = {
  username: string;
  name?: string;
  avatar?: string;
  title?: string;
  followers?: number;
  country?: string;
  joined?: number;
  last_online?: number;
  status?: string;
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

function cleanUsername(username: string) {
  const user = username.trim().replace(/^@/, "").toLowerCase();
  if (user && !/^[a-z0-9_-]{2,50}$/.test(user)) {
    throw new Error("Enter a valid Chess.com username.");
  }
  return user;
}

export async function fetchChessComProfile(username: string): Promise<ChessComProfile> {
  const user = cleanUsername(username);
  if (!user) {
    throw new Error("Enter a Chess.com username first.");
  }

  const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`);
  if (response.status === 404) {
    throw new Error(`No public Chess.com profile was found for "${username}".`);
  }
  if (!response.ok) {
    throw new Error(`Chess.com returned ${response.status} while connecting.`);
  }

  return (await response.json()) as ChessComProfile;
}

export async function fetchChessComGames(
  username: string,
  monthLimit: number,
  timeClass: "all" | "rapid" | "blitz" | "bullet" | "daily",
  onProgress?: (progress: ImportProgress) => void,
  maxGames = Infinity,
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
  const selectedArchives = archiveData.archives.slice(-monthLimit).reverse();
  const games: ChessComGame[] = [];
  let done = 0;

  for (let batchStart = 0; batchStart < selectedArchives.length && games.length < maxGames; batchStart += 3) {
    const batch = selectedArchives.slice(batchStart, batchStart + 3);
    await Promise.all(batch.map(async (archiveUrl) => {
      if (games.length >= maxGames) return;
      const month = archiveUrl.split("/").slice(-2).join("/");
      onProgress?.({ label: `Importing ${month}`, done, total: selectedArchives.length });

      const response = await fetch(archiveUrl);
      if (response.status === 429) {
        throw new Error("Chess.com rate-limited the import. Try fewer months or wait a minute.");
      }
      if (!response.ok) {
        throw new Error(`Chess.com returned ${response.status} while reading ${month}.`);
      }

      const data = (await response.json()) as GamesResponse;
      const matchingGames = data.games.filter((game) => {
          const isStandardChess = !game.rules || game.rules === "chess";
          const hasPgn = Boolean(game.pgn);
          const matchesTimeClass = timeClass === "all" || game.time_class === timeClass;
          return isStandardChess && hasPgn && matchesTimeClass;
        });
      games.push(...matchingGames);
      if (games.length > maxGames) {
        games.sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
        games.length = maxGames;
      }
      done += 1;
      onProgress?.({ label: `Imported ${month}`, done, total: selectedArchives.length });
    }));
  }

  onProgress?.({ label: "Import complete", done: selectedArchives.length, total: selectedArchives.length });
  return games.sort((a, b) => (a.end_time ?? 0) - (b.end_time ?? 0));
}

export function splitPgnText(pgnText: string) {
  return pgnText
    .trim()
    .split(/\r?\n(?=\[Event\s)/g)
    .map((pgn) => pgn.trim())
    .filter(Boolean);
}
