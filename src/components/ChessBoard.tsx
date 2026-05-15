import { useMemo, useState, useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Chess, Square } from "chess.js";
import { Search } from "lucide-react";

interface Props {
  fen?: string;
  flipped?: boolean;
  highlightSquares?: Record<string, string>;
  arrows?: Array<{ from: string; to: string; color?: string }>;
  lastMove?: { from: string; to: string };
  onMove?: (from: string, to: string, promotion?: string) => void;
  onGestureBack?: () => void;
  onGestureForward?: () => void;
  onAnalyze?: () => void;
  showToolbar?: boolean;
  interactive?: boolean;
  size?: number;
}

const files = "abcdefgh";
const promotionPieces = ["q", "r", "b", "n"];

type DragState = {
  from: string;
  piece: { color: "w" | "b"; type: string };
  x: number;
  y: number;
  startX: number;
  startY: number;
  squareSize: number;
  flipped: boolean;
  active: boolean;
};

type PromotionState = {
  from: string;
  to: string;
  color: "w" | "b";
};

function sqFromIndex(index: number, flipped: boolean): string {
  if (flipped) {
    const f = 7 - (index % 8);
    const r = Math.floor(index / 8) + 1;
    return `${files[f]}${r}`;
  }
  const f = files[index % 8];
  const r = 8 - Math.floor(index / 8);
  return `${f}${r}`;
}

