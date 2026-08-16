import type { AnalysisContext, Rule, RuleListener } from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";
import { findWaterfallCandidates } from "@next-architect/graph";

/** ARCH005: base is capped at 0.80 and must not be raised via config. */
export const arch005: Rule = {
  id: "ARCH005",
  category: "data",
  defaultSeverity: "info",
  requiresTypeInfo: true,
  baseConfidence: 0.8,
  docs: {
    summary: "Potential Request Waterfall — sequential awaits that may be parallel",
    url: "https://github.com/kiyohara1021/next-architect/blob/main/docs/05-rules.md#arch005",
    explanation:
      "Finds consecutive awaits in async functions where a later await does not appear to depend on earlier results.",
    whyProblematic:
      "Independent data fetches done sequentially add latency (request waterfall).",
    incorrectExample: `const user = await getUser();\nconst products = await getProducts(); // independent`,
    correctExample: `const [user, products] = await Promise.all([getUser(), getProducts()]);`,
    exclusions: [
      "awaits inside try/catch, if/for/while",
      "cookies()/headers()/draftMode() ordering",
      "unused results / mutating call names",
    ],
    falsePositiveNotes: [
      "Static analysis cannot prove side-effect freedom. Severity is info-only; never auto-fixed.",
    ],
  },
  create(ctx: AnalysisContext): RuleListener {
    return {
      onModule(node) {
        if (node.isExternal) return;
        if (!node.awaits?.length) return;

        // Prefer server components / route handlers for data fetching advice
        if (
          node.environment !== "server" &&
          node.routeKind !== "page" &&
          node.routeKind !== "layout" &&
          node.routeKind !== "route"
        ) {
          // Still analyze shared server-reachable modules
          if (node.environment === "client") return;
        }

        const candidates = findWaterfallCandidates(node.id, node.awaits);

        for (const c of candidates) {
          // Cap confidence at 0.8 always
          let confidence = computeConfidence(0.8, {
            isTestOrStories: isTestOrStoriesPath(node.id),
            isDtsOrGenerated: isDtsOrGeneratedPath(node.id),
            isFastMode: ctx.fastMode,
          });
          confidence = Math.min(0.8, confidence);

          const indep = c.independent.callName ?? "expression";
          const prev = c.preceding
            .map((a) => a.callName ?? `line ${a.loc.line}`)
            .join(", ");

          ctx.report({
            ruleId: "ARCH005",
            severity: "info", // fixed — cannot upgrade
            file: node.id,
            line: c.independent.loc.line,
            column: c.independent.loc.column,
            message: "Potential request waterfall",
            explanation: `${indep} does not appear to depend on previous results (${prev}).\n\n  Possible optimization:\n    await Promise.all([...])`,
            suggestion:
              "If the calls are independent and side-effect free, fetch them in parallel with Promise.all.",
            confidence,
          });
        }
      },
    };
  },
};
