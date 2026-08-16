import type {
  Diagnostic,
  ModuleNode,
  RouteNode,
  RuleCategory,
  Severity,
} from "./types.js";

export interface BoundaryEdge {
  from: string;
  to: string;
  /** The import edge that crosses the boundary. */
  importFrom: string;
  importTo: string;
}

export interface ArchitectureGraph {
  modules: Map<string, ModuleNode>;
  /** All resolved import edges (after export tracing). */
  edges: import("./types.js").ImportEdge[];
  routes: Map<string, RouteNode>;
  boundaries: BoundaryEdge[];
  /** Edges that caused server-forced modules to be colored client (P5). */
  conflicts: Array<{ edge: import("./types.js").ImportEdge; moduleId: string }>;
  get(id: string): ModuleNode | undefined;
  getClientModules(): ModuleNode[];
  getServerModules(): ModuleNode[];
}

export interface AnalysisContext {
  root: string;
  graph: ArchitectureGraph;
  config: NextArchitectConfig;
  fastMode: boolean;
  report(diagnostic: Diagnostic): void;
  /** Look up a module by id. */
  getModule(id: string): ModuleNode | undefined;
}

export interface RuleListener {
  onModule?(node: ModuleNode): void;
  onRoute?(node: RouteNode): void;
  onBoundary?(edge: BoundaryEdge): void;
  onFinish?(): void;
}

export interface RuleDocs {
  summary: string;
  url: string;
  /** Longer explanation for `explain`. */
  explanation: string;
  whyProblematic: string;
  incorrectExample: string;
  correctExample: string;
  exclusions: string[];
  falsePositiveNotes: string[];
}

export interface Rule {
  id: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  requiresTypeInfo: boolean;
  /** Base confidence (upper bound). */
  baseConfidence: number;
  docs: RuleDocs;
  create(ctx: AnalysisContext): RuleListener;
}

export type RuleSeveritySetting =
  | Severity
  | "off"
  | [Severity, Record<string, unknown>];

export interface NextArchitectConfig {
  root?: string;
  include?: string[];
  exclude?: string[];
  rules?: Record<string, RuleSeveritySetting>;
  minConfidence?: number;
  boundary?: {
    serverPackages?: string[];
    clientPackages?: string[];
  };
}

export function defineConfig(config: NextArchitectConfig): NextArchitectConfig {
  return config;
}

export const TOOL_VERSION = "0.1.0";
export const SCORE_FORMULA_VERSION = "1.0";
