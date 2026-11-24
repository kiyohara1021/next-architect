import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import ts from "typescript";
import type { Limitation } from "@next-architect/core";
import {
  createProjectSourceFile,
  extractFromSourceFile,
  loadCompilerContext,
  normalizeModuleId,
  type ExtractedModule,
} from "./extract.js";
import type { ProjectInfo } from "./discover.js";
import { ModuleCache, hashFile } from "./cache.js";

const BUILTIN_PACKAGES = new Set(["react", "react-dom", "next", "next/navigation", "next/link", "next/image", "next/dynamic", "next/headers", "next/cache", "next/server", "next/font", "next/font/google", "next/font/local"]);

export interface ParseProjectOptions {
  /** When false, skip .next-architect/cache (default true). */
  cache?: boolean;
  configHash?: string;
}

export interface ParsedProject {
  project: ProjectInfo;
  modules: ExtractedModule[];
  program: ts.Program;
  host: ts.CompilerHost;
  options: ts.CompilerOptions;
  limitations: Limitation[];
  /** Map from specifier resolution for later graph building. */
  resolveModule: (fromFile: string, specifier: string) => ResolveResult;
  /** Cache hit/miss counts for this parse (diagnostics / perf gates). */
  cacheStats: { hits: number; misses: number };
}

export interface ResolveResult {
  resolvedPath?: string;
  id?: string;
  isExternal: boolean;
  packageName?: string;
  unresolved: boolean;
  sizeBytes?: number;
  /** Stylesheet / image / font handled by the bundler, not by resolution. */
  isAsset?: boolean;
}

/**
 * Extensions Next.js hands to loaders rather than to module resolution.
 * `.json` is deliberately absent — TypeScript resolves it.
 */
const ASSET_EXTENSION =
  /\.(css|scss|sass|less|styl|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|pdf|txt|md|glb|gltf)$/i;

/** Whether a specifier names an asset, ignoring any `?query` suffix. */
function isAssetSpecifier(specifier: string): boolean {
  // Strip the query with indexOf rather than inside the regex: an optional
  // `(\?.*)?$` group runs in polynomial time on specifiers with many "?".
  const query = specifier.indexOf("?");
  const bare = query === -1 ? specifier : specifier.slice(0, query);
  return ASSET_EXTENSION.test(bare);
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".git",
  ".next-architect",
]);

function shouldAnalyzeFile(fileName: string, projectRoot: string): boolean {
  const rel = path.relative(projectRoot, fileName).replace(/\\/g, "/");
  if (rel.startsWith("..")) return false;
  if (rel.includes("node_modules/")) return false;
  if (!/\.(tsx?|jsx?)$/.test(fileName)) return false;
  if (fileName.endsWith(".d.ts")) return false;
  return true;
}

/**
 * Enumerate + parse project source files (pipeline ②③).
 * Extraction results are cached under `.next-architect/cache/` when enabled.
 *
 * Warm runs skip TypeScript Program creation and re-parse only cache misses
 * via `ts.createSourceFile` (docs/02 §2.6 file-level incremental cache).
 */
