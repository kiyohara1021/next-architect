import type { AnalysisContext, Rule, RuleListener } from "@next-architect/core";
import {
  computeConfidence,
  isDtsOrGeneratedPath,
  isTestOrStoriesPath,
} from "@next-architect/core";

function hasUnresolvedInDeps(ctx: AnalysisContext, moduleId: string): boolean {
  const start = ctx.getModule(moduleId);
  if (!start) return true;

  const seen = new Set<string>();
  const queue = [moduleId];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const mod = ctx.getModule(id);
    if (!mod) return true;
    for (const edge of mod.imports) {
      if (edge.isTypeOnly) continue;
      if (edge.unresolved) return true;
      if (!seen.has(edge.to)) queue.push(edge.to);
    }
  }
  return false;
}

export const arch001: Rule = {
  id: "ARCH001",
  category: "boundary",
  defaultSeverity: "warning",
  requiresTypeInfo: false,
  baseConfidence: 0.95,
  docs: {
    summary: "Unnecessary Client Component — \"use client\" with no client-only features",
    url: "https://github.com/kiyohara1021/next-architect/blob/main/docs/05-rules.md#arch001",
    explanation:
      "Detects files that declare \"use client\" but do not use hooks, event handlers, browser APIs, or transitively client-only modules.",
    whyProblematic:
      "\"use client\" is a Client module graph boundary. An unnecessary boundary pulls the module and its imports into the client bundle without benefit.",
    incorrectExample: `"use client";\n\nexport function UserName({ name }: { name: string }) {\n  return <span>{name}</span>;\n}`,
    correctExample: `export function UserName({ name }: { name: string }) {\n  return <span>{name}</span>;\n}`,
    exclusions: [
      "Unresolved imports in the dependency path",
      "error.tsx / global-error.tsx (implicitly Client)",
      "createContext present",
      "Third-party client-only packages (rule C3)",
      "Inline next-architect-disable",
      "node_modules",
    ],
    falsePositiveNotes: [
      "Custom hooks that only exist at runtime may be missed if unresolved — we stay silent when imports cannot be resolved.",
      "Weak signals (forwardRef/memo alone) produce INFO at low confidence, not WARNING.",
    ],
  },
  create(ctx: AnalysisContext): RuleListener {
    return {
      onModule(node) {
        if (node.isExternal) return;
        if (!node.directives.includes("use client")) return;

        // Exclusions
        if (
          node.routeKind === "error" ||
          node.id.includes("global-error")
        ) {
          return;
        }

        if (hasUnresolvedInDeps(ctx, node.id)) return;

        const strong = node.clientSignals.filter((s) => s.strength === "strong");
        const weak = node.clientSignals.filter((s) => s.strength === "weak");

        if (strong.length > 0) return;

        // createContext is strong already; double-check
        if (node.clientSignals.some((s) => s.name === "createContext")) return;

        const factors = {
          isTestOrStories: isTestOrStoriesPath(node.id),
          isDtsOrGenerated: isDtsOrGeneratedPath(node.id),
          isFastMode: ctx.fastMode,
        };

        if (weak.length > 0 && strong.length === 0) {
          // INFO, low confidence — weak signal only
          const confidence = computeConfidence(0.5, factors);
          ctx.report({
            ruleId: "ARCH001",
            severity: "info",
            file: node.id,
            line: 1,
            column: 1,
            message: "Potential unnecessary Client Component (weak signals only)",
            explanation:
              `"use client" is present; only weak signals (${weak.map((w) => w.name).join(", ")}) were found. forwardRef/memo alone do not require a client boundary.`,
            suggestion: 'Consider removing "use client" if no client features are needed.',
            confidence,
          });
          return;
        }

        // Nothing at all → WARNING
        const confidence = computeConfidence(arch001.baseConfidence, factors);
        const fixSafe =
          confidence >= 0.95 &&
          node.directives.length === 1 &&
          !hasUnresolvedInDeps(ctx, node.id);

        ctx.report({
          ruleId: "ARCH001",
          severity: "warning",
          file: node.id,
          line: 1,
          column: 1,
          message: "Potential unnecessary Client Component",
          explanation:
            '"use client" is present, but no client-only features were detected.\n\n  Checked:\n    ✗ hooks (useState, useEffect, ...)\n    ✗ event handlers\n    ✗ browser APIs\n    ✗ client-only imports\n    ✗ transitively client-only custom hooks',
          suggestion: 'Remove "use client"',
          confidence,
          fix: {
            safe: fixSafe,
            description: 'Remove "use client" directive',
            edits: [
              {
                file: node.id,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
                newText: "",
              },
            ],
          },
        });
      },
    };
  },
};
