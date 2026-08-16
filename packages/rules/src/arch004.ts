import type { AnalysisContext, Rule, RuleListener } from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";

const DEFAULT_MAX_KB = 100;
const IGNORE_DEFAULT = new Set(["react", "react-dom", "next"]);

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
    exclusions: ["react", "react-dom", "next"],
    falsePositiveNotes: [
      "Size is approximate unpacked node_modules size, not minified/gzipped bundle size.",
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

    const reported = new Set<string>();

    return {
      onFinish() {
        for (const client of ctx.graph.getClientModules()) {
          if (client.isExternal) continue;

          for (const edge of client.imports) {
            const to = ctx.getModule(edge.to);
            if (!to?.isExternal || !to.packageName) continue;
            if (ignore.has(to.packageName)) continue;
            if (to.packageName.startsWith("next/")) continue;

            const size = to.sizeBytes ?? 0;
            if (size < maxSizeKb * 1024) continue;

            const key = `${client.id}:${to.packageName}`;
            if (reported.has(key)) continue;
            reported.add(key);

            const kb = Math.round(size / 1024);
            ctx.report({
              ruleId: "ARCH004",
              severity: "info",
              file: client.id,
              line: edge.loc.line,
              column: edge.loc.column,
              message: "Large dependency enters client bundle",
              explanation: `Estimated unpacked size: ~${kb} KB (approximate; see notes)\n  sizeSource: unpacked\n\n  Consider:\n    - import the specific submodule directly\n    - next/dynamic with { ssr: false }\n    - move the processing to a Server Component`,
              suggestion:
                "Prefer a lighter import path or load the dependency only on the server when possible. For exact sizes use @next/bundle-analyzer.",
              confidence: computeConfidence(arch004.baseConfidence, {
                hasShakeableSegment: edge.reachability === "shakeable",
                hasDynamicImport: edge.type === "dynamic",
                isTestOrStories: isTestOrStoriesPath(client.id),
                isDtsOrGenerated: isDtsOrGeneratedPath(client.id),
              }),
              path: {
                nodes: [
                  { id: client.id, environment: "client", loc: edge.loc },
                  { id: to.packageName, environment: to.environment },
                ],
                hasShakeableSegment: edge.reachability === "shakeable",
              },
            });
          }
        }
      },
    };
  },
};
