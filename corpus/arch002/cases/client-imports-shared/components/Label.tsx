"use client";

import { formatName } from "../lib/format";

export function Label() {
  return <span>{formatName("ada")}</span>;
}
