import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TOOL_VERSION } from "@next-architect/core";
import type { ExtractedModule } from "./extract.js";

interface CacheMeta {
  toolVersion: string;
  parserVersion: string;
  configHash: string;
  tsconfigHash: string;
}

interface CacheEntry {
  hash: string;
  module: ExtractedModule;
}

const PARSER_VERSION = "0.1.0";

export class ModuleCache {
  private dir: string;
  private metaPath: string;
  private modulesDir: string;
  private enabled: boolean;
  private meta: CacheMeta | null = null;

  constructor(
    projectRoot: string,
    options: {
      enabled: boolean;
      configHash: string;
      tsconfigHash: string;
    },
  ) {
    this.dir = path.join(projectRoot, ".next-architect", "cache");
    this.metaPath = path.join(this.dir, "meta.json");
    this.modulesDir = path.join(this.dir, "modules");
    this.enabled = options.enabled;

    if (!this.enabled) return;

    fs.mkdirSync(this.modulesDir, { recursive: true });

    const expected: CacheMeta = {
      toolVersion: TOOL_VERSION,
      parserVersion: PARSER_VERSION,
      configHash: options.configHash,
      tsconfigHash: options.tsconfigHash,
    };

    if (fs.existsSync(this.metaPath)) {
      try {
        const existing = JSON.parse(
          fs.readFileSync(this.metaPath, "utf8"),
        ) as CacheMeta;
        if (
          existing.toolVersion !== expected.toolVersion ||
          existing.parserVersion !== expected.parserVersion ||
          existing.configHash !== expected.configHash ||
          existing.tsconfigHash !== expected.tsconfigHash
        ) {
          // Invalidate all
          fs.rmSync(this.modulesDir, { recursive: true, force: true });
          fs.mkdirSync(this.modulesDir, { recursive: true });
        }
      } catch {
        // ignore corrupt cache
      }
    }

    this.meta = expected;
    fs.writeFileSync(this.metaPath, JSON.stringify(expected, null, 2));
  }

  get(contentHash: string): ExtractedModule | undefined {
    if (!this.enabled) return undefined;
    const file = path.join(this.modulesDir, `${contentHash}.json`);
    if (!fs.existsSync(file)) return undefined;
    try {
      const entry = JSON.parse(fs.readFileSync(file, "utf8")) as CacheEntry;
      if (entry.hash !== contentHash) return undefined;
      return entry.module;
    } catch {
      return undefined;
    }
  }

  set(contentHash: string, module: ExtractedModule): void {
    if (!this.enabled) return;
    const file = path.join(this.modulesDir, `${contentHash}.json`);
    const entry: CacheEntry = { hash: contentHash, module };
    fs.writeFileSync(file, JSON.stringify(entry));
  }
}

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFile(filePath: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}
