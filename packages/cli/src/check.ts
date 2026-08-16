import fs from "node:fs";
import path from "node:path";
import {
  TOOL_VERSION,
  computeScore,
  filterDiagnostics,
  determineExitCode,
  DEFAULT_DISPLAY_CONFIDENCE,
  type AnalysisResult,
  type NextArchitectConfig,
} from "@next-architect/core";
import {
  discoverProject,
  parseProject,
  ProjectDiscoveryError,
} from "@next-architect/parser";
import { buildGraph } from "@next-architect/graph";
import { runRules, getRule, resolveActiveRules } from "@next-architect/rules";
import { formatPretty, formatJson } from "@next-architect/reporters";

export interface CheckOptions {
  root?: string;
  rules?: string[];
  format?: "pretty" | "json" | "sarif" | "github";
  ci?: boolean;
  minConfidence?: number;
  includeShakeable?: boolean;
  showSuppressed?: boolean;
  fast?: boolean;
  noCache?: boolean;
  verbose?: boolean;
  config?: NextArchitectConfig;
}

export interface CheckOutcome {
  result: AnalysisResult;
  exitCode: number;
  output: string;
}

function loadConfig(root: string): NextArchitectConfig {
  const jsonPath = path.join(root, "next-architect.config.json");
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as NextArchitectConfig;
  }

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      "next-architect"?: NextArchitectConfig;
    };
    if (pkg["next-architect"]) return pkg["next-architect"];
  }

  return {};
}

/** Run full analysis pipeline and format output. */
export async function runCheck(
  options: CheckOptions = {},
): Promise<CheckOutcome> {
  let project;
  try {
    project = discoverProject(options.root);
  } catch (err) {
    const message =
      err instanceof ProjectDiscoveryError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const result: AnalysisResult = {
      version: TOOL_VERSION,
      analyzedAt: new Date().toISOString(),
      project: {
        root: options.root ?? process.cwd(),
        router: "app",
        moduleCount: 0,
        routeCount: 0,
      },
      diagnostics: [],
      score: {
        overall: null,
        categories: [],
        coverage: 0,
        formulaVersion: "1.0",
      },
      limitations: [{ kind: "parse-error", detail: message }],
    };
    return {
      result,
      exitCode: 2,
      output:
        options.format === "json"
          ? formatJson(result)
          : `next-architect: ${message}`,
    };
  }

  const fileConfig = options.config ?? loadConfig(project.root);
  const config: NextArchitectConfig = {
    ...fileConfig,
    root: options.root ?? fileConfig.root ?? project.root,
  };

  const parsed = parseProject(project, {
    cache: !(options.noCache ?? false),
  });
  const { graph, limitations: graphLimitations } = buildGraph(parsed);
  const allLimitations = [...parsed.limitations, ...graphLimitations];

  const fastMode = options.fast ?? false;
  const activeRules = resolveActiveRules({
    config,
    fastMode,
    ruleFilter: options.rules,
  });

  const diagnostics = runRules({
    graph,
    root: project.root,
    config,
    fastMode,
    ruleFilter: options.rules,
  });

  const unresolvedCount = allLimitations.filter(
    (l) => l.kind === "unresolved-import",
  ).length;
  const moduleCount = [...graph.modules.values()].filter(
    (m) => !m.isExternal && !m.id.startsWith("unresolved:"),
  ).length;
  const coverage =
    moduleCount === 0
      ? 0
      : Math.max(0, 1 - unresolvedCount / Math.max(moduleCount, 1));

  const partialAnalysis = !!(options.rules?.length || options.fast);

  const localModules = [...graph.modules.values()].filter(
    (m) => !m.isExternal && !m.id.startsWith("unresolved:"),
  );
  const clientModuleCount = localModules.filter(
    (m) => m.environment === "client",
  ).length;
  const serverModuleCount = localModules.filter(
    (m) => m.environment === "server",
  ).length;
  const sharedModuleCount = localModules.filter(
    (m) => m.environment === "shared",
  ).length;

  const score = computeScore({
    diagnostics,
    moduleCount,
    clientModuleCount: graph.getClientModules().filter((m) => !m.isExternal)
      .length,
    coverage,
    partialAnalysis,
    activeRuleIds: activeRules.map((r) => r.id),
    fastMode,
  });

  const minConfidence =
    options.minConfidence ??
    config.minConfidence ??
    DEFAULT_DISPLAY_CONFIDENCE;

  const { visible, hidden } = filterDiagnostics(
    diagnostics,
    minConfidence,
    options.includeShakeable ?? false,
  );

  const displayDiagnostics = options.showSuppressed
    ? [...visible, ...hidden]
    : visible;

  const result: AnalysisResult = {
    version: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    project: {
      root: project.root,
      nextVersion: project.nextVersion,
      router: project.router,
      moduleCount,
      routeCount: graph.routes.size,
      clientModuleCount,
      serverModuleCount,
      sharedModuleCount,
    },
    diagnostics: displayDiagnostics,
    score,
    limitations: allLimitations,
  };

  if (options.format === "json") {
    result.diagnostics = diagnostics.map((d) => {
      const isHidden = hidden.some(
        (h) =>
          h.ruleId === d.ruleId &&
          h.file === d.file &&
          h.line === d.line &&
          h.message === d.message,
      );
      if (isHidden && !d.suppressed) {
        return { ...d, suppressed: "below-threshold" as const };
      }
      return d;
    });
  }

  const exitCode = determineExitCode(visible, options.ci ?? false, false);

  let output: string;
  if (options.format === "json") {
    output = formatJson(result);
  } else {
    output = formatPretty(result, displayDiagnostics, {
      color: !(options.ci ?? false),
      verbose: options.verbose,
      hiddenCount: hidden.length,
    });
    if (options.format === "sarif" || options.format === "github") {
      output += `\n\n(Note: --format ${options.format} is planned for v0.2; showing pretty output.)`;
    }
  }

  return { result, exitCode, output };
}

export function formatExplain(ruleId: string): string {
  if (ruleId === "score") {
    return `Architecture Score formula (v1.0)
================================

categoryScore = 100 - min(100, Σ (weight(severity) × confidence × scaleFactor))

severity weights: error=15, warning=5, info=1
scaleFactor = clamp(50 / relevantModuleCount, 0.3, 1.0)

Category weights:
  Boundary    30%
  Dependency  25%
  Data        15%
  Route       10%
  Bundle      10%
  Security    10%

Categories with zero active rules are excluded; remaining weights are renormalized.

Constraints:
  - Score is NOT used for --ci exit codes
  - No --min-score gate is provided
  - Formula changes only on major versions

This score represents detected architecture risks, not application quality.
`;
  }

  const rule = getRule(ruleId.toUpperCase());
  if (!rule) {
    return `Unknown rule: ${ruleId}\nAvailable: ARCH001, ARCH002, ARCH003, ARCH004, ARCH005, score`;
  }

  const d = rule.docs;
  return `${rule.id} — ${d.summary}
Category: ${rule.category}
Default severity: ${rule.defaultSeverity}
Base confidence: ${rule.baseConfidence}
Requires type info: ${rule.requiresTypeInfo}

What it detects
---------------
${d.explanation}

Why it matters
--------------
${d.whyProblematic}

Incorrect
---------
${d.incorrectExample}

Correct
-------
${d.correctExample}

Not reported when
-----------------
${d.exclusions.map((e) => `- ${e}`).join("\n") || "(none)"}

False positive notes
--------------------
${d.falsePositiveNotes.map((e) => `- ${e}`).join("\n") || "(none)"}

Docs: ${d.url}
`;
}
