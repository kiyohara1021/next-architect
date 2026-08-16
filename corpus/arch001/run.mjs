#!/usr/bin/env node
/**
 * ARCH001 local corpus FP gate (docs/09–10).
 *
 * Runs `runCheck` (same pipeline as `next-architect check`) against synthetic
 * App Router mini-apps under corpus/arch001/cases/, classifies findings vs
 * manifest expectations, and fails on false positives for should-not-report.
 *
 * Usage: pnpm corpus:arch001
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../packages/cli/dist/check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULE_ID = "ARCH001";

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
function arch001Findings(diagnostics) {
  return diagnostics.filter((d) => d.ruleId === RULE_ID);
}

/**
 * Warning-severity ARCH001 only — these are the FP gate (info/weak alone is not FP for v0.1).
 * @param {import("@next-architect/core").Diagnostic[]} diagnostics
 */
function arch001Warnings(diagnostics) {
  return arch001Findings(diagnostics).filter((d) => d.severity === "warning");
}

/**
 * Materialize a client-only npm package: no "use client" directive, but its
 * own code calls a client-only React API. `styled-components` is shaped
 * exactly like this, and it produced three ARCH001 false positives on
 * Next.js's own example (corpus/oss/REVIEW.md, D1).
 *
 * @param {string} caseRoot
 * @param {string} caseId
 */
function ensureCaseVendors(caseRoot, caseId) {
  if (caseId !== "client-only-package") return;

  const pkgDir = path.join(caseRoot, "node_modules", "corpus-ui-kit");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      { name: "corpus-ui-kit", version: "0.0.0", private: true, main: "index.js" },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(pkgDir, "index.js"),
    [
      "const React = require('react');",
      "const ThemeContext = React.createContext({ color: 'red' });",
      "exports.createTheme = function createTheme() {",
      "  return React.useContext(ThemeContext);",
      "};",
      "",
    ].join("\n"),
  );
}

let failed = false;
let falsePositives = 0;
let truePositives = 0;
let trueNegatives = 0;
/** @type {string[]} */
const lines = [];

lines.push(`ARCH001 corpus FP gate (${manifest.cases.length} cases)`);
lines.push("");

for (const c of manifest.cases) {
  const root = path.join(__dirname, "cases", c.id);
  if (!fs.existsSync(root)) {
    lines.push(`FAIL  ${c.id}: case directory missing`);
    failed = true;
    continue;
  }

  ensureCaseVendors(root, c.id);

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

  const findings = arch001Findings(outcome.result.diagnostics);
  const warnings = arch001Warnings(outcome.result.diagnostics);
  const files =
    warnings
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
      // Any ARCH001 finding (warning or info) counts as a report for synthetic TP.
      if (findings.length === 0) {
        verdict = "fail";
        detail = "expected ARCH001 finding, got 0";
        failed = true;
      } else {
        truePositives += warnings.length > 0 ? warnings.length : findings.length;
        detail = `${findings.length} finding(s), warnings=${warnings.length} [${files}]`;
      }
      break;
    }
    case "should-not-report": {
      if (warnings.length > 0) {
        verdict = "fail";
        falsePositives += warnings.length;
        detail = `FP: ${warnings.length} warning(s) [${files}]`;
        failed = true;
      } else {
        trueNegatives += 1;
        detail =
          findings.length > 0
            ? `ok (no warnings; ${findings.length} info-only ignored for FP gate)`
            : "ok (0 ARCH001)";
      }
      break;
    }
    case "known": {
      verdict = "known";
      detail = `known baseline: ${warnings.length} warning(s) [${files}]`;
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
