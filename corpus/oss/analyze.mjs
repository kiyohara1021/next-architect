/**
 * Shared analysis pass for the OSS corpus (docs/10 §10.2 ②).
 *
 * Runs the default `next-architect check` experience — no rule filter, no
 * confidence override — because what we are measuring is what a user sees on
 * first run (docs/10 §10.1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../packages/cli/dist/check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CHECKOUT_DIR = path.join(__dirname, ".cache", "next.js");
export const SNAPSHOT_PATH = path.join(__dirname, "snapshot.json");
export const RULE_IDS = ["ARCH001", "ARCH002", "ARCH003", "ARCH004", "ARCH005"];

export function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"),
  );
}

export function corpusIsFetched() {
  return fs.existsSync(CHECKOUT_DIR);
}

/**
 * Stable identity for a finding, so diffs survive unrelated churn.
 * @param {{ruleId: string, file: string, line?: number}} d
 */
export function findingKey(d) {
  return `${d.ruleId}:${d.file}:${d.line ?? 0}`;
}

/**
 * @param {{id: string, path: string}} app
 */
export async function analyzeApp(app) {
  const root = path.join(CHECKOUT_DIR, app.path);
  if (!fs.existsSync(root)) {
    return { id: app.id, error: "not fetched" };
  }

  const startedAt = process.hrtime.bigint();
  const outcome = await runCheck({ root, format: "json", noCache: true });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const result = outcome.result;
  if (outcome.exitCode === 2 && result.project.moduleCount === 0) {
    return { id: app.id, error: outcome.output.split("\n")[0] };
  }

  // What the user actually sees: suppressed diagnostics are excluded.
  const visible = result.diagnostics.filter((d) => !d.suppressed);
  const moduleCount = result.project.moduleCount;
  const unresolved = result.limitations.filter(
    (l) => l.kind === "unresolved-import",
  ).length;

  /** @type {Record<string, number>} */
  const rules = {};
  for (const id of RULE_IDS) {
    rules[id] = visible.filter((d) => d.ruleId === id).length;
  }

  return {
    id: app.id,
    moduleCount,
    routeCount: result.project.routeCount,
    clientModuleCount: result.project.clientModuleCount ?? 0,
    unresolvedImports: unresolved,
    unresolvedRate: moduleCount ? round(unresolved / moduleCount, 4) : 0,
    diagnosticsPer100Modules: moduleCount
      ? round((visible.length / moduleCount) * 100, 2)
      : 0,
    rules,
    findings: visible
      .map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        file: d.file,
        line: d.line ?? 0,
        confidence: d.confidence,
        message: d.message,
      }))
      .sort((a, b) => findingKey(a).localeCompare(findingKey(b))),
    // Wall time is reported but never snapshotted: it is machine-dependent and
    // would churn the committed baseline on every run.
    elapsedMs: round(elapsedMs, 1),
  };
}

export async function analyzeAll() {
  const manifest = readManifest();
  const apps = [];
  for (const app of manifest.apps) {
    apps.push(await analyzeApp(app));
  }
  return { manifest, apps };
}

/**
 * The committed baseline. Timing is stripped for the reason above.
 * @param {{manifest: any, apps: any[]}} run
 */
export function toSnapshot(run) {
  return {
    description:
      "Committed baseline for `pnpm corpus:diff`. Regenerate with `pnpm corpus:oss --update` and review every delta (docs/10 §10.2 ③).",
    source: {
      repo: run.manifest.source.repo,
      commit: run.manifest.source.commit,
    },
    apps: run.apps.map(({ elapsedMs, ...rest }) => rest),
  };
}

export function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

export function writeSnapshot(snapshot) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
