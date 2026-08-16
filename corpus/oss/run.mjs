#!/usr/bin/env node
/**
 * Run the OSS corpus and report the docs/10 §10.2 metrics.
 *
 * This measures noise, not correctness: whether each finding is a true or false
 * positive is a human call, recorded in corpus/oss/REVIEW.md. What this gate
 * enforces is the mechanical part — report density and unresolved rate
 * (docs/10 §10.3).
 *
 * Usage:
 *   node corpus/oss/run.mjs            # report + enforce thresholds
 *   node corpus/oss/run.mjs --update   # also rewrite snapshot.json
 */
import {
  analyzeAll,
  corpusIsFetched,
  toSnapshot,
  writeSnapshot,
  RULE_IDS,
} from "./analyze.mjs";

// docs/10 §10.3 release gates.
const MAX_DIAGNOSTICS_PER_100_MODULES = 5;
const MAX_UNRESOLVED_RATE = 0.02;

const update = process.argv.slice(2).includes("--update");

if (!corpusIsFetched()) {
  console.error(
    "OSS corpus not fetched. Run `pnpm corpus:oss:fetch` first (downloads ~20MB into corpus/oss/.cache/).",
  );
  process.exit(2);
}

const run = await analyzeAll();
const lines = [];
let failed = false;

lines.push(
  `OSS corpus (${run.manifest.source.repo}@${run.manifest.source.commit.slice(0, 10)}, ${run.manifest.source.license})`,
);
lines.push("");

let totalModules = 0;
let totalFindings = 0;
let totalUnresolved = 0;

for (const app of run.apps) {
  if (app.error) {
    lines.push(`FAIL  ${app.id}: ${app.error}`);
    failed = true;
    continue;
  }

  totalModules += app.moduleCount;
  totalUnresolved += app.unresolvedImports;
  const findingCount = app.findings.length;
  totalFindings += findingCount;

  const byRule = RULE_IDS.filter((id) => app.rules[id] > 0)
    .map((id) => `${id}=${app.rules[id]}`)
    .join(" ");

  const densityOk = app.diagnosticsPer100Modules <= MAX_DIAGNOSTICS_PER_100_MODULES;
  const unresolvedOk = app.unresolvedRate <= MAX_UNRESOLVED_RATE;
  if (!densityOk || !unresolvedOk) failed = true;

  lines.push(
    `${densityOk && unresolvedOk ? "PASS" : "FAIL"}  ${app.id.padEnd(24)} ` +
      `modules=${String(app.moduleCount).padStart(3)} ` +
      `findings=${String(findingCount).padStart(2)} ` +
      `density=${app.diagnosticsPer100Modules.toFixed(2)}/100${densityOk ? "" : ` >${MAX_DIAGNOSTICS_PER_100_MODULES}`} ` +
      `unresolved=${(app.unresolvedRate * 100).toFixed(1)}%${unresolvedOk ? "" : ` >${MAX_UNRESOLVED_RATE * 100}%`} ` +
      `${app.elapsedMs.toFixed(0)}ms`,
  );
  if (byRule) lines.push(`      ${byRule}`);
  for (const f of app.findings) {
    lines.push(
      `      ${f.severity.padEnd(7)} ${f.ruleId}  ${f.file}:${f.line}  (${Math.round(f.confidence * 100)}%)`,
    );
  }
}

const overallDensity = totalModules
  ? (totalFindings / totalModules) * 100
  : 0;
const overallUnresolved = totalModules ? totalUnresolved / totalModules : 0;

lines.push("");
lines.push(
  `Totals: modules=${totalModules} findings=${totalFindings} ` +
    `density=${overallDensity.toFixed(2)}/100 (limit ${MAX_DIAGNOSTICS_PER_100_MODULES}) ` +
    `unresolved=${(overallUnresolved * 100).toFixed(1)}% (limit ${MAX_UNRESOLVED_RATE * 100}%)`,
);
lines.push(
  "False-positive rate is not computed here — it requires human judgement (corpus/oss/REVIEW.md).",
);

console.log(lines.join("\n"));

if (update) {
  writeSnapshot(toSnapshot(run));
  console.log("");
  console.log("snapshot.json updated — review every delta before committing.");
}

if (failed) process.exit(1);
