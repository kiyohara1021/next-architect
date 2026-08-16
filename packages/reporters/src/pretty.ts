import type {
  AnalysisResult,
  Diagnostic,
  Limitation,
} from "@next-architect/core";
import { TOOL_VERSION } from "@next-architect/core";

const LIMITATION_LABELS: Record<Limitation["kind"], [string, string]> = {
  "unresolved-import": [
    "import could not be resolved",
    "imports could not be resolved",
  ],
  "unsupported-router": [
    "router feature not fully supported",
    "router features not fully supported",
  ],
  "dynamic-config": [
    "configuration value could not be evaluated statically",
    "configuration values could not be evaluated statically",
  ],
  "parse-error": ["file could not be parsed", "files could not be parsed"],
  "unsupported-next-version": [
    "Next.js version not verified",
    "Next.js versions not verified",
  ],
};

const SCORE_UNAVAILABLE_REASONS: Record<string, string> = {
  "partial-rules": "only a subset of rules ran (--rule)",
  "fast-mode": "type-info rules were skipped (--fast)",
  "low-coverage": "analysis coverage is below 90%",
  "no-active-rules": "no scored rules were active",
};

/**
 * Always rendered, even when empty: a run that silently omits its own blind
 * spots reads as "the project is clean" (docs/09 release condition).
 */
function formatLimitations(
  result: AnalysisResult,
  verbose: boolean,
): string[] {
  const lines = ["Limitations"];

  if (result.limitations.length === 0) {
    lines.push("  none reported for this run");
    return lines;
  }

  const byKind = new Map<Limitation["kind"], Limitation[]>();
  for (const lim of result.limitations) {
    const bucket = byKind.get(lim.kind);
    if (bucket) bucket.push(lim);
    else byKind.set(lim.kind, [lim]);
  }

  for (const [kind, items] of byKind) {
    const [singular, plural] = LIMITATION_LABELS[kind];
    lines.push(`  ${items.length} ${items.length === 1 ? singular : plural}`);

    // Unresolved imports are routinely numerous; the rest are rare enough
    // that hiding them behind --verbose would just lose information.
    const detailLimit =
      verbose || kind !== "unresolved-import" ? items.length : 0;
    for (const item of items.slice(0, detailLimit)) {
      lines.push(`    - ${item.file ? `${item.file}: ` : ""}${item.detail}`);
    }
    if (detailLimit === 0) {
      lines.push("    (run with --verbose to list them)");
    }
  }

  lines.push(
    "  Diagnostics are suppressed on paths that touch these — findings may be missing.",
  );
  return lines;
}

export interface PrettyOptions {
  color?: boolean;
  verbose?: boolean;
  hiddenCount?: number;
}

