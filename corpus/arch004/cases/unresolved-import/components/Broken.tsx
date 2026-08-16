"use client";

import { something } from "does-not-exist-anywhere-pkg";

export function Broken() {
  return <span>{String(something)}</span>;
}
