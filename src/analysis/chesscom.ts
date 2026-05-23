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

async function fetchChessCom(url: string) {
  let lastRateLimit: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response) {
      if (lastRateLimit) return lastRateLimit;
      throw new Error("Chess.com request failed.");
    }
    if (response.status !== 429 || attempt === 2) return response;
    lastRateLimit = response;
    const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : 750 * 2 ** attempt;
    await new Promise(resolve => globalThis.setTimeout(resolve, retryAfterMs));
  }
  return fetch(url, { cache: "no-store" });
}

export async function fetchChessComProfile(username: string): Promise<ChessComProfile> {
  const user = cleanUsername(username);
  if (!user) {
    throw new Error("Enter a Chess.com username first.");
  }

  const response = await fetchChessCom(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`);
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
  const archiveResponse = await fetchChessCom(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);

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
    const batchGames = await Promise.all(batch.map(async (archiveUrl) => {
      const month = archiveUrl.split("/").slice(-2).join("/");
      onProgress?.({ label: `Importing ${month}`, done, total: selectedArchives.length });

      const response = await fetchChessCom(archiveUrl);
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
      done += 1;
      onProgress?.({ label: `Imported ${month}`, done, total: selectedArchives.length });
      return matchingGames;
    }));
    games.push(...batchGames.flat());
    if (games.length > maxGames) {
      const newest = games
        .slice()
        .sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0))
        .slice(0, maxGames);
      games.length = 0;
      games.push(...newest);
    }
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