export default function ChessBoard({ fen, flipped = false, highlightSquares, arrows, lastMove, onMove, onGestureBack, onGestureForward, onAnalyze, showToolbar = false, interactive, size = 480 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const suppressClickRef = useRef(false);
  const manualFlipRef = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(size + 16);
  const [localFlipped, setLocalFlipped] = useState(flipped);
  const [showCoords, setShowCoords] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<PromotionState | null>(null);
  const [shakeSquare, setShakeSquare] = useState<string | null>(null);
  const game = useMemo(() => {
    try { return new Chess(fen); } catch { return new Chess(); }
  }, [fen]);
  const boardFlipped = localFlipped;
  const squares = useMemo(() => {
    const board = game.board().flat();
    return boardFlipped ? board.slice().reverse() : board;
  }, [game, boardFlipped]);
  const [selected, setSelected] = useState<string | null>(null);
  const boardSize = Math.max(204, Math.min(size, availableWidth - 18));
  const squareSize = Math.floor(boardSize / 8);

  useEffect(() => {
    if (!manualFlipRef.current) setLocalFlipped(flipped);
  }, [flipped]);

  useEffect(() => {
    setSelected(null);
    setDrag(null);
    setPromotion(null);
    setHoverSquare(null);
  }, [fen]);

  useEffect(() => {
    const update = () => {
      const width = hostRef.current?.clientWidth;
      if (width) setAvailableWidth(width);
    };
    update();
    if (!hostRef.current || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width) setAvailableWidth(width);
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);
  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(game.moves({ square: selected as Square, verbose: true }).map(move => move.to));
  }, [game, selected]);

  const legalMoveInfo = useMemo(() => {
    if (!selected) return new Map<string, { capture: boolean; check: boolean }>();
    const map = new Map<string, { capture: boolean; check: boolean }>();
    for (const move of game.moves({ square: selected as Square, verbose: true })) {
      map.set(move.to, { capture: Boolean(move.captured), check: move.san.includes("+") || move.san.includes("#") });
    }
    return map;
  }, [game, selected]);

  const requestMove = useCallback((from: string, to: string, promotionChoice?: string) => {
    if (!interactive || !onMove) return false;
    const piece = game.get(from as Square);
    const legalMove = game.moves({ square: from as Square, verbose: true }).find(move => move.to === to);
    if (!piece || !legalMove) {
      setShakeSquare(from);
      window.setTimeout(() => setShakeSquare(null), 260);
      return false;
    }
    const needsPromotion = piece.type === "p" && (to.endsWith("8") || to.endsWith("1")) && !promotionChoice;
    if (needsPromotion) {
      setPromotion({ from, to, color: piece.color });
      return true;
    }
    onMove(from, to, promotionChoice || (piece.type === "p" && (to.endsWith("8") || to.endsWith("1")) ? "q" : undefined));
    setSelected(null);
    setPromotion(null);
    return true;
  }, [game, interactive, onMove]);

  const handleClick = useCallback((index: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!interactive || !onMove) return;
    const sq = sqFromIndex(index, boardFlipped);
    const piece = game.get(sq as Square);
    if (!selected) {
      if (piece?.color === game.turn()) setSelected(sq);
    } else {
      if (selected === sq) {
        setSelected(null);
        return;
      }
      if (legalTargets.has(sq)) {
        requestMove(selected, sq);
        setSelected(null);
      } else if (piece?.color === game.turn()) {
        setSelected(sq);
      } else {
        setShakeSquare(selected);
        window.setTimeout(() => setShakeSquare(null), 260);
      }
    }
  }, [interactive, onMove, selected, boardFlipped, game, legalTargets, requestMove]);

  const squareAtPoint = useCallback((clientX: number, clientY: number, snapshot?: Pick<DragState, "squareSize" | "flipped">) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const sizeAtPointerDown = snapshot?.squareSize ?? squareSize;
    const col = Math.floor((clientX - rect.left) / sizeAtPointerDown);
    const row = Math.floor((clientY - rect.top) / sizeAtPointerDown);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return sqFromIndex(row * 8 + col, snapshot?.flipped ?? boardFlipped);
  }, [boardFlipped, squareSize]);

  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>, sq: string) => {
    if (!interactive || !onMove) {
      gestureRef.current = { x: event.clientX, y: event.clientY, t: Date.now() };
      return;
    }
    const piece = game.get(sq as Square);
    setPromotion(null);
    if (piece?.color === game.turn()) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      setSelected(sq);
      setDrag({
        from: sq,
        piece: { color: piece.color, type: piece.type },
        x: event.clientX,
        y: event.clientY,
	        startX: event.clientX,
	        startY: event.clientY,
	        squareSize,
	        flipped: boardFlipped,
	        active: false,
	      });
      gestureRef.current = null;
    } else {
      gestureRef.current = { x: event.clientX, y: event.clientY, t: Date.now() };
    }
	  }, [game, interactive, onMove, squareSize, boardFlipped]);

  const handleGridPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    gestureRef.current = { x: event.clientX, y: event.clientY, t: Date.now() };
  }, []);

  const handleGridPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    setDrag(current => current ? { ...current, x: event.clientX, y: event.clientY, active: current.active || moved } : current);
    setHoverSquare(squareAtPoint(event.clientX, event.clientY, drag));
  }, [drag, squareAtPoint]);

  const handleGridPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      const target = squareAtPoint(event.clientX, event.clientY, drag);
      const didDrag = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
      suppressClickRef.current = true;
      setDrag(null);
      setHoverSquare(null);
      if (target && target !== drag.from && legalTargets.has(target)) {
        requestMove(drag.from, target);
      } else if (didDrag) {
        setShakeSquare(drag.from);
        window.setTimeout(() => setShakeSquare(null), 260);
      }
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }

    const start = gestureRef.current;
    gestureRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const dt = Date.now() - start.t;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.35 || dt > 850) return;
    if (dx > 0) onGestureBack?.();
    else onGestureForward?.();
  }, [drag, legalTargets, onGestureBack, onGestureForward, requestMove, squareAtPoint]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" && onGestureBack) {
      event.preventDefault();
      onGestureBack();
    }
    if (event.key === "ArrowRight" && onGestureForward) {
      event.preventDefault();
      onGestureForward();
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      manualFlipRef.current = true;
      setLocalFlipped(value => !value);
    }
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      setShowCoords(value => !value);
    }
    if (event.key === "Escape") {
      setSelected(null);
      setPromotion(null);
    }
  }, [onGestureBack, onGestureForward]);

  const isLight = (index: number) => (Math.floor(index / 8) + (index % 8)) % 2 === 0;
  const hasBoardControls = showToolbar && (interactive || onGestureBack || onGestureForward || onAnalyze);

  return (
    <div className="chessboard-host" ref={hostRef}>
      <div className="chessboard-wrap" style={{ width: boardSize + 16 }}>
        {hasBoardControls && (
          <div className="board-toolbar" aria-label="Board controls">
            {onGestureBack && <button type="button" onClick={onGestureBack} aria-label="Previous position">‹</button>}
            <button type="button" onClick={() => { manualFlipRef.current = true; setLocalFlipped(value => !value); }} aria-label="Flip board">↻</button>
            <button type="button" onClick={() => setShowCoords(value => !value)} aria-label="Toggle coordinates">{showCoords ? "C" : "·"}</button>
            {onGestureForward && <button type="button" onClick={onGestureForward} aria-label="Next position">›</button>}
            {onAnalyze && <button type="button" onClick={onAnalyze} aria-label="Analyze position">A</button>}
          </div>
        )}
        {onAnalyze && (
          <button type="button" className="board-analyze-button" onClick={onAnalyze} aria-label="Analyze position">
            <Search size={16} />
          </button>
        )}
        <div
          ref={gridRef}
          className="chessboard-grid"
          role="grid"
          aria-label="Chess board"
          style={{ gridTemplateColumns: `repeat(8, ${squareSize}px)`, width: squareSize * 8, height: squareSize * 8 }}
          tabIndex={interactive ? 0 : undefined}
          onKeyDown={handleKeyDown}
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onPointerCancel={() => { setDrag(null); setHoverSquare(null); }}
        >
          {squares.map((piece, index) => {
            const isL = isLight(index);
            const sq = sqFromIndex(index, boardFlipped);
            const highlight = highlightSquares?.[sq];
            const isSelected = selected === sq;
            const legalInfo = legalMoveInfo.get(sq);
            const isLegalTarget = Boolean(legalInfo);
            const isLastMove = lastMove?.from === sq || lastMove?.to === sq;
            const isDragSource = drag?.from === sq;
            const isHoverTarget = hoverSquare === sq && isLegalTarget;
            return (
              <div
                key={sq}
                onPointerDown={(event) => startDrag(event, sq)}
                onClick={() => handleClick(index)}
                className={[
                  "board-square",
                  isL ? "light" : "dark",
                  interactive ? "interactive" : "",
                  isSelected ? "selected" : "",
                  isLegalTarget ? "legal-target" : "",
                  legalInfo?.capture ? "legal-capture" : "",
                  legalInfo?.check ? "legal-check" : "",
                  isHoverTarget ? "drop-target" : "",
                  isLastMove ? "last-move" : "",
                  isDragSource ? "drag-source" : "",
                  shakeSquare === sq ? "shake" : "",
                ].filter(Boolean).join(" ")}
                role="gridcell"
                aria-label={`${sq}${piece ? `, ${piece.color === "w" ? "white" : "black"} ${accessiblePieceName(piece.type)}` : ", empty"}`}
                style={{ width: squareSize, height: squareSize, background: highlight }}
              >
                {!highlight && <span className="square-base" />}
                {piece && (
                  <span
                    className={`piece ${piece.color === "w" ? "white" : "black"}`}
                    aria-hidden="true"
                    style={{ width: squareSize * 0.76, height: squareSize * 0.76 }}
                  >
                    <PieceVector type={piece.type} />
                  </span>
                )}
                {isLegalTarget && <i className={legalInfo?.capture ? "capture-dot" : legalInfo?.check ? "check-dot" : "move-dot"} />}
                {showCoords && index % 8 === 0 && (
                  <span className="coord rank" style={{ fontSize: squareSize * 0.16 }}>
                    {sq[1]}
                  </span>
                )}
                {showCoords && index >= 56 && (
                  <span className="coord file" style={{ fontSize: squareSize * 0.16 }}>
                    {sq[0]}
                  </span>
                )}
              </div>
            );
          })}
          {arrows?.map((arrow, i) => <BoardArrow key={`${arrow.from}-${arrow.to}-${i}`} arrow={arrow} squareSize={squareSize} flipped={boardFlipped} />)}
          {drag && (
            <span
              className={`piece drag-ghost ${drag.piece.color === "w" ? "white" : "black"}`}
              style={{
                width: squareSize * 0.82,
                height: squareSize * 0.82,
	                transform: `translate(${drag.x - (gridRef.current?.getBoundingClientRect().left ?? 0) - drag.squareSize * 0.41}px, ${drag.y - (gridRef.current?.getBoundingClientRect().top ?? 0) - drag.squareSize * 0.41}px)`,
              }}
            >
              <PieceVector type={drag.piece.type} />
            </span>
          )}
          {promotion && (
            <div className={`promotion-picker ${promotion.color === "w" ? "white" : "black"}`} style={promotionStyle(promotion.to, squareSize, boardFlipped)}>
              {promotionPieces.map(pieceType => (
                <button
                  type="button"
                  key={pieceType}
                  onClick={() => requestMove(promotion.from, promotion.to, pieceType)}
                  aria-label={`Promote to ${pieceName(pieceType)}`}
                >
                  <span className={`piece ${promotion.color === "w" ? "white" : "black"}`}>
                    <PieceVector type={pieceType} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PieceVector({ type }: { type: string }) {
  if (type === "p") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="30" r="16" />
        <path d="M38 47h24l9 28H29l9-28Z" />
        <path d="M25 80h50v10H25z" />
      </svg>
    );
  }
  if (type === "n") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M28 82h48v9H24l4-9Z" />
        <path d="M35 77c2-18 8-30 23-40l-13-5 13-17 19 15c-3 18-10 32-25 47H35Z" />
        <path d="M48 22l-16 8 5-18 11 10Z" />
        <circle cx="61" cy="33" r="4" />
      </svg>
    );
  }
  if (type === "b") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M26 82h48v9H26z" />
        <path d="M35 76h30l8-11H27l8 11Z" />
        <path d="M50 13c16 12 22 25 22 38 0 16-10 24-22 24s-22-8-22-24c0-13 6-26 22-38Z" />
        <path d="M52 27l-14 26" className="piece-cut" />
      </svg>
    );
  }
  if (type === "r") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M24 82h52v9H24z" />
        <path d="M32 41h36v38H32z" />
        <path d="M27 17h13v10h9V17h13v10h11v18H27V17Z" />
      </svg>
    );
  }
  if (type === "q") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M23 82h54v9H23z" />
        <path d="M31 73h38l6-37-16 17-9-32-9 32-16-17 6 37Z" />
        <circle cx="25" cy="30" r="7" />
        <circle cx="50" cy="17" r="7" />
        <circle cx="75" cy="30" r="7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M23 82h54v9H23z" />
      <path d="M32 73h36l6-37-16 15-8-24-8 24-16-15 6 37Z" />
      <path d="M45 10h10v16H45z" />
      <path d="M38 16h24v8H38z" />
    </svg>
  );
}

