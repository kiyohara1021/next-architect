"use client";

export function Clickable({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>Go</button>;
}
