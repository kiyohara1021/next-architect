"use client";

import { useState } from "react";
import { renderChart } from "../lib/render-chart";

// The large dependency is not imported here — it arrives one hop away,
// which is exactly the case ARCH004 exists to explain.
export function Panel() {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(!open)}>{open ? renderChart() : "open"}</button>
  );
}
