#!/usr/bin/env node
/**
 * Fetch the pinned OSS corpus (docs/10 §10.2 ②).
 *
 * Nothing is vendored into this repository. The apps listed in manifest.json
 * are checked out from vercel/next.js at a pinned commit into
 * corpus/oss/.cache/ (gitignored) using a sparse, blobless clone, so only the
 * example directories we actually analyze are downloaded.
 *
 * Dependencies are installed per app because resolution accuracy is the point:
 * without node_modules almost every third-party import is unresolved, and
 * next-architect stays silent on unresolved paths by design (docs/03) — which
 * would make the false-positive count meaningless.
 *
 * Usage:
 *   node corpus/oss/fetch.mjs [--skip-install] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".cache");
const CHECKOUT_DIR = path.join(CACHE_DIR, "next.js");
const STAMP_PATH = path.join(CACHE_DIR, ".fetch-stamp.json");

const args = process.argv.slice(2);
const skipInstall = args.includes("--skip-install");
const force = args.includes("--force");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"),
);
const { source, apps } = manifest;

/**
 * @param {string} cmd
 * @param {string[]} argv
 * @param {string} cwd
 */
function run(cmd, argv, cwd) {
  execFileSync(cmd, argv, { cwd, stdio: "inherit" });
}

/** @returns {boolean} true when the checkout already matches the pinned commit. */
function alreadyFetched() {
  if (force || !fs.existsSync(STAMP_PATH)) return false;
  try {
    const stamp = JSON.parse(fs.readFileSync(STAMP_PATH, "utf8"));
    return (
      stamp.commit === source.commit &&
      stamp.apps.length === apps.length &&
      apps.every((a) => stamp.apps.includes(a.id))
    );
  } catch {
    return false;
  }
}

function sparseCheckout() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (!fs.existsSync(path.join(CHECKOUT_DIR, ".git"))) {
    fs.rmSync(CHECKOUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(CHECKOUT_DIR, { recursive: true });
    run("git", ["init", "--quiet"], CHECKOUT_DIR);
    run("git", ["remote", "add", "origin", source.url], CHECKOUT_DIR);
  }

  run("git", ["sparse-checkout", "init", "--cone"], CHECKOUT_DIR);
  run(
    "git",
    ["sparse-checkout", "set", ...apps.map((a) => a.path)],
    CHECKOUT_DIR,
  );

  // Blobless + depth 1 at the pinned SHA: we never need history, and only the
  // sparse paths' blobs are downloaded.
  console.log(`Fetching ${source.repo}@${source.commit.slice(0, 10)} ...`);
  run(
    "git",
    ["fetch", "--depth", "1", "--filter=blob:none", "origin", source.commit],
    CHECKOUT_DIR,
  );
  run("git", ["checkout", "--quiet", "FETCH_HEAD"], CHECKOUT_DIR);
}

/**
 * @param {{id: string, path: string}} app
 * @returns {{ id: string, installed: boolean, error?: string }}
 */
function installApp(app) {
  const appDir = path.join(CHECKOUT_DIR, app.path);
  if (!fs.existsSync(path.join(appDir, "package.json"))) {
    return { id: app.id, installed: false, error: "no package.json" };
  }
  if (fs.existsSync(path.join(appDir, "node_modules"))) {
    return { id: app.id, installed: true };
  }

  console.log(`Installing ${app.id} ...`);
  try {
    // --ignore-scripts: we analyze source, and postinstall scripts of a
    // third-party corpus should never run here.
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--legacy-peer-deps",
        "--loglevel",
        "error",
      ],
      appDir,
    );
    return { id: app.id, installed: true };
  } catch (err) {
    // A single app failing to install must not block the rest; run.mjs records
    // the resulting unresolved rate so the gap stays visible.
    return {
      id: app.id,
      installed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

if (alreadyFetched()) {
  console.log(
    `Corpus already at ${source.repo}@${source.commit.slice(0, 10)} (use --force to refetch)`,
  );
  process.exit(0);
}

sparseCheckout();

const missing = apps.filter(
  (a) => !fs.existsSync(path.join(CHECKOUT_DIR, a.path)),
);
if (missing.length) {
  console.error(
    `Pinned commit does not contain: ${missing.map((a) => a.path).join(", ")}`,
  );
  process.exit(2);
}

const installs = skipInstall
  ? apps.map((a) => ({ id: a.id, installed: false, error: "--skip-install" }))
  : apps.map(installApp);

fs.writeFileSync(
  STAMP_PATH,
  JSON.stringify(
    {
      repo: source.repo,
      commit: source.commit,
      apps: apps.map((a) => a.id),
      installs,
      skipInstall,
    },
    null,
    2,
  ) + "\n",
);

const failed = installs.filter((i) => !i.installed && !skipInstall);
console.log("");
console.log(`Fetched ${apps.length} app(s) into ${path.relative(process.cwd(), CHECKOUT_DIR)}`);
if (failed.length) {
  console.log(
    `Install failed for: ${failed.map((f) => f.id).join(", ")} — unresolved rates will be high for these`,
  );
}
