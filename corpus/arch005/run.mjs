#!/usr/bin/env node
/**
 * ARCH005 local corpus FP gate (docs/09–10).
 *
 * Runs `runCheck` (same pipeline as `next-architect check`) against synthetic
 * App Router mini-apps under corpus/arch005/cases/, classifies findings vs
 * manifest expectations, and fails on false positives for should-not-report.
 *
 * Usage: pnpm corpus:arch005
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../packages/cli/dist/check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULE_ID = "ARCH005";

/** @typedef {"should-report" | "should-not-report" | "known"} Expectation */

/**
 * @typedef {{ id: string, expectation: Expectation, notes?: string }} CorpusCase
 * @typedef {{ ruleId: string, cases: CorpusCase[] }} Manifest
 */

const manifestPath = path.join(__dirname, "manifest.json");
/** @type {Manifest} */
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.ruleId !== RULE_ID) {
  console.error(`Expected ruleId ${RULE_ID}, got ${manifest.ruleId}`);
  process.exit(2);
}

/**
 * @param {import("@next-architect/core").Diagnostic[]} diagnostics
 */
function arch005Findings(diagnostics) {
  return diagnostics.filter((d) => d.ruleId === RULE_ID && !d.suppressed);
}

let failed = false;
let falsePositives = 0;
let truePositives = 0;
let trueNegatives = 0;
/** @type {string[]} */
const lines = [];

lines.push(`ARCH005 corpus FP gate (${manifest.cases.length} cases)`);
lines.push("");

for (const c of manifest.cases) {
  const root = path.join(__dirname, "cases", c.id);
  if (!fs.existsSync(root)) {
    lines.push(`FAIL  ${c.id}: case directory missing`);
    failed = true;
    continue;
  }

  const outcome = await runCheck({
    root,
    rules: [RULE_ID],
    format: "json",
    noCache: true,
  });

  if (outcome.exitCode === 2 && outcome.result.project.moduleCount === 0) {
    lines.push(`FAIL  ${c.id}: discovery/parse failed`);
    lines.push(`      ${outcome.output.split("\n")[0]}`);
    failed = true;
    continue;
  }

  // AnalysisResult must always include limitations (even empty).
  if (!Array.isArray(outcome.result.limitations)) {
    lines.push(`FAIL  ${c.id}: result.limitations missing or not an array`);
    failed = true;
    continue;
  }

  const findings = arch005Findings(outcome.result.diagnostics);
  const files =
    findings
      .map((d) => {
        const abs = path.isAbsolute(d.file) ? d.file : path.join(root, d.file);
        return path.relative(root, abs);
      })
      .join(", ") || "(none)";

  /** @type {"pass" | "fail" | "known"} */
  let verdict = "pass";
  /** @type {string} */
  let detail = "";

  switch (c.expectation) {
    case "should-report": {
      if (findings.length === 0) {
        verdict = "fail";
        detail = "expected ARCH005 finding, got 0";
        failed = true;
      } else {
        truePositives += findings.length;
        detail = `${findings.length} finding(s) [${files}]`;
      }
      break;
    }
    case "should-not-report": {
      if (findings.length > 0) {
        verdict = "fail";
        falsePositives += findings.length;
        detail = `FP: ${findings.length} finding(s) [${files}]`;
        failed = true;
      } else {
        trueNegatives += 1;
        detail = "ok (0 ARCH005)";
      }
      break;
    }
    case "known": {
      verdict = "known";
      detail = `known baseline: ${findings.length} finding(s) [${files}]`;
      break;
    }
    default: {
      verdict = "fail";
      detail = `unknown expectation: ${/** @type {{expectation: string}} */ (c).expectation}`;
      failed = true;
    }
  }

  const tag =
    verdict === "pass" ? "PASS" : verdict === "known" ? "KNOWN" : "FAIL";
  lines.push(
    `${tag.padEnd(5)} ${c.id}  [${c.expectation}]  ${detail}`,
  );
  if (c.notes) {
    lines.push(`      ${c.notes}`);
  }
}

lines.push("");
lines.push(
  `Summary: TP=${truePositives}  TN=${trueNegatives}  FP=${falsePositives}  (FP must be 0)`,
);

const report = lines.join("\n");
console.log(report);

if (failed || falsePositives > 0) {
  process.exit(1);
}
