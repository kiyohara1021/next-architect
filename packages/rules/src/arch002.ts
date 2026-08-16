import type {
  AnalysisContext,
  DiagnosticPath,
  ModuleNode,
  Rule,
  RuleListener,
} from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";

const DB_PACKAGES = new Set([
  "pg",
  "mysql2",
  "mysql",
  "prisma",
  "@prisma/client",
  "drizzle-orm",
  "mongoose",
  "mongodb",
  "ioredis",
  "redis",
  "better-sqlite3",
  "sqlite3",
  "postgres",
]);

const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "crypto",
  "child_process",
  "os",
  "net",
  "http",
  "https",
  "stream",
  "worker_threads",
  "node:fs",
  "node:path",
  "node:crypto",
  "node:child_process",
]);

function isServerOriented(
  mod: ModuleNode,
  extraPackages: string[],
): { strong: boolean; reason: string } | null {
  if (mod.forcedServer || mod.packageName === "server-only") {
    return { strong: true, reason: 'imports "server-only"' };
  }

  const pkg = mod.packageName;
  if (pkg && (DB_PACKAGES.has(pkg) || extraPackages.includes(pkg))) {
    return { strong: true, reason: `imports "${pkg}"` };
  }

  // External node builtins
  if (pkg && (NODE_BUILTINS.has(pkg) || NODE_BUILTINS.has(mod.id.replace("external:", "")))) {
    return { strong: true, reason: `imports Node builtin "${pkg}"` };
  }

  // Check imports of this module for DB / builtins / server-only
  for (const edge of mod.imports) {
    const spec = edge.specifier;
    if (spec === "server-only") {
      return { strong: true, reason: 'imports "server-only"' };
    }
    const base = spec.startsWith("node:") ? spec : spec.split("/")[0]!;
    if (DB_PACKAGES.has(spec) || DB_PACKAGES.has(base)) {
      return { strong: true, reason: `imports "${spec}"` };
    }
    if (NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(base)) {
      return { strong: true, reason: `imports Node builtin "${spec}"` };
    }
    if (extraPackages.includes(spec) || extraPackages.includes(base)) {
      return { strong: true, reason: `imports configured server package "${spec}"` };
    }
  }

  // Weak: filename heuristics — alone not enough
  const weakPath =
    /(^|\/)(db|server|repository|dal|queries)(\/|$)/i.test(mod.id) ||
    /\b(db|database|repository)\.[jt]sx?$/.test(mod.id);

  if (weakPath) {
    return { strong: false, reason: `path suggests server module (${mod.id})` };
  }

  return null;
}

function findPath(
  ctx: AnalysisContext,
  from: string,
  to: string,
): { nodes: string[]; hasShakeable: boolean; hasUnresolved: boolean; hasNs: boolean; hasDynamic: boolean } | null {
  const visited = new Set<string>();
  const queue: Array<{
    id: string;
    path: string[];
    shakeable: boolean;
    unresolved: boolean;
    ns: boolean;
    dynamic: boolean;
  }> = [{ id: from, path: [from], shakeable: false, unresolved: false, ns: false, dynamic: false }];

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.id === to) {
      return {
        nodes: cur.path,
        hasShakeable: cur.shakeable,
        hasUnresolved: cur.unresolved,
        hasNs: cur.ns,
        hasDynamic: cur.dynamic,
      };
    }
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);

    const mod = ctx.getModule(cur.id);
    if (!mod) continue;
    for (const edge of mod.imports) {
      if (edge.isTypeOnly) continue;
      queue.push({
        id: edge.to,
        path: [...cur.path, edge.to],
        shakeable: cur.shakeable || edge.reachability === "shakeable",
        unresolved: cur.unresolved || !!edge.unresolved,
        ns:
          cur.ns ||
          edge.importedNames.includes("*") ||
          edge.importedNames.includes("default"),
        dynamic: cur.dynamic || edge.type === "dynamic",
      });
    }
  }
  return null;
}

