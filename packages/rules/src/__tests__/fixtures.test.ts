import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverProject, parseProject } from "@next-architect/parser";
import { buildGraph } from "@next-architect/graph";
import { runRules } from "../engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "../../__fixtures__");

function analyze(fixtureDir: string, rules: string[]) {
  const project = discoverProject(fixtureDir);
  const parsed = parseProject(project);
  const { graph } = buildGraph(parsed);
  return runRules({
    graph,
    root: fixtureDir,
    config: {},
    ruleFilter: rules,
  });
}

function listCases(ruleId: string, kind: "should-report" | "should-not-report") {
  const base = path.join(fixturesRoot, ruleId, kind);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(base, d.name));
}

describe("ARCH001", () => {
  for (const dir of listCases("ARCH001", "should-report")) {
    it(`should-report: ${path.basename(dir)}`, () => {
      const diags = analyze(dir, ["ARCH001"]).filter((d) => d.ruleId === "ARCH001");
      expect(diags.length).toBeGreaterThanOrEqual(1);
    });
  }

  for (const dir of listCases("ARCH001", "should-not-report")) {
    it(`should-not-report: ${path.basename(dir)}`, () => {
      const diags = analyze(dir, ["ARCH001"]).filter(
        (d) => d.ruleId === "ARCH001" && d.severity === "warning",
      );
      expect(diags).toEqual([]);
    });
  }
});

describe("ARCH002 smoke", () => {
  const dir = path.join(
    fixturesRoot,
    "ARCH002",
    "should-report",
    "db-from-client",
  );
  it("reports client boundary pollution", () => {
    if (!fs.existsSync(dir)) return;
    const diags = analyze(dir, ["ARCH002"]);
    expect(diags.some((d) => d.ruleId === "ARCH002")).toBe(true);
  });
});

describe("ARCH003 smoke", () => {
  const dir = path.join(
    fixturesRoot,
    "ARCH003",
    "should-report",
    "server-only-leak",
  );
  it("reports server-only in client graph", () => {
    if (!fs.existsSync(dir)) return;
    const diags = analyze(dir, ["ARCH003"]);
    expect(diags.some((d) => d.ruleId === "ARCH003")).toBe(true);
  });
});

describe("ARCH005 smoke", () => {
  const dir = path.join(fixturesRoot, "ARCH005", "should-report", "waterfall");
  it("reports potential waterfall", () => {
    if (!fs.existsSync(dir)) return;
    const diags = analyze(dir, ["ARCH005"]);
    expect(diags.some((d) => d.ruleId === "ARCH005")).toBe(true);
  });
});
