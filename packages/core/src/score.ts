import type {
  AnalysisResult,
  ArchitectureScore,
  Diagnostic,
  RuleCategory,
  ScoreUnavailableReason,
  Severity,
} from "./types.js";
import { SCORE_FORMULA_VERSION } from "./rule.js";

const CATEGORY_WEIGHTS: Record<RuleCategory, number> = {
  boundary: 0.3,
  dependency: 0.25,
  data: 0.15,
  route: 0.1,
  bundle: 0.1,
  security: 0.1,
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 15,
  warning: 5,
  info: 1,
};

const RULE_CATEGORIES: Record<string, RuleCategory> = {
  ARCH001: "boundary",
  ARCH002: "dependency",
  ARCH003: "boundary",
  ARCH004: "bundle",
  ARCH005: "data",
};

/** Rule ids shipped in v0.1 — the default when no filter is applied. */
export const V01_RULE_IDS = Object.keys(RULE_CATEGORIES);

/**
 * Count rules that actually ran, per category. A category with zero active
 * rules is excluded from the score rather than counted as 100 (docs/07).
 */
function activeRuleCounts(ruleIds: string[]): Record<RuleCategory, number> {
  const counts: Record<RuleCategory, number> = {
    boundary: 0,
    dependency: 0,
    data: 0,
    route: 0,
    bundle: 0,
    security: 0,
  };
  for (const id of ruleIds) {
    const category = RULE_CATEGORIES[id];
    if (category) counts[category] += 1;
  }
  return counts;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Compute Architecture Score (docs/07).
 * Returns null overall when coverage < 0.9, partial analysis, or rule filter.
 */
export function computeScore(options: {
  diagnostics: Diagnostic[];
  moduleCount: number;
  clientModuleCount: number;
  coverage: number;
  partialAnalysis?: boolean;
  /** Rules that actually ran; defaults to all v0.1 rules. */
  activeRuleIds?: string[];
  /** Distinguishes `--rule` from `--fast` in the unavailable reason. */
  fastMode?: boolean;
}): ArchitectureScore {
  const {
    diagnostics,
    moduleCount,
    clientModuleCount,
    coverage,
    partialAnalysis = false,
    activeRuleIds = V01_RULE_IDS,
    fastMode = false,
  } = options;

  const counts = activeRuleCounts(activeRuleIds);

  const categories = (
    Object.keys(CATEGORY_WEIGHTS) as RuleCategory[]
  ).map((category) => {
    const activeRuleCount = counts[category];
    if (activeRuleCount === 0) {
      return {
        category,
        score: null as number | null,
        weight: CATEGORY_WEIGHTS[category],
        activeRuleCount: 0,
      };
    }

    const relevantCount =
      category === "boundary" || category === "dependency" || category === "bundle"
        ? Math.max(1, clientModuleCount)
        : Math.max(1, moduleCount);

    const scaleFactor = clamp(50 / relevantCount, 0.3, 1.0);

    const catDiagnostics = diagnostics.filter(
      (d) => RULE_CATEGORIES[d.ruleId] === category && !d.suppressed,
    );

    let deduction = 0;
    for (const d of catDiagnostics) {
      deduction += SEVERITY_WEIGHT[d.severity] * d.confidence * scaleFactor;
    }

    const raw = 100 - Math.min(100, deduction);
    return {
      category,
      score: Math.round(raw) as number | null,
      weight: CATEGORY_WEIGHTS[category],
      activeRuleCount,
    };
  });

  let overall: number | null = null;
  let unavailableReason: ScoreUnavailableReason | undefined;

  if (partialAnalysis) {
    unavailableReason = fastMode ? "fast-mode" : "partial-rules";
  } else if (coverage < 0.9) {
    unavailableReason = "low-coverage";
  } else {
    let weightedSum = 0;
    let weightSum = 0;
    for (const c of categories) {
      if (c.score === null) continue;
      weightedSum += c.weight * c.score;
      weightSum += c.weight;
    }
    if (weightSum > 0) {
      overall = Math.round(weightedSum / weightSum);
    } else {
      unavailableReason = "no-active-rules";
    }
  }

  return {
    overall,
    categories,
    coverage,
    formulaVersion: SCORE_FORMULA_VERSION,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

export function filterDiagnostics(
  diagnostics: Diagnostic[],
  minConfidence: number,
  includeShakeable: boolean,
): { visible: Diagnostic[]; hidden: Diagnostic[] } {
  const visible: Diagnostic[] = [];
  const hidden: Diagnostic[] = [];

  for (const d of diagnostics) {
    if (d.suppressed === "config" || d.suppressed === "inline") {
      hidden.push(d);
      continue;
    }
    if (!includeShakeable && d.path?.hasShakeableSegment) {
      const suppressed = { ...d, suppressed: "below-threshold" as const };
      hidden.push(suppressed);
      continue;
    }
    if (d.confidence < minConfidence) {
      const suppressed = { ...d, suppressed: "below-threshold" as const };
      hidden.push(suppressed);
      continue;
    }
    visible.push(d);
  }

  return { visible, hidden };
}

export function determineExitCode(
  diagnostics: Diagnostic[],
  ci: boolean,
  analysisFailed: boolean,
): number {
  if (analysisFailed) return 2;
  const ciThreshold = 0.8;
  for (const d of diagnostics) {
    if (d.suppressed) continue;
    if (d.severity === "error") return 1;
    if (ci && d.severity === "warning" && d.confidence >= ciThreshold) {
      return 1;
    }
  }
  return 0;
}

export type { AnalysisResult };
