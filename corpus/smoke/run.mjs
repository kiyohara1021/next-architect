#!/usr/bin/env node
/**
 * Real-project smoke for ARCH001 (docs/09 success: ≥1 meaningful finding, no noise).
 *
 * Uses a hand-written pinned App Router mini-app under corpus/smoke/mini-app/
 * (no create-next-app / no large clones). Asserts ARCH001 on the planted file
 * and zero ARCH001 on known-good client files.
 *
 * Usage: pnpm corpus:smoke
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../packages/cli/dist/check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULE_ID = "ARCH001";

/**
 * @typedef {{
 *   description?: string,
 *   root: string,
 *   assert: {
 *     plantedFile: string,
 *     minArch001OnPlanted: number,
 *     mustNotReportArch001: string[],
 *   },
 * }} SmokeManifest
 */

const manifestPath = path.join(__dirname, "manifest.json");
/** @type {SmokeManifest} */
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const root = path.join(__dirname, manifest.root);
if (!fs.existsSync(root)) {
  console.error(`Smoke app missing: ${root}`);
  process.exit(2);
}

const outcome = await runCheck({
  root,
  rules: [RULE_ID],
  format: "json",
  noCache: true,
});

if (outcome.exitCode === 2 && outcome.result.project.moduleCount === 0) {
  console.error("Smoke discovery/parse failed");
  console.error(outcome.output.split("\n")[0]);
  process.exit(2);
}

const findings = outcome.result.diagnostics.filter((d) => d.ruleId === RULE_ID);

/**
 * @param {string} rel
 * @param {import("@next-architect/core").Diagnostic} d
 */
function matchesFile(rel, d) {
  const abs = path.isAbsolute(d.file) ? d.file : path.join(root, d.file);
  const normalized = path.relative(root, abs).replace(/\\/g, "/");
  return normalized === rel.replace(/\\/g, "/");
}

const planted = findings.filter((d) =>
  matchesFile(manifest.assert.plantedFile, d),
);
const goodHits = manifest.assert.mustNotReportArch001.flatMap((rel) =>
  findings.filter((d) => matchesFile(rel, d)).map((d) => ({
    file: rel,
    severity: d.severity,
    message: d.message,
  })),
);

// docs/09 release condition: limitations is always emitted — in the JSON
// result and as a section of the human-readable report, including when there
// is nothing to disclose.
const pretty = await runCheck({ root, rules: [RULE_ID], ci: true, noCache: true });
const limitationsShown = /^Limitations$/m.test(pretty.output);
const limitationsInJson = Array.isArray(outcome.result.limitations);

const lines = [];
lines.push("ARCH001 real-project smoke (corpus/smoke/mini-app)");
lines.push("");
lines.push(
  `limitations always emitted: json=${limitationsInJson ? "ok" : "MISSING"} pretty=${limitationsShown ? "ok" : "MISSING"}`,
);
lines.push("");
lines.push(
  `Planted ${manifest.assert.plantedFile}: ${planted.length} ARCH001 (need ≥${manifest.assert.minArch001OnPlanted})`,
);
for (const d of planted) {
  lines.push(`  - ${d.severity}: ${d.message}`);
}
lines.push(
  `Known-good files must be clean: ${manifest.assert.mustNotReportArch001.join(", ")}`,
);
if (goodHits.length === 0) {
  lines.push("  ok (0 ARCH001 on known-good)");
} else {
  for (const h of goodHits) {
    lines.push(`  FP ${h.file} [${h.severity}] ${h.message}`);
  }
}
lines.push("");
lines.push(
  `Total ARCH001 in smoke app: ${findings.length} (modules=${outcome.result.project.moduleCount})`,
);

const report = lines.join("\n");
console.log(report);

let failed = false;
if (planted.length < manifest.assert.minArch001OnPlanted) {
  failed = true;
}
if (goodHits.length > 0) {
  failed = true;
}
if (!limitationsShown || !limitationsInJson) {
  failed = true;
}

if (failed) {
  process.exit(1);
}
