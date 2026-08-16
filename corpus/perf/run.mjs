#!/usr/bin/env node
/**
 * ~1k-module performance gate (docs/09).
 *
 * - Generates corpus/perf/1k-modules/ if missing
 * - Cold check (cache wiped) must finish ≤ PERF_COLD_MS (default 30000)
 * - Warm check (cache intact) must finish ≤ PERF_WARM_MS (default 5000)
 *
 * Usage: pnpm corpus:perf
 * Env:   PERF_COLD_MS, PERF_WARM_MS, PERF_MODULE_COUNT, PERF_FORCE_GENERATE=1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runCheck } from "../../packages/cli/dist/check.js";
import { generatePerfCorpus } from "./generate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "1k-modules");
const CACHE_DIR = path.join(ROOT, ".next-architect");

const COLD_LIMIT = Number(process.env.PERF_COLD_MS ?? 30_000);
const WARM_LIMIT = Number(process.env.PERF_WARM_MS ?? 5_000);
const FORCE = process.env.PERF_FORCE_GENERATE === "1" || process.argv.includes("--force");

function rmCache() {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}

/**
 * @param {string} label
 * @param {{ noCache?: boolean }} opts
 */
async function timedCheck(label, opts = {}) {
  const start = performance.now();
  const outcome = await runCheck({
    root: ROOT,
    format: "json",
    noCache: opts.noCache ?? false,
  });
  const ms = performance.now() - start;
  return { label, ms, outcome };
}

const gen = generatePerfCorpus({ force: FORCE });
console.log(
  gen.skipped
    ? `Using existing corpus: ${gen.moduleFiles} modules at ${gen.outDir}`
    : `Generated corpus: ${gen.moduleFiles} modules at ${gen.outDir}`,
);

if (gen.moduleFiles < (gen.target ?? 1000) * 0.95) {
  console.error(
    `FAIL: module count ${gen.moduleFiles} is below ~95% of target ${gen.target}`,
  );
  process.exit(1);
}

rmCache();
const cold = await timedCheck("cold", { noCache: false });
const warm = await timedCheck("warm", { noCache: false });

const coldModules = cold.outcome.result.project.moduleCount;
const warmModules = warm.outcome.result.project.moduleCount;

const lines = [];
lines.push("1k-module performance gate (docs/09)");
lines.push("");
lines.push(`Corpus modules on disk: ${gen.moduleFiles}`);
lines.push(`Analyzed modules (cold): ${coldModules}`);
lines.push(`Analyzed modules (warm): ${warmModules}`);
lines.push("");
lines.push(
  `Cold check: ${cold.ms.toFixed(0)} ms (limit ${COLD_LIMIT} ms)${cold.ms <= COLD_LIMIT ? " OK" : " FAIL"}`,
);
lines.push(
  `Warm check: ${warm.ms.toFixed(0)} ms (limit ${WARM_LIMIT} ms)${warm.ms <= WARM_LIMIT ? " OK" : " FAIL"}`,
);
lines.push("");
lines.push(
  `Cold exit=${cold.outcome.exitCode} diagnostics=${cold.outcome.result.diagnostics.length}`,
);
lines.push(
  `Warm exit=${warm.outcome.exitCode} diagnostics=${warm.outcome.result.diagnostics.length}`,
);

console.log(lines.join("\n"));

let failed = false;
if (cold.outcome.exitCode === 2 && coldModules === 0) {
  console.error("Cold check failed to analyze project");
  failed = true;
}
if (coldModules < (gen.target ?? 1000) * 0.9) {
  console.error(
    `Analyzed module count too low: ${coldModules} (expected ~${gen.target})`,
  );
  failed = true;
}
if (cold.ms > COLD_LIMIT) {
  console.error(`Cold exceeded ${COLD_LIMIT} ms`);
  failed = true;
}
if (warm.ms > WARM_LIMIT) {
  console.error(`Warm exceeded ${WARM_LIMIT} ms`);
  failed = true;
}

if (failed) process.exit(1);
