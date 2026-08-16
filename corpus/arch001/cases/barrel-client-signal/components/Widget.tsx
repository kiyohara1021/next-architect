"use client";

import { useClientThing } from "@/lib/utils";

export function Widget() {
  const [n] = useClientThing();
  return <span>{n}</span>;
}
