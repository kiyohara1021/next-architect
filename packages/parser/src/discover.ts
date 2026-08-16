import fs from "node:fs";
import path from "node:path";
import type { Limitation } from "@next-architect/core";

export interface ProjectInfo {
  root: string;
  tsconfigPath: string;
  packageJsonPath: string;
  nextVersion?: string;
  router: "app" | "pages" | "hybrid";
  hasAppDir: boolean;
  hasPagesDir: boolean;
  appDir?: string;
  pagesDir?: string;
  srcDir: boolean;
  limitations: Limitation[];
}

function findUp(start: string, names: string[]): string | undefined {
  let dir = path.resolve(start);
  while (true) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Discover a Next.js project root and basic layout (pipeline step ①).
 */
export function discoverProject(rootHint?: string): ProjectInfo {
  const start = rootHint ? path.resolve(rootHint) : process.cwd();
  const packageJsonPath = findUp(start, ["package.json"]);
  if (!packageJsonPath) {
    throw new ProjectDiscoveryError(
      `No package.json found from ${start}`,
    );
  }

  const root = path.dirname(packageJsonPath);
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const nextVersion =
    pkg.dependencies?.next ?? pkg.devDependencies?.next ?? undefined;

  const limitations: Limitation[] = [];

  if (!nextVersion) {
    throw new ProjectDiscoveryError(
      `No "next" dependency found in ${packageJsonPath}. next-architect analyzes Next.js projects.`,
    );
  }

  // Support Next.js 13+ (App Router era). Warn outside 15–16 per docs/11.
  const major = Number.parseInt(nextVersion.replace(/^[^\d]*/, ""), 10);
  if (!Number.isNaN(major) && (major < 13 || major > 16)) {
    limitations.push({
      kind: "unsupported-next-version",
      detail: `Detected next@${nextVersion}. Officially supported range is Next.js 15–16; analysis continues with best-effort semantics.`,
    });
  }

  const srcApp = path.join(root, "src", "app");
  const app = path.join(root, "app");
  const srcPages = path.join(root, "src", "pages");
  const pages = path.join(root, "pages");

  const hasAppDir = fs.existsSync(srcApp) || fs.existsSync(app);
  const hasPagesDir = fs.existsSync(srcPages) || fs.existsSync(pages);
  const srcDir = fs.existsSync(srcApp) || fs.existsSync(srcPages);

  if (!hasAppDir && !hasPagesDir) {
    throw new ProjectDiscoveryError(
      `Neither app/ nor pages/ found under ${root}.`,
    );
  }

  if (hasPagesDir && !hasAppDir) {
    limitations.push({
      kind: "unsupported-router",
      detail:
        "Pages Router detected. v0.1 does not run Pages Router rules — App Router only.",
    });
  } else if (hasPagesDir && hasAppDir) {
    limitations.push({
      kind: "unsupported-router",
      detail:
        "Hybrid app/ + pages/ detected. v0.1 analyzes App Router only; Pages Router rules are not executed.",
    });
  }

  const tsconfigPath =
    findUp(root, ["tsconfig.json"]) ?? path.join(root, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    throw new ProjectDiscoveryError(`No tsconfig.json found under ${root}.`);
  }

  let router: "app" | "pages" | "hybrid" = "app";
  if (hasAppDir && hasPagesDir) router = "hybrid";
  else if (hasPagesDir) router = "pages";

  return {
    root,
    tsconfigPath,
    packageJsonPath,
    nextVersion: nextVersion.replace(/^[\^~>=<]*/, ""),
    router,
    hasAppDir,
    hasPagesDir,
    appDir: fs.existsSync(srcApp) ? srcApp : fs.existsSync(app) ? app : undefined,
    pagesDir: fs.existsSync(srcPages)
      ? srcPages
      : fs.existsSync(pages)
        ? pages
        : undefined,
    srcDir,
    limitations,
  };
}

export class ProjectDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDiscoveryError";
  }
}
