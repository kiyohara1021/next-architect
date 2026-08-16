import type {
  AnalysisContext,
  ImportEdge,
  ModuleNode,
  Rule,
  RuleListener,
} from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";

const DEFAULT_MAX_KB = 100;
const IGNORE_DEFAULT = new Set(["react", "react-dom", "next"]);

interface Reached {
  /** Module ids from the client entry down to the importing module. */
  pathIds: string[];
  /** First edge out of the entry — the import the reported file actually has. */
  entryEdge: ImportEdge;
  hasShakeableSegment: boolean;
  hasDynamicSegment: boolean;
  usedExports: Set<string>;
}

export const arch004: Rule = {
  id: "ARCH004",
  category: "bundle",
  defaultSeverity: "info",
  requiresTypeInfo: false,
  baseConfidence: 0.8,
  docs: {
    summary: "Large Dependency in Client Bundle — why a large package entered client",
    url: "https://github.com/kiyohara1021/next-architect/blob/main/docs/05-rules.md#arch004",
    explanation:
      "Reports large external packages reachable from the client graph, emphasizing the import path (why), not exact bundle size.",
    whyProblematic:
      "Large client dependencies increase download and parse cost. Knowing the entry path enables targeted fixes.",
    incorrectExample: `"use client";\nimport { Chart } from "huge-library";`,
    correctExample: `import dynamic from "next/dynamic";\nconst Chart = dynamic(() => import("./Chart"), { ssr: false });`,
    exclusions: [
      "react, react-dom, next",
      "shakeable (barrel) paths — hidden unless --include-shakeable",
      "packages whose unpacked size cannot be determined",
    ],
    falsePositiveNotes: [
      "Size is approximate unpacked node_modules size, not minified/gzipped bundle size.",
      "Used exports are the names the client graph imports; the package's own export count is not resolved, so no ratio is shown.",
    ],
  },
  create(ctx: AnalysisContext): RuleListener {
    const ruleConfig = ctx.config.rules?.ARCH004;
    let maxSizeKb = DEFAULT_MAX_KB;
    const ignore = new Set(IGNORE_DEFAULT);

    if (Array.isArray(ruleConfig) && ruleConfig[1]) {
      const opts = ruleConfig[1] as {
        maxSizeKb?: number;
        ignore?: string[];
      };
      if (opts.maxSizeKb) maxSizeKb = opts.maxSizeKb;
      if (opts.ignore) opts.ignore.forEach((p) => ignore.add(p));
    }

    function isReportablePackage(mod: ModuleNode | undefined): boolean {
      if (!mod?.isExternal || !mod.packageName) return false;
      if (ignore.has(mod.packageName)) return false;
      if (mod.packageName.startsWith("next/")) return false;
      return (mod.sizeBytes ?? 0) >= maxSizeKb * 1024;
    }

    /**
     * Walk the client graph from one entry, collecting large packages with the
     * path that pulled them in. Direct imports are only the shallowest case —
     * the interesting ones arrive through a shared module.
     */
    function walkFrom(entry: ModuleNode, visited: Set<string>): Reached[] {
      const found = new Map<string, Reached>();
      const pathTo = new Map<string, string[]>([[entry.id, [entry.id]]]);
      const shakeableTo = new Map<string, boolean>([[entry.id, false]]);
      const dynamicTo = new Map<string, boolean>([[entry.id, false]]);
      const entryEdgeTo = new Map<string, ImportEdge>();
      const queue = [entry.id];
      const seen = new Set<string>();

      while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        visited.add(id);

        const mod = ctx.getModule(id);
        if (!mod) continue;

        const basePath = pathTo.get(id) ?? [id];
        const baseShakeable = shakeableTo.get(id) ?? false;
        const baseDynamic = dynamicTo.get(id) ?? false;

        for (const edge of mod.imports) {
          if (edge.isTypeOnly || edge.unresolved) continue;

          const target = ctx.getModule(edge.to);
          // P2: client propagation stops at a Server Action boundary. Next.js
          // replaces the import with an RPC reference, so nothing behind it
          // reaches the bundle (docs/03 §3.3).
          if (target?.hasServerActionDirective) continue;
          const shakeable = baseShakeable || edge.reachability === "shakeable";
          const dynamic = baseDynamic || edge.type === "dynamic";
          // The diagnostic points at the entry file, so its line must be the
          // import that entry actually contains — not one in a module further
          // down the path.
          const entryEdge = id === entry.id ? edge : entryEdgeTo.get(id) ?? edge;

          if (isReportablePackage(target)) {
            const pkg = target!.packageName!;
            const existing = found.get(pkg);
            if (existing) {
              edge.importedNames.forEach((n) => existing.usedExports.add(n));
            } else {
              found.set(pkg, {
                pathIds: [...basePath, edge.to],
                entryEdge,
                hasShakeableSegment: shakeable,
                hasDynamicSegment: dynamic,
                usedExports: new Set(edge.importedNames),
              });
            }
            continue;
          }

          if (target?.isExternal || seen.has(edge.to)) continue;

          if (!pathTo.has(edge.to)) {
            pathTo.set(edge.to, [...basePath, edge.to]);
            shakeableTo.set(edge.to, shakeable);
            dynamicTo.set(edge.to, dynamic);
            entryEdgeTo.set(edge.to, entryEdge);
          }
          queue.push(edge.to);
        }
      }

      return [...found.values()];
    }

    return {
      onFinish() {
        const clientModules = ctx.graph
          .getClientModules()
          .filter((m) => !m.isExternal);

        // Client entries first, so the reported path starts at the boundary.
        // Anything left over is client-colored without a reachable entry and
        // becomes its own entry, otherwise it would go unreported.
        const entries = clientModules.filter(
          (m) => m.directives.includes("use client") || m.forcedClient,
        );
        const visited = new Set<string>();
        const roots = [
          ...entries,
          ...clientModules.filter((m) => !entries.includes(m)),
        ];

        // One report per package, not per client entry. The corpus showed
        // tailwind-merge reported eight times across eight components — each
        // one correct, and collectively noise (corpus/oss/REVIEW.md, D4).
        const reportedPackages = new Map<string, { entries: number }>();
        const pending: Array<{ root: ModuleNode; hit: Reached; pkg: string }> =
          [];

        for (const root of roots) {
          if (visited.has(root.id)) continue;
          for (const hit of walkFrom(root, visited)) {
            const pkgNode = ctx.getModule(hit.pathIds[hit.pathIds.length - 1]!);
            if (!pkgNode?.packageName) continue;
            const seen = reportedPackages.get(pkgNode.packageName);
            if (seen) {
              seen.entries += 1;
              continue;
            }
            reportedPackages.set(pkgNode.packageName, { entries: 1 });
            pending.push({ root, hit, pkg: pkgNode.packageName });
          }
        }

        {
          for (const { root, hit } of pending) {
            const pkg = ctx.getModule(hit.pathIds[hit.pathIds.length - 1]!);
            if (!pkg?.packageName) continue;
            const otherEntries =
              (reportedPackages.get(pkg.packageName)?.entries ?? 1) - 1;

            const sizeBytes = pkg.sizeBytes ?? 0;
            const kb = Math.round(sizeBytes / 1024);
            const usedExports = [...hit.usedExports].filter((n) => n !== "*");
            const usedLine =
              usedExports.length > 0
                ? `\n  Used exports: ${usedExports.join(", ")}`
                : "";
            const entriesLine =
              otherEntries > 0
                ? `\n  Also reached from ${otherEntries} other client ${otherEntries === 1 ? "entry" : "entries"}`
                : "";

            ctx.report({
              ruleId: "ARCH004",
              severity: "info",
              file: root.id,
              line: hit.entryEdge.loc.line,
              column: hit.entryEdge.loc.column,
              message: "Large dependency enters client bundle",
              explanation: `Estimated unpacked size: ~${kb} KB (approximate; see notes)\n  sizeSource: unpacked${usedLine}${entriesLine}\n\n  Consider:\n    - import the specific submodule directly\n    - next/dynamic with { ssr: false }\n    - move the processing to a Server Component`,
              suggestion:
                "Prefer a lighter import path or load the dependency only on the server when possible. For exact sizes use @next/bundle-analyzer.",
              confidence: computeConfidence(arch004.baseConfidence, {
                hasShakeableSegment: hit.hasShakeableSegment,
                hasDynamicImport: hit.hasDynamicSegment,
                isTestOrStories: isTestOrStoriesPath(root.id),
                isDtsOrGenerated: isDtsOrGeneratedPath(root.id),
              }),
              sizeBytes,
              sizeSource: "unpacked",
              ...(usedExports.length > 0 ? { usedExports } : {}),
              path: {
                nodes: hit.pathIds.map((id) => {
                  const mod = ctx.getModule(id);
                  return {
                    id: mod?.packageName ?? id,
                    environment: mod?.environment ?? "unknown",
                  };
                }),
                hasShakeableSegment: hit.hasShakeableSegment,
              },
            });
          }
        }
      },
    };
  },
};