export function parseProject(
  project: ProjectInfo,
  parseOptions: ParseProjectOptions = {},
): ParsedProject {
  const ctx = loadCompilerContext(project.root, project.tsconfigPath);
  const allLimitations = [...project.limitations, ...ctx.limitations];
  const modules: ExtractedModule[] = [];

  const tsconfigHash = fs.existsSync(project.tsconfigPath)
    ? hashFile(project.tsconfigPath)
    : "none";
  const cache = new ModuleCache(project.root, {
    enabled: parseOptions.cache !== false,
    configHash: parseOptions.configHash ?? "default",
    tsconfigHash,
  });

  let hits = 0;
  let misses = 0;

  for (const fileName of ctx.rootNames) {
    if (!shouldAnalyzeFile(fileName, project.root)) continue;

    let content: string;
    try {
      content = fs.readFileSync(fileName, "utf8");
    } catch {
      allLimitations.push({
        kind: "parse-error",
        file: normalizeModuleId(project.root, fileName),
        detail: "Could not read file",
      });
      continue;
    }

    const contentHash = createHash("sha256").update(content).digest("hex");
    try {
      const cached = cache.get(contentHash);
      if (cached) {
        hits += 1;
        modules.push({ ...cached, path: fileName });
        continue;
      }
      misses += 1;
      const sf = createProjectSourceFile(fileName, content);
      const extracted = extractFromSourceFile(sf, project.root, contentHash);
      cache.set(contentHash, extracted);
      modules.push(extracted);
    } catch (err) {
      allLimitations.push({
        kind: "parse-error",
        file: normalizeModuleId(project.root, fileName),
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Program is unused by graph/rules today; keep an empty handle for API compat
  // so warm (and cold) avoid a second full TypeScript bind pass.
  const program = ts.createProgram({
    rootNames: [],
    options: ctx.options,
    host: ctx.host,
  });

  const packageSizeCache = new Map<string, number | undefined>();

  function resolveModule(fromFile: string, specifier: string): ResolveResult {
    // Built-in packages — do not follow into real files
    if (
      BUILTIN_PACKAGES.has(specifier) ||
      specifier.startsWith("next/") ||
      specifier === "react" ||
      specifier === "react-dom" ||
      specifier.startsWith("react/") ||
      specifier.startsWith("react-dom/")
    ) {
      return {
        unresolved: false,
        isExternal: true,
        packageName: specifier.split("/")[0],
        id: `external:${specifier}`,
      };
    }

    if (specifier === "server-only" || specifier === "client-only") {
      return {
        unresolved: false,
        isExternal: true,
        packageName: specifier,
        id: `external:${specifier}`,
      };
    }

    // Assets handled by the bundler, not by module resolution. Recording these
    // as unresolved is not cosmetic: ARCH001 stays silent on any path with an
    // unresolved import, so `import "./globals.css"` in a layout would disable
    // the rule for every module below it.
    if (isAssetSpecifier(specifier)) {
      return {
        unresolved: false,
        isExternal: true,
        id: `asset:${specifier}`,
        isAsset: true,
      };
    }

    // Node builtins
    if (
      specifier.startsWith("node:") ||
      ["fs", "path", "crypto", "child_process", "os", "net", "http", "https", "stream", "util", "url", "assert", "buffer", "events", "querystring", "zlib", "tls", "dns", "dgram", "cluster", "worker_threads"].includes(
        specifier,
      )
    ) {
      return {
        unresolved: false,
        isExternal: true,
        packageName: specifier,
        id: `external:${specifier}`,
      };
    }

    const resolved = ts.resolveModuleName(
      specifier,
      fromFile,
      ctx.options,
      ctx.host,
    );
    const resolvedName = resolved.resolvedModule?.resolvedFileName;

    if (!resolvedName) {
      return { unresolved: true, isExternal: false };
    }

    const inNodeModules = resolvedName.includes(`${path.sep}node_modules${path.sep}`);
    if (inNodeModules) {
      const pkgName = extractPackageName(resolvedName);
      let sizeBytes = packageSizeCache.get(pkgName ?? specifier);
      if (sizeBytes === undefined && pkgName) {
        sizeBytes = estimatePackageSize(project.root, pkgName);
        packageSizeCache.set(pkgName, sizeBytes);
      }
      return {
        unresolved: false,
        isExternal: true,
        packageName: pkgName,
        id: `external:${pkgName ?? specifier}`,
        resolvedPath: resolvedName,
        sizeBytes,
      };
    }

    // Outside project root → treat as external-ish / unresolved for analysis scope
    const rel = path.relative(project.root, resolvedName);
    if (rel.startsWith("..")) {
      return {
        unresolved: false,
        isExternal: true,
        id: `external:${specifier}`,
        resolvedPath: resolvedName,
      };
    }

    return {
      unresolved: false,
      isExternal: false,
      id: normalizeModuleId(project.root, resolvedName),
      resolvedPath: resolvedName,
    };
  }

  return {
    project,
    modules,
    program,
    host: ctx.host,
    options: ctx.options,
    limitations: allLimitations,
    resolveModule,
    cacheStats: { hits, misses },
  };
}

function extractPackageName(resolvedPath: string): string | undefined {
  const parts = resolvedPath.replace(/\\/g, "/").split("/node_modules/");
  const last = parts[parts.length - 1];
  if (!last) return undefined;
  if (last.startsWith("@")) {
    const segs = last.split("/");
    return `${segs[0]}/${segs[1]}`;
  }
  return last.split("/")[0];
}

function estimatePackageSize(
  projectRoot: string,
  packageName: string,
): number | undefined {
  try {
    const pkgJsonPath = path.join(
      projectRoot,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (!fs.existsSync(pkgJsonPath)) return undefined;
    const pkgDir = path.dirname(pkgJsonPath);
    return packageRuntimeSize(pkgDir);
  } catch {
    return undefined;
  }
}

/**
 * Files inside node_modules that never reach a browser: type declarations,
 * source maps, docs, and TypeScript sources shipped next to the build.
 */
const NON_RUNTIME_FILE =
  /(\.map|\.d\.[cm]?ts|\.md|\.markdown|\.txt|\.flow|\.ts|\.tsx)$|^(LICENSE|LICENCE|CHANGELOG|README|AUTHORS|NOTICE)/i;

/**
 * Alternate builds of code already counted once. A bundler picks one format;
 * the UMD, IIFE, ES5, and minified copies are the same code again.
 */
const DUPLICATE_BUILD = /(^|[.\-_])(umd|iife|es5|system|amd)([.\-_]|$)|\.min\./i;

/** Directories that hold nothing a bundler would pull from a package. */
const SKIP_PACKAGE_DIRS = new Set([
  "node_modules",
  ".git",
  "__tests__",
  "test",
  "tests",
  "docs",
  "doc",
  "example",
  "examples",
  "benchmark",
  "benchmarks",
  "coverage",
]);

const MAX_PACKAGE_SCAN_DEPTH = 6;

/**
 * Approximate gzipped size of the code a bundler could pull from a package.
 *
 * Unpacked size cannot carry ARCH004: `tailwind-merge` is 210 KB unpacked but
 * about 7 KB gzipped (corpus/oss/REVIEW.md, D5). The runtime files are
 * therefore compressed, in chunks of ~1 MB so a package with thousands of tiny
 * files (`lucide-react`) neither holds everything in memory nor pays the
 * per-file gzip overhead.
 *
 * The file selection still skips SKIP_PACKAGE_DIRS / NON_RUNTIME_FILE /
 * DUPLICATE_BUILD (the old SKIP_DIRS reuse skipped `dist` and measured the
 * wrong files, D4). It remains an over-estimate: CJS and ESM builds are both
 * counted and tree-shaking is invisible here. docs/05 requires the output to
 * say so.
 */
const GZIP_CHUNK_BYTES = 1024 * 1024;

function packageRuntimeSize(dir: string): number {
  let total = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const flush = (): void => {
    if (pendingBytes === 0) return;
    total += zlib.gzipSync(Buffer.concat(pending), { level: 6 }).length;
    pending = [];
    pendingBytes = 0;
  };
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_PACKAGE_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    // Sorted so the chunking, and therefore the size, is deterministic.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          SKIP_PACKAGE_DIRS.has(entry.name) ||
          DUPLICATE_BUILD.test(entry.name)
        ) {
          continue;
        }
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (NON_RUNTIME_FILE.test(entry.name)) continue;
        if (DUPLICATE_BUILD.test(entry.name)) continue;
        try {
          const data = fs.readFileSync(full);
          pending.push(data);
          pendingBytes += data.length;
          if (pendingBytes >= GZIP_CHUNK_BYTES) flush();
        } catch {
          // ignore
        }
      }
    }
  };
  walk(dir, 0);
  flush();
  return total;
}

export { shouldAnalyzeFile };
