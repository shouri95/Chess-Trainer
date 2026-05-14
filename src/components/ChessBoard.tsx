import { useMemo, useState, useCallback } from "react";

interface Props {
  fen?: string;
  flipped?: boolean;
  highlightSquares?: Record<string, string>;
  arrows?: Array<{ from: string; to: string; color: string }>;
  onMove?: (from: string, to: string) => void;
  interactive?: boolean;
  size?: number;
}

const files = "abcdefgh";

function fenToPieces(fen?: string) {
  if (!fen) return Array(64).fill(null);
  const board = fen.split(" ")[0];
  const squares: Array<{ type: string; color: string } | null> = [];
  for (const char of board) {
    if (char === "/") continue;
    if (/\d/.test(char)) {
      squares.push(...Array(Number(char)).fill(null));
    } else {
      squares.push({
        type: char.toLowerCase(),
        color: char === char.toLowerCase() ? "b" : "w",
      });
    }
  }
  return squares.slice(0, 64);
}

const unicodePieces: Record<string, string> = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

function sqFromIndex(index: number, flipped: boolean): string {
  if (flipped) {
    const f = 7 - (index % 8);
    const r = 8 - Math.floor(index / 8);
    return `${files[f]}${r}`;
  }
  const f = files[index % 8];
  const r = 8 - Math.floor(index / 8);
  return `${f}${r}`;
}

export default function ChessBoard({ fen, flipped = false, highlightSquares, arrows, onMove, interactive, size = 480 }: Props) {
  const pieces = useMemo(() => fenToPieces(fen), [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const squareSize = Math.floor(size / 8);

  const displayPieces = useMemo(() => {
    if (!flipped) return pieces;
    return [...pieces].reverse();
  }, [pieces, flipped]);

  const handleClick = useCallback((index: number) => {
    if (!interactive || !onMove) return;
    const sq = sqFromIndex(index, flipped);
    if (!selected) {
      setSelected(sq);
    } else {
      if (selected !== sq) onMove(selected, sq);
      setSelected(null);
    }
  }, [interactive, onMove, selected, flipped]);

  const isLight = (index: number) => (Math.floor(index / 8) + (index % 8)) % 2 === 0;

  return (
    <div
      style={{
        position: "relative",
        width: "fit-content",
        padding: "6px",
        background: "#0a0a0a",
        borderRadius: "16px",
        border: "2px solid #333",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5), inset 0 0 20px rgba(200,168,78,0.04)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(8, ${squareSize}px)`,
          gap: 0,
          borderRadius: "10px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {displayPieces.map((piece, index) => {
          const isL = isLight(index);
          const sq = sqFromIndex(index, flipped);
          const highlight = highlightSquares?.[sq];
          return (
            <div
              key={sq}
              onClick={() => handleClick(index)}
              style={{
                width: squareSize,
                height: squareSize,
                background: highlight || (isL ? "#e8dcc8" : "#5a7d6a"),
                display: "grid",
                placeItems: "center",
                cursor: interactive ? "pointer" : "default",
                position: "relative",
                transition: "background 0.15s",
              }}
            >
              {piece && (
                <span
                  style={{
                    fontSize: squareSize * 0.78,
                    lineHeight: 1,
                    color: piece.color === "w" ? "#f0ede9" : "#1a1a1a",
                    textShadow:
                      piece.color === "w"
                        ? "0 1px 3px rgba(0,0,0,0.6)"
                        : "0 1px 2px rgba(255,255,255,0.2)",
                    userSelect: "none",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {unicodePieces[`${piece.color}${piece.type.toUpperCase()}`]}
                </span>
              )}
              {/* Selected highlight */}
              {selected && selected === sq && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: "3px solid rgba(200,168,78,0.9)",
                    pointerEvents: "none",
                  }}
                />
              )}
              {/* Rank coords */}
              {index % 8 === 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    left: 4,
                    fontSize: squareSize * 0.16,
                    fontWeight: 800,
                    color: isL ? "#5a7d6a" : "#e8dcc8",
                    opacity: 0.9,
                    pointerEvents: "none",
                  }}
                >
                  {8 - Math.floor(index / 8)}
                </span>
              )}
              {/* File coords */}
              {index >= 56 && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 4,
                    right: 6,
                    fontSize: squareSize * 0.16,
                    fontWeight: 800,
                    color: isL ? "#5a7d6a" : "#e8dcc8",
                    opacity: 0.9,
                    pointerEvents: "none",
                  }}
                >
                  {sq[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
