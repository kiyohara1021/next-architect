"use server";

import { Chart } from "corpus-huge-lib";

// A Server Action is a boundary: Next.js replaces this import with an RPC
// reference, so corpus-huge-lib never reaches the browser.
export async function submit(): Promise<string> {
  void Chart;
  return "ok";
}