function c(enabled: boolean, code: string, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function severityLabel(sev: Diagnostic["severity"], color: boolean): string {
  if (sev === "error") return c(color, "31;1", "ERROR");
  if (sev === "warning") return c(color, "33;1", "WARNING");
  return c(color, "36;1", "INFO");
}

function formatPath(d: Diagnostic): string {
  if (!d.path?.nodes.length) return "";
  const lines: string[] = [];
  for (let i = 0; i < d.path.nodes.length; i++) {
    const n = d.path.nodes[i]!;
    const prefix = i === 0 ? "    " : "          ↓ ";
    const env = n.environment;
    lines.push(`${prefix}${n.id}  [${env}]`);
  }
  return lines.join("\n");
}

export function formatPretty(
  result: AnalysisResult,
  visible: Diagnostic[],
  options: PrettyOptions = {},
): string {
  const color = options.color ?? true;
  const lines: string[] = [];

  lines.push(c(color, "1", `next-architect v${TOOL_VERSION}`));
  lines.push("");
  lines.push("Analyzing Next.js application...");

  const routerLabel =
    result.project.router === "app"
      ? "App Router"
      : result.project.router === "pages"
        ? "Pages Router"
        : "Hybrid Router";

  lines.push(
    `  ✓ Project detected          next@${result.project.nextVersion ?? "?"}, ${routerLabel}`,
  );
  lines.push(`  ✓ ${result.project.moduleCount} modules analyzed`);
  lines.push(`  ✓ ${result.project.routeCount} routes analyzed`);

  const { clientModuleCount, serverModuleCount, sharedModuleCount } =
    result.project;
  if (
    clientModuleCount !== undefined &&
    serverModuleCount !== undefined &&
    sharedModuleCount !== undefined
  ) {
    lines.push(
      `  ✓ Server/Client graph built  (${clientModuleCount} client, ${serverModuleCount} server, ${sharedModuleCount} shared)`,
    );
  }

  const unresolved = result.limitations.filter(
    (l) => l.kind === "unresolved-import",
  );
  if (unresolved.length) {
    lines.push(
      `  ⚠ ${unresolved.length} ${unresolved.length === 1 ? "import" : "imports"} could not be resolved   (see --verbose)`,
    );
  }

  for (const lim of result.limitations) {
    if (lim.kind === "unsupported-router") {
      lines.push(`  ⚠ ${lim.detail}`);
    }
    if (lim.kind === "unsupported-next-version") {
      lines.push(`  ⚠ ${lim.detail}`);
    }
  }

  lines.push("");

  if (result.score.overall !== null) {
    lines.push(`Architecture Score: ${result.score.overall}/100`);
  } else {
    lines.push("Architecture Score: not available");
    const reason = result.score.unavailableReason;
    if (reason) {
      lines.push(`  ${SCORE_UNAVAILABLE_REASONS[reason] ?? reason}.`);
    }
    if (result.score.coverage < 0.9) {
      lines.push(
        `  Coverage ${(result.score.coverage * 100).toFixed(0)}% — run with --verbose to see unresolved imports.`,
      );
    }
  }
  lines.push("");

  for (const d of visible) {
    const loc =
      d.line !== undefined
        ? `${d.file}:${d.line}${d.column ? `:${d.column}` : ""}`
        : d.file;
    lines.push(
      `${severityLabel(d.severity, color)}  ${d.ruleId}  ${d.message}`,
    );
    lines.push(`  ${loc}`);
    lines.push("");
    if (d.path) {
      lines.push(formatPath(d));
      lines.push("");
    }
    if (d.explanation) {
      for (const el of d.explanation.split("\n")) {
        lines.push(`    ${el}`);
      }
      lines.push("");
    }
    lines.push(`    Confidence: ${Math.round(d.confidence * 100)}%`);
    if (d.suggestion) {
      lines.push(`    → ${d.suggestion}`);
    }
    lines.push("");
  }

  const errors = visible.filter((d) => d.severity === "error").length;
  const warnings = visible.filter((d) => d.severity === "warning").length;
  const infos = visible.filter((d) => d.severity === "info").length;

  lines.push("────────────────────────────────────────");
  lines.push(
    `${warnings} warning${warnings === 1 ? "" : "s"}   ${infos} info   ${errors} error${errors === 1 ? "" : "s"}`,
  );

  const hidden = options.hiddenCount ?? 0;
  if (hidden > 0) {
    lines.push(
      `${hidden} diagnostic${hidden === 1 ? "" : "s"} hidden (below confidence threshold) — use --min-confidence 0`,
    );
  }

  lines.push("");
  lines.push(...formatLimitations(result, options.verbose ?? false));

  lines.push("");
  if (result.score.overall !== null) {
    lines.push(`Architecture Score: ${result.score.overall}/100`);
    for (const cat of result.score.categories) {
      const score =
        cat.score === null ? "–" : String(cat.score).padStart(3, " ");
      lines.push(
        `  ${cat.category.padEnd(12)} ${score}   (weight ${Math.round(cat.weight * 100)}%)`,
      );
    }
    lines.push(
      "  This score represents detected architecture risks, not application quality.",
    );
  }

  // Point at something that was actually reported.
  const hintRule = visible[0]?.ruleId ?? "ARCH001";
  lines.push("");
  lines.push(`Run \`next-architect explain ${hintRule}\` for details.`);

  return lines.join("\n");
}

export function formatJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}
