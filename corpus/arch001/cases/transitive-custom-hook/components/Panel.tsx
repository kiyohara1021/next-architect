"use client";

import { useToggle } from "../lib/useToggle";

export function Panel() {
  const [open] = useToggle(false);
  return <span>{open ? "open" : "closed"}</span>;
}
