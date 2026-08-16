import type {
  AnalysisContext,
  Diagnostic,
  NextArchitectConfig,
  Rule,
} from "@next-architect/core";
import type { ArchitectureGraph } from "@next-architect/core";
import { arch001 } from "./arch001.js";
import { arch002 } from "./arch002.js";
import { arch003 } from "./arch003.js";
import { arch004 } from "./arch004.js";
import { arch005 } from "./arch005.js";

export const allRules: Rule[] = [
  arch001,
  arch002,
  arch003,
  arch004,
  arch005,
];

export function getRule(id: string): Rule | undefined {
  return allRules.find((r) => r.id === id);
}

export interface RuleSelection {
  config: NextArchitectConfig;
  fastMode?: boolean;
  ruleFilter?: string[];
}

/**
 * Rules that will actually run. The score needs this too: a category with no
 * active rules is excluded rather than counted as a perfect 100 (docs/07).
 */
export function resolveActiveRules(selection: RuleSelection): Rule[] {
  const { config, fastMode = false, ruleFilter } = selection;

  return allRules.filter((r) => {
    if (ruleFilter && ruleFilter.length > 0 && !ruleFilter.includes(r.id)) {
      return false;
    }
    if (config.rules?.[r.id] === "off") return false;
    if (fastMode && r.requiresTypeInfo) return false;
    return true;
  });
}

export function runRules(options: {
  graph: ArchitectureGraph;
  root: string;
  config: NextArchitectConfig;
  fastMode?: boolean;
  ruleFilter?: string[];
}): Diagnostic[] {
  const { graph, root, config, fastMode = false, ruleFilter } = options;
  const diagnostics: Diagnostic[] = [];

  // ARCH005 stays info even when configured higher; enforced in report().
  const rules = resolveActiveRules({ config, fastMode, ruleFilter });

  const ctx: AnalysisContext = {
    root,
    graph,
    config,
    fastMode,
    report(d) {
      // Apply severity overrides from config (except ARCH005 upgrade)
      const setting = config.rules?.[d.ruleId];
      if (setting && setting !== "off") {
        const sev = Array.isArray(setting) ? setting[0] : setting;
        if (d.ruleId === "ARCH005") {
          d.severity = "info";
        } else if (sev === "error" || sev === "warning" || sev === "info") {
          d.severity = sev;
        }
      }
      diagnostics.push(d);
    },
    getModule(id) {
      return graph.get(id);
    },
  };

  const listeners = rules.map((r) => ({ rule: r, listener: r.create(ctx) }));

  for (const mod of graph.modules.values()) {
    if (mod.isExternal && !mod.id.startsWith("unresolved:")) {
      // Still allow rules to see external nodes if they want via graph
    }
    for (const { listener } of listeners) {
      listener.onModule?.(mod);
    }
  }

  for (const route of graph.routes.values()) {
    for (const { listener } of listeners) {
      listener.onRoute?.(route);
    }
  }

  for (const boundary of graph.boundaries) {
    for (const { listener } of listeners) {
      listener.onBoundary?.(boundary);
    }
  }

  for (const { listener } of listeners) {
    listener.onFinish?.();
  }

  return diagnostics;
}

export { arch001, arch002, arch003, arch004, arch005 };
