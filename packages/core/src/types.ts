/** Source location within a file. */
export interface SourceLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export type Environment =
  | "server"
  | "client"
  | "shared"
  | "edge"
  | "unknown";

export interface EnvReason {
  kind:
    | "directive"
    | "propagated"
    | "route-convention"
    | "forced"
    | "reachability"
    | "unresolved";
  /** Propagated: import path from the coloring source. */
  via?: string[];
}

export type RuleCategory =
  | "boundary"
  | "dependency"
  | "data"
  | "route"
  | "bundle"
  | "security";

/** Client-only feature signals (docs/03 §3.4). */
export interface ClientSignal {
  kind:
    | "hook"
    | "react-api"
    | "event-handler"
    | "browser-api"
    | "next-client-api"
    | "class-component"
    | "transitive-hook"
    | "client-module"
    | "client-only-import";
  strength: "strong" | "weak";
  name: string;
  loc?: SourceLocation;
  via?: string[];
}

export interface ExportInfo {
  name: string;
  /** Re-export source module id, if re-exported. */
  from?: string;
  isTypeOnly: boolean;
  /** True for `export * from`. */
  isStar?: boolean;
  loc?: SourceLocation;
}

export interface ImportEdge {
  from: string;
  to: string;
  type: "static" | "dynamic" | "type" | "side-effect";
  isTypeOnly: boolean;
  /** Named imports. default → "default", namespace → "*". */
  importedNames: string[];
  /** Tree-shaking classification (docs/03 §3.3). */
  reachability: "direct" | "shakeable";
  /** Intermediate barrel files when tracing named exports. */
  through: string[];
  loc: SourceLocation;
  /** Specifier as written in source (before resolution). */
  specifier: string;
  /** True when module resolution failed. */
  unresolved?: boolean;
}

export type RouteKind =
  | "page"
  | "layout"
  | "template"
  | "error"
  | "loading"
  | "route"
  | "default";

/**
 * A single `await` extracted from an async function (docs/03 §3.5).
 * Produced by the parser so ARCH005 never re-reads or re-parses source.
 */
export interface AwaitInfo {
  id: string;
  /** Bound identifier names from this await (const x = await ...). */
  boundNames: string[];
  /** Identifiers referenced in the await argument. */
  referencedNames: string[];
  /** The awaited call name if identifiable (getUser). */
  callName?: string;
  loc: SourceLocation;
  /** Structural exclusion reasons (D3). */
  excluded: boolean;
  excludeReason?: string;
  /** Return value appears unused (void / no binding). */
  unusedResult: boolean;
}

export interface ModuleNode {
  id: string;
  path: string;
  environment: Environment;
  environmentReason: EnvReason;
  directives: string[];
  /** Location of the leading file directive, covering the whole statement. */
  directiveLoc?: SourceLocation;
  imports: ImportEdge[];
  exports: ExportInfo[];
  isRoute: boolean;
  routeKind?: RouteKind;
  clientSignals: ClientSignal[];
  /** Whether this module is outside analyzed source (typically node_modules). */
  isExternal: boolean;
  sizeBytes?: number;
  /** Forced by `import "server-only"`. */
  forcedServer?: boolean;
  /** Forced by `import "client-only"`. */
  forcedClient?: boolean;
  /** Has `"use server"` file directive (Server Action boundary). */
  hasServerActionDirective?: boolean;
  /** Package name when external. */
  packageName?: string;
  /**
   * External package judged client-only by C3 (docs/03 §3.4) — either it
   * declares `"use client"` or its own code calls client-only React APIs.
   */
  isClientOnlyPackage?: boolean;
  /** Awaits extracted at parse time (cached); undefined when not analyzed. */
  awaits?: AwaitInfo[];
}

export interface RouteSegment {
  name: string;
  kind:
    | "static"
    | "dynamic"
    | "catch-all"
    | "optional-catch-all"
    | "group"
    | "parallel"
    | "intercepting";
}

export interface RouteNode {
  id: string;
  segments: RouteSegment[];
  page?: string;
  layouts: string[];
  handlers?: string;
  children: string[];
  moduleClosure: string[];
  clientClosure: string[];
}

export type Severity = "error" | "warning" | "info";

export interface DiagnosticPath {
  nodes: Array<{
    id: string;
    environment: Environment;
    loc?: SourceLocation;
  }>;
  hasShakeableSegment: boolean;
}

