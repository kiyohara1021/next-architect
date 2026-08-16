import type { AnalysisContext, Rule, RuleListener } from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";

export const arch003: Rule = {
  id: "ARCH003",
  category: "boundary",
  defaultSeverity: "error",
  requiresTypeInfo: false,
  baseConfidence: 0.98,
  docs: {
    summary: "Server Module in Client Graph — server-only module pulled into client",
    url: "https://github.com/kiyohara1021/next-architect/blob/main/docs/05-rules.md#arch003",
    explanation:
      "A module that imports \"server-only\" (or is forced server) was colored into the client graph via imports.",
    whyProblematic:
      "This fails at Next.js build time when the route is built. next-architect reports it across all routes with the import path.",
    incorrectExample: `"use client";\nimport { getUser } from "@/lib/user"; // which imports "server-only"`,
    correctExample: `// Fetch in a Server Component and pass props to the Client Component`,
    exclusions: [],
    falsePositiveNotes: [
      "False positives should be near-zero; this mirrors a Next.js build failure.",
    ],
  },
  create(ctx: AnalysisContext): RuleListener {
    return {
      onFinish() {
        for (const conflict of ctx.graph.conflicts) {
          const edge = conflict.edge;
          const target = ctx.getModule(conflict.moduleId);
          const from = ctx.getModule(edge.from);

          // Find a client entry that reaches this
          const clientRoot = findClientRoot(ctx, edge.from);

          const confidence = computeConfidence(arch003.baseConfidence, {
            hasUnresolvedImport: !!edge.unresolved,
            hasShakeableSegment: edge.reachability === "shakeable",
            isTestOrStories: isTestOrStoriesPath(edge.from),
            isDtsOrGenerated: isDtsOrGeneratedPath(edge.from),
          });

          ctx.report({
            ruleId: "ARCH003",
            severity: "error",
            file: clientRoot ?? edge.from,
            line: edge.loc.line,
            column: edge.loc.column,
            message: "Server module imported by Client Component",
            explanation: `Module ${conflict.moduleId} is server-only but reachable from the client graph via ${edge.from}.`,
            suggestion:
              "Move the data access to a Server Component, or pass the resolved data down as props.",
            confidence,
            path: {
              nodes: [
                {
                  id: clientRoot ?? edge.from,
                  environment: "client",
                },
                {
                  id: edge.from,
                  environment: from?.environment ?? "client",
                },
                {
                  id: conflict.moduleId,
                  environment: "server",
                },
              ],
              hasShakeableSegment: edge.reachability === "shakeable",
            },
          });
        }

        // Also: client modules that directly or transitively import server-only
        // without being in conflicts (e.g. already client importing server-only package)
        for (const mod of ctx.graph.getClientModules()) {
          if (mod.isExternal) continue;
          for (const edge of mod.imports) {
            const to = ctx.getModule(edge.to);
            if (!to) continue;
            if (
              to.forcedServer ||
              to.packageName === "server-only" ||
              edge.specifier === "server-only"
            ) {
              // Avoid dup with conflicts
              const already = ctx.graph.conflicts.some(
                (c) => c.moduleId === to.id && c.edge.from === mod.id,
              );
              if (already) continue;

              ctx.report({
                ruleId: "ARCH003",
                severity: "error",
                file: mod.id,
                line: edge.loc.line,
                column: edge.loc.column,
                message: "Server module imported by Client Component",
                explanation: `Client module imports server-only module ${to.id}.`,
                suggestion:
                  "Move the data access to a Server Component, or pass the resolved data down as props.",
                confidence: computeConfidence(arch003.baseConfidence, {
                  isTestOrStories: isTestOrStoriesPath(mod.id),
                }),
                path: {
                  nodes: [
                    { id: mod.id, environment: "client" },
                    { id: to.id, environment: "server" },
                  ],
                  hasShakeableSegment: false,
                },
              });
            }
          }
        }
      },
    };
  },
};

function findClientRoot(ctx: AnalysisContext, fromId: string): string | undefined {
  const mod = ctx.getModule(fromId);
  if (mod?.directives.includes("use client")) return fromId;
  if (mod?.environmentReason.via?.length) {
    return mod.environmentReason.via[mod.environmentReason.via.length - 1];
  }
  // Search for a use client ancestor via reverse edges — approximate
  for (const m of ctx.graph.getClientModules()) {
    if (m.directives.includes("use client")) {
      if (m.id === fromId) return m.id;
    }
  }
  return fromId;
}
