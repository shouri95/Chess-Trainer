import React from "react";

interface PieceVectorProps {
  type: string;
}

export function PieceVector({ type }: PieceVectorProps) {
  const normType = type.toLowerCase();
  
  if (normType === "p") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="30" r="16" />
        <path d="M38 47h24l9 28H29l9-28Z" />
        <path d="M25 80h50v10H25z" />
      </svg>
    );
  }
  if (normType === "n") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M28 82h48v9H24l4-9Z" />
        <path d="M35 77c2-18 8-30 23-40l-13-5 13-17 19 15c-3 18-10 32-25 47H35Z" />
        <path d="M48 22l-16 8 5-18 11 10Z" />
        <circle cx="61" cy="33" r="4" />
      </svg>
    );
  }
  if (normType === "b") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M26 82h48v9H26z" />
        <path d="M35 76h30l8-11H27l8 11Z" />
        <path d="M50 13c16 12 22 25 22 38 0 16-10 24-22 24s-22-8-22-24c0-13 6-26 22-38Z" />
        <path d="M52 27l-14 26" className="piece-cut" />
      </svg>
    );
  }
  if (normType === "r") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M24 82h52v9H24z" />
        <path d="M32 41h36v38H32z" />
        <path d="M27 17h13v10h9V17h13v10h11v18H27V17Z" />
      </svg>
    );
  }
  if (normType === "q") {
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
  // King
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M23 82h54v9H23z" />
      <path d="M32 73h36l6-37-16 15-8-24-8 24-16-15 6 37Z" />
      <path d="M45 10h10v16H45z" />
      <path d="M38 16h24v8H38z" />
    </svg>
  );
}
