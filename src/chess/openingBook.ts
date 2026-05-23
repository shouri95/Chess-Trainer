import { Chess, Move } from "chess.js";

export type OpeningVerdict = {
  eco: string;
  name: string;
  variation?: string;
  reason: string;
};

type BookPosition = {
  eco: string;
  name: string;
  variation?: string;
  moves: string[];
  accepted: string[];
  reason: string;
};

const bookPositions: BookPosition[] = [
  {
    eco: "C55",
    name: "Italian Game",
    variation: "Two Knights Defense",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"],
    accepted: ["Ng5", "d3", "d4", "Nc3", "O-O"],
    reason: "Ng5 is a main theoretical try in the Two Knights Defense, not an automatic mistake.",
  },
  {
    eco: "C57",
    name: "Italian Game",
    variation: "Fried Liver Attack",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5"],
    accepted: ["Nxf7", "d4"],
    reason: "Nxf7 is the critical Fried Liver continuation and must be handled as opening theory.",
  },
  {
    eco: "C58",
    name: "Italian Game",
    variation: "Two Knights, Main Line",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5"],
    accepted: ["Bb5+", "d3", "Be2"],
    reason: "These are established continuations after Black chooses Na5 against Ng5.",
  },
  {
    eco: "C54",
    name: "Italian Game",
    variation: "Giuoco Piano",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
    accepted: ["c3", "d3", "O-O", "Nc3", "b4"],
    reason: "The Italian is plan-based; several quiet developing moves are fully playable.",
  },
  {
    eco: "C54",
    name: "Italian Game",
    variation: "Classical Center",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6"],
    accepted: ["d4", "d3", "O-O"],
    reason: "Both d4 and d3 are normal Italian structures here.",
  },
  {
    eco: "C50",
    name: "Italian Game",
    variation: "Quiet Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    accepted: ["Bc5", "Nf6", "Be7", "d6"],
    reason: "Black has multiple standard Italian setups in this position.",
  },
  {
    eco: "B20",
    name: "Sicilian Defense",
    moves: ["e4", "c5"],
    accepted: ["Nf3", "Nc3", "c3", "d4", "g3"],
    reason: "These are normal anti-Sicilian and Open Sicilian continuations.",
  },
  {
    eco: "B30",
    name: "Sicilian Defense",
    variation: "Open Sicilian",
    moves: ["e4", "c5", "Nf3"],
    accepted: ["d6", "Nc6", "e6", "g6", "a6"],
    reason: "Black's major Sicilian systems are all theoretically valid here.",
  },
  {
    eco: "B50",
    name: "Sicilian Defense",
    variation: "Open Sicilian",
    moves: ["e4", "c5", "Nf3", "d6"],
    accepted: ["d4", "Bb5+", "Nc3", "c3"],
    reason: "Both Open Sicilian and Moscow/anti-Sicilian setups are established theory.",
  },
  {
    eco: "C60",
    name: "Ruy Lopez",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    accepted: ["a6", "Nf6", "d6", "Bc5", "f5"],
    reason: "These are main Ruy Lopez defenses, not opening-principle mistakes.",
  },
  {
    eco: "C65",
    name: "Ruy Lopez",
    variation: "Berlin / Morphy",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    accepted: ["Ba4", "Bxc6"],
    reason: "Retreating or exchanging on c6 are both standard Ruy Lopez choices.",
  },
  {
    eco: "D06",
    name: "Queen's Gambit",
    moves: ["d4", "d5", "c4"],
    accepted: ["e6", "dxc4", "c6", "Nf6", "Nc6"],
    reason: "Queen's Gambit Accepted, Declined, Slav, and Chigorin setups are all normal.",
  },
  {
    eco: "D10",
    name: "Slav Defense",
    moves: ["d4", "d5", "c4", "c6"],
    accepted: ["Nf3", "Nc3", "e3", "cxd5"],
    reason: "These are common Slav move orders and should be protected as theory.",
  },
  {
    eco: "E60",
    name: "King's Indian Defense",
    moves: ["d4", "Nf6", "c4", "g6"],
    accepted: ["Nc3", "Nf3", "g3", "f3"],
    reason: "Fianchetto and classical King's Indian structures are normal opening play.",
  },
  {
    eco: "A40",
    name: "Modern Defense",
    moves: ["d4", "g6"],
    accepted: ["c4", "e4", "Nf3", "g3"],
    reason: "The Modern Defense often starts with an early g-pawn move by design.",
  },
  {
    eco: "C30",
    name: "King's Gambit",
    moves: ["e4", "e5", "f4"],
    accepted: ["exf4", "Bc5", "d5", "Nf6"],
    reason: "f4 is the defining King's Gambit move rather than a king-shelter error.",
  },
  {
    eco: "A00",
    name: "English Opening",
    moves: ["c4"],
    accepted: ["e5", "Nf6", "c5", "e6", "g6"],
    reason: "The English begins with a c-pawn advance and has several standard replies.",
  },
  {
    eco: "A04",
    name: "Reti Opening",
    moves: ["Nf3"],
    accepted: ["d5", "Nf6", "c5", "g6", "e6"],
    reason: "Flexible Reti move orders should not be penalized for delayed central occupation.",
  },
];

const positions = new Map<string, BookPosition[]>();

for (const entry of bookPositions) {
  const chess = new Chess();
  let valid = true;
  for (const san of entry.moves) {
    const move = chess.move(san);
    if (!move) {
      valid = false;
      break;
    }
  }
  if (valid) {
    const key = positionKey(chess.fen());
    positions.set(key, [...(positions.get(key) || []), entry]);
  } else {
    console.warn(`Skipped invalid opening book line: ${entry.name}${entry.variation ? ` - ${entry.variation}` : ""}`);
  }
}

export function openingVerdictForMove(fen: string, move: Pick<Move, "san"> | string): OpeningVerdict | null {
  const entries = positions.get(positionKey(fen));
  if (!entries?.length) return null;
  const san = normalizeSan(typeof move === "string" ? sanForUciMove(fen, move) || move : move.san);
  const match = entries.find(entry => entry.accepted.some(candidate => normalizeSan(candidate) === san));
  if (!match) return null;
  return {
    eco: match.eco,
    name: match.name,
    variation: match.variation,
    reason: match.reason,
  };
}

export function sanForUciMove(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

function positionKey(fen: string) {
  const [pieces, turn, castling, ep] = fen.split(" ");
  const normalizedCastling = castling && castling !== "-"
    ? [...castling].sort((a, b) => "KQkq".indexOf(a) - "KQkq".indexOf(b)).join("")
    : "-";
  return [pieces, turn, normalizedCastling, ep || "-"].join(" ");
}

function normalizeSan(san: string) {
  return san.replace(/[+#?!]/g, "");
}