export interface TextEdit {
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  newText: string;
}

export interface Fix {
  safe: boolean;
  description: string;
  edits: TextEdit[];
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  explanation?: string;
  suggestion?: string;
  confidence: number;
  path?: DiagnosticPath;
  fix?: Fix;
  suppressed?: "config" | "inline" | "below-threshold";
  /** Approximate unpacked size of the reported package (docs/05 ARCH004). */
  sizeBytes?: number;
  /** Always "unpacked" — never bundled/minified/gzipped size. */
  sizeSource?: "unpacked";
  /** Named exports the client graph actually pulls from the package. */
  usedExports?: string[];
}

export interface Limitation {
  kind:
    | "unresolved-import"
    | "unsupported-router"
    | "dynamic-config"
    | "parse-error"
    | "unsupported-next-version";
  file?: string;
  detail: string;
}

/** Why `overall` is null (docs/07 §7.5). */
export type ScoreUnavailableReason =
  | "partial-rules"
  | "fast-mode"
  | "low-coverage"
  | "no-active-rules";

export interface ArchitectureScore {
  overall: number | null;
  categories: Array<{
    category: RuleCategory;
    score: number | null;
    weight: number;
    activeRuleCount: number;
  }>;
  coverage: number;
  formulaVersion: string;
  /** Set when overall is null, so the reporter can say why. */
  unavailableReason?: ScoreUnavailableReason;
}

export interface AnalysisResult {
  version: string;
  analyzedAt: string;
  project: {
    root: string;
    nextVersion?: string;
    router: "app" | "pages" | "hybrid";
    moduleCount: number;
    routeCount: number;
    /** Environment breakdown of analyzed (non-external) modules. */
    clientModuleCount?: number;
    serverModuleCount?: number;
    sharedModuleCount?: number;
  };
  diagnostics: Diagnostic[];
  score: ArchitectureScore;
  limitations: Limitation[];
}

/** Confidence penalty factors (docs/04 §4.5). */
export const CONFIDENCE_PENALTIES = {
  unresolvedImport: 0.5,
  shakeableSegment: 0.6,
  namespaceOrDefaultImport: 0.8,
  dynamicImport: 0.9,
  testOrStories: 0.3,
  dtsOrGenerated: 0.1,
  fastMode: 0.85,
} as const;

export const DEFAULT_DISPLAY_CONFIDENCE = 0.7;
export const DEFAULT_CI_CONFIDENCE = 0.8;
export const FIX_MIN_CONFIDENCE = 0.95;

export interface ConfidenceFactors {
  hasUnresolvedImport?: boolean;
  hasShakeableSegment?: boolean;
  hasNamespaceOrDefaultImport?: boolean;
  hasDynamicImport?: boolean;
  isTestOrStories?: boolean;
  isDtsOrGenerated?: boolean;
  isFastMode?: boolean;
}

/** confidence = base × Π(penalties); never exceeds base. */
export function computeConfidence(
  base: number,
  factors: ConfidenceFactors = {},
): number {
  let c = base;
  if (factors.hasUnresolvedImport) c *= CONFIDENCE_PENALTIES.unresolvedImport;
  if (factors.hasShakeableSegment) c *= CONFIDENCE_PENALTIES.shakeableSegment;
  if (factors.hasNamespaceOrDefaultImport) {
    c *= CONFIDENCE_PENALTIES.namespaceOrDefaultImport;
  }
  if (factors.hasDynamicImport) c *= CONFIDENCE_PENALTIES.dynamicImport;
  if (factors.isTestOrStories) c *= CONFIDENCE_PENALTIES.testOrStories;
  if (factors.isDtsOrGenerated) c *= CONFIDENCE_PENALTIES.dtsOrGenerated;
  if (factors.isFastMode) c *= CONFIDENCE_PENALTIES.fastMode;
  return Math.min(base, Math.round(c * 1000) / 1000);
}

export function isTestOrStoriesPath(filePath: string): boolean {
  return (
    /\.(test|spec|stories)\.[jt]sx?$/.test(filePath) ||
    /[\\/](__tests__|__mocks__|mocks)[\\/]/.test(filePath)
  );
}

export function isDtsOrGeneratedPath(filePath: string): boolean {
  return (
    filePath.endsWith(".d.ts") ||
    /[\\/](\.next|generated|__generated__)[\\/]/.test(filePath)
  );
}
