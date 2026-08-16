import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
const harness = path.join(repoRoot, "corpus/smoke/run.mjs");

describe("ARCH001 real-project smoke", () => {
  it("reports planted unnecessary use client and keeps known-good clean", () => {
    const result = spawnSync(process.execPath, [harness], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    expect(result.status, result.stderr || result.stdout || "smoke failed").toBe(
      0,
    );
  }, 60_000);
});
