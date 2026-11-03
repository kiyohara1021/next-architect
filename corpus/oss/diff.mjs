#!/usr/bin/env node
/**
 * Compare the current OSS corpus run against the committed snapshot
 * (docs/10 §10.2 ③).
 *
 * The point is the review signal: when a rule change moves counts on a real
 * project, that shows up here as a reviewable delta instead of being noticed
 * after release. New findings fail the gate — they are either a regression or a
 * genuine improvement that needs a snapshot update and a REVIEW.md entry.
 *
 * Usage: node corpus/oss/diff.mjs
 */
import {
  analyzeAll,
  corpusIsFetched,
  findingKey,
  readSnapshot,
  RULE_IDS,
} from "./analyze.mjs";

if (!corpusIsFetched()) {
  console.error(
    "OSS corpus not fetched. Run `pnpm corpus:oss:fetch` first (downloads ~20MB into corpus/oss/.cache/).",
  );
  process.exit(2);
}

const baseline = readSnapshot();
if (!baseline) {
  console.error(
    "No snapshot.json. Create one with `pnpm corpus:oss --update` and review it before committing.",
  );
  process.exit(2);
}

const run = await analyzeAll();
const baseById = new Map(baseline.apps.map((a) => [a.id, a]));

const lines = ["corpus:diff (current vs snapshot.json)", ""];
let newFindings = 0;
let removedFindings = 0;
let changed = false;

if (baseline.source.commit !== run.manifest.source.commit) {
  lines.push(
    `⚠ snapshot was taken at ${baseline.source.commit.slice(0, 10)}, manifest pins ${run.manifest.source.commit.slice(0, 10)}`,
  );
  lines.push("");
  changed = true;
}

for (const app of run.apps) {
  const base = baseById.get(app.id);
  if (app.error) {
    lines.push(`${app.id}\n  FAIL  ${app.error}`);
    changed = true;
    continue;
  }
  if (!base) {
    lines.push(`${app.id}  (new app — not in snapshot)`);
    for (const id of RULE_IDS) {
      if (app.rules[id]) lines.push(`  ${id}  – → ${app.rules[id]}   ⚠ 要確認`);
    }
    newFindings += app.findings.length;
    changed = true;
    continue;
  }

  const ruleLines = [];
  for (const id of RULE_IDS) {
    const before = base.rules?.[id] ?? 0;
    const after = app.rules[id];
    if (before === after) continue;
    const delta = after - before;
    ruleLines.push(
      `  ${id}  ${before} → ${after}   ← ${delta > 0 ? `+${delta}  ⚠ 要確認` : delta}`,
    );
  }

  const beforeKeys = new Set((base.findings ?? []).map(findingKey));
  const afterKeys = new Set(app.findings.map(findingKey));
  const added = app.findings.filter((f) => !beforeKeys.has(findingKey(f)));
  const removed = (base.findings ?? []).filter(
    (f) => !afterKeys.has(findingKey(f)),
  );
  newFindings += added.length;
  removedFindings += removed.length;

  if (ruleLines.length || added.length || removed.length) {
    changed = true;
    lines.push(`corpus/oss/${app.id}`);
    lines.push(...ruleLines);
    for (const f of added) {
      lines.push(`  + ${f.ruleId}  ${f.file}:${f.line}  ${f.message}`);
    }
    for (const f of removed) {
      lines.push(`  - ${f.ruleId}  ${f.file}:${f.line}  ${f.message}`);
    }
  }
}

if (!changed) {
  lines.push("No change against the snapshot.");
}

lines.push("");
lines.push(`new findings: ${newFindings}   removed: ${removedFindings}`);

console.log(lines.join("\n"));

if (newFindings > 0) {
  console.log("");
  console.log(
    "New findings must be judged by a human before the snapshot is updated (docs/10 §10.4).",
  );
  process.exit(1);
}
