"use client";

import { useToggle } from "../lib/useToggle";

export function Panel() {
  const [open, toggle] = useToggle(false);
  return <button onClick={toggle}>{open ? "open" : "closed"}</button>;
}