export const arch002: Rule = {
  id: "ARCH002",
  category: "dependency",
  defaultSeverity: "warning",
  requiresTypeInfo: false,
  baseConfidence: 0.85,
  docs: {
    summary: "Client Boundary Pollution — server-oriented deps reachable from Client",
    url: "https://github.com/kiyohara1021/next-architect/blob/main/docs/05-rules.md#arch002",
    explanation:
      "From a Client boundary, a server-oriented dependency (DB client, Node builtin, etc.) is reachable via direct imports.",
    whyProblematic:
      "Server-oriented code in the client graph inflates the bundle and can leak server concerns into the browser.",
    incorrectExample: `"use client";\nimport { db } from "@/lib/database";`,
    correctExample: `// Server Component\nimport { db } from "@/lib/database";\n// pass data as props to Client children`,
    exclusions: [
      "shakeable (barrel) paths — hidden unless --include-shakeable",
      "Weak filename heuristics alone",
      "Paths that are ARCH003 (server-only) — reported only as ARCH003",
    ],
    falsePositiveNotes: [
      "Server-package heuristics are not exhaustive; configure boundary.serverPackages.",
    ],
  },
  create(ctx: AnalysisContext): RuleListener {
    const extra = ctx.config.boundary?.serverPackages ?? [];
    const reported = new Set<string>();
    // Track ARCH003 paths to avoid duplicate reporting
    const arch003Targets = new Set(
      ctx.graph.conflicts.map((c) => c.moduleId),
    );

    return {
      onBoundary(edge) {
        // BFS from client side of boundary for server-oriented modules
        const start = edge.to;
        const visited = new Set<string>();
        const queue = [start];

        while (queue.length) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);

          const mod = ctx.getModule(id);
          if (!mod) continue;

          // Skip if this will be ARCH003
          if (mod.forcedServer || arch003Targets.has(id)) {
            continue;
          }

          const oriented = isServerOriented(mod, extra);
          if (oriented?.strong) {
            const pathInfo = findPath(ctx, start, id);
            if (!pathInfo || pathInfo.hasUnresolved) {
              // silence
            } else if (pathInfo.hasShakeable) {
              // default: don't report shakeable (handled by filter too)
              const key = `${start}->${id}`;
              if (!reported.has(key)) {
                reported.add(key);
                const confidence = computeConfidence(arch002.baseConfidence, {
                  hasShakeableSegment: true,
                  hasNamespaceOrDefaultImport: pathInfo.hasNs,
                  hasDynamicImport: pathInfo.hasDynamic,
                  isTestOrStories: isTestOrStoriesPath(start),
                  isDtsOrGenerated: isDtsOrGeneratedPath(start),
                });
                const diagnosticPath: DiagnosticPath = {
                  nodes: pathInfo.nodes.map((nid) => ({
                    id: nid,
                    environment: ctx.getModule(nid)?.environment ?? "unknown",
                  })),
                  hasShakeableSegment: true,
                };
                ctx.report({
                  ruleId: "ARCH002",
                  severity: "warning",
                  file: start,
                  message: "Client Boundary Pollution",
                  explanation: `A server-oriented dependency is reachable from a Client Component (${oriented.reason}).`,
                  suggestion:
                    "Move data access behind a Server Component boundary, or add `import \"server-only\"` to make this an error.",
                  confidence,
                  path: diagnosticPath,
                });
              }
            } else {
              const key = `${start}->${id}`;
              if (!reported.has(key)) {
                reported.add(key);
                const confidence = computeConfidence(arch002.baseConfidence, {
                  hasNamespaceOrDefaultImport: pathInfo.hasNs,
                  hasDynamicImport: pathInfo.hasDynamic,
                  isTestOrStories: isTestOrStoriesPath(start),
                  isDtsOrGenerated: isDtsOrGeneratedPath(start),
                });
                ctx.report({
                  ruleId: "ARCH002",
                  severity: "warning",
                  file: start,
                  message: "Client Boundary Pollution",
                  explanation: `A server-oriented dependency is reachable from a Client Component (${oriented.reason}).\n\n  Potential impact:\n    - unnecessary client bundle\n    - environment poisoning\n    - server-only code exposure`,
                  suggestion:
                    "Move data access behind a Server Component boundary, or add `import \"server-only\"` to make this an error.",
                  confidence,
                  path: {
                    nodes: pathInfo.nodes.map((nid) => ({
                      id: nid,
                      environment: ctx.getModule(nid)?.environment ?? "unknown",
                    })),
                    hasShakeableSegment: false,
                  },
                });
              }
            }
          }

          for (const imp of mod.imports) {
            if (!imp.isTypeOnly && !imp.unresolved) queue.push(imp.to);
          }
        }
      },
    };
  },
};
