"use client";

import { something } from "./does-not-exist-anywhere";

export function Broken() {
  return <span>{String(something)}</span>;
}