function BoardArrow({ arrow, squareSize, flipped }: { arrow: { from: string; to: string; color?: string }; squareSize: number; flipped: boolean }) {
  const from = squareCenter(arrow.from, squareSize, flipped);
  const to = squareCenter(arrow.to, squareSize, flipped);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return (
    <div
      className="board-arrow"
      style={{
        width: Math.max(0, len - squareSize * 0.35),
        transform: `translate(${from.x}px, ${from.y}px) rotate(${angle}deg)`,
        background: arrow.color || "rgba(37, 99, 235, 0.62)",
        color: arrow.color || "rgba(37, 99, 235, 0.62)",
      }}
    />
  );
}

function squareCenter(square: string, squareSize: number, flipped: boolean) {
  const file = files.indexOf(square[0]);
  const rank = Number(square[1]);
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank - 1 : 8 - rank;
  return { x: col * squareSize + squareSize / 2, y: row * squareSize + squareSize / 2 };
}

function promotionStyle(square: string, squareSize: number, flipped: boolean) {
  const center = squareCenter(square, squareSize, flipped);
  const pickerWidth = squareSize;
  const left = Math.max(4, Math.min(squareSize * 8 - pickerWidth - 4, center.x - pickerWidth / 2));
  const top = center.y < squareSize * 4 ? center.y + squareSize * 0.55 : center.y - squareSize * 4.55;
  return {
    left,
    top: Math.max(4, Math.min(squareSize * 8 - squareSize * 4 - 4, top)),
    width: squareSize,
  };
}

function pieceName(type: string) {
  return type === "q" ? "queen" : type === "r" ? "rook" : type === "b" ? "bishop" : "knight";
}

function accessiblePieceName(type: string) {
  return type === "p" ? "pawn" :
    type === "n" ? "knight" :
    type === "b" ? "bishop" :
    type === "r" ? "rook" :
    type === "q" ? "queen" :
    "king";
}
