import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
const harness = path.join(repoRoot, "corpus/arch005/run.mjs");

describe("ARCH005 corpus FP gate", () => {
  it("reports expected cases and keeps FP=0 on should-not-report", () => {
    const result = spawnSync(process.execPath, [harness], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    expect(result.status, result.stderr || result.stdout || "harness failed").toBe(
      0,
    );
  }, 60_000);
});
