import path from "node:path";
import fs from "node:fs";
import type {
  Environment,
  EnvReason,
  ExportInfo,
  ImportEdge,
  Limitation,
  ModuleNode,
  RouteNode,
  RouteSegment,
  SourceLocation,
} from "@next-architect/core";
import type { ArchitectureGraph, BoundaryEdge } from "@next-architect/core";
import type {
  ExtractedModule,
  ParsedProject,
  RawImport,
  ResolveResult,
} from "@next-architect/parser";

class GraphImpl implements ArchitectureGraph {
  modules: Map<string, ModuleNode>;
  edges: ImportEdge[];
  routes: Map<string, RouteNode>;
  boundaries: BoundaryEdge[];
  conflicts: Array<{ edge: ImportEdge; moduleId: string }>;

  constructor(
    modules: Map<string, ModuleNode>,
    edges: ImportEdge[],
    routes: Map<string, RouteNode>,
    boundaries: BoundaryEdge[],
    conflicts: Array<{ edge: ImportEdge; moduleId: string }>,
  ) {
    this.modules = modules;
    this.edges = edges;
    this.routes = routes;
    this.boundaries = boundaries;
    this.conflicts = conflicts;
  }

  get(id: string): ModuleNode | undefined {
    return this.modules.get(id);
  }

  getClientModules(): ModuleNode[] {
    return [...this.modules.values()].filter((m) => m.environment === "client");
  }

  getServerModules(): ModuleNode[] {
    return [...this.modules.values()].filter(
      (m) => m.environment === "server" || m.environment === "edge",
    );
  }
}

function hasSideEffectsFalse(projectRoot: string, moduleId: string): boolean {
  // Walk up looking for package.json with sideEffects: false
  // For app source barrels, check nearest package.json
  const abs = path.join(projectRoot, moduleId);
  let dir = path.dirname(abs);
  const root = path.resolve(projectRoot);
  while (dir.startsWith(root)) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, "utf8")) as {
          sideEffects?: boolean | string[];
        };
        return json.sideEffects === false;
      } catch {
        return false;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Trace named imports through barrel re-exports (rules B1–B5).
 * `visited` is path-local so sibling re-export branches stay independent
 * while cyclic barrels (A→B→A) terminate without relying on depth alone.
 */
function traceNamedExports(
  modulesById: Map<string, ExtractedModule>,
  fromId: string,
  targetId: string,
  importedNames: string[],
  projectRoot: string,
  depth = 0,
  through: string[] = [],
  visited: Set<string> = new Set(),
): Array<{ to: string; names: string[]; through: string[]; shakeable: boolean }> {
  if (visited.has(targetId)) {
    return [{ to: targetId, names: importedNames, through, shakeable: false }];
  }
  // Soft ceiling for pathological non-cyclic re-export chains
  if (depth > 20) {
    return [{ to: targetId, names: importedNames, through, shakeable: false }];
  }

  const nextVisited = new Set(visited);
  nextVisited.add(targetId);

  const target = modulesById.get(targetId);
  if (!target) {
    return [{ to: targetId, names: importedNames, through, shakeable: false }];
  }

  // Default / namespace / empty → whole module (B4, B5)
  if (
    importedNames.length === 0 ||
    importedNames.includes("*") ||
    importedNames.includes("default")
  ) {
    return [{ to: targetId, names: importedNames, through, shakeable: false }];
  }

  const results: Array<{
    to: string;
    names: string[];
    through: string[];
    shakeable: boolean;
  }> = [];

  // Group which names are local vs re-exported
  const localNames: string[] = [];
  const reexportMap = new Map<string, string[]>(); // fromSpec → names

  for (const name of importedNames) {
    const exp = target.exports.find((e) => e.name === name && !e.isTypeOnly);
    const star = target.exports.find((e) => e.isStar && e.from);

    if (exp?.from) {
      const list = reexportMap.get(exp.from) ?? [];
      list.push(name);
      reexportMap.set(exp.from, list);
    } else if (exp) {
      localNames.push(name);
    } else if (star?.from) {
      // May come from export * — try resolve
      const list = reexportMap.get(star.from) ?? [];
      list.push(name);
      reexportMap.set(star.from, list);
    } else {
      // Can't resolve name — conservative: whole module (B3)
      return [
        {
          to: targetId,
          names: importedNames,
          through,
          shakeable: false,
        },
      ];
    }
  }

  if (localNames.length > 0) {
    results.push({
      to: targetId,
      names: localNames,
      through,
      shakeable: false,
    });
  }

  const isBarrel =
    reexportMap.size > 0 &&
    (path.basename(targetId).startsWith("index.") || reexportMap.size >= 1);

  for (const [fromSpec, names] of reexportMap) {
    // Resolve fromSpec relative to target
    // We need the resolved module id — look at target's imports or resolve heuristically
    const resolvedId = resolveRelativeSpec(targetId, fromSpec, modulesById);
    if (!resolvedId) {
      results.push({
        to: targetId,
        names,
        through,
        shakeable: false,
      });
      continue;
    }

    const nextThrough = [...through, targetId];
    const nested = traceNamedExports(
      modulesById,
      fromId,
      resolvedId,
      names,
      projectRoot,
      depth + 1,
      nextThrough,
      nextVisited,
    );

    const shakeable =
      isBarrel && hasSideEffectsFalse(projectRoot, targetId);

    for (const n of nested) {
      results.push({
        ...n,
        shakeable: n.shakeable || shakeable,
      });
    }
  }

  // If barrel without sideEffects:false, shakeable stays false (upgrade to direct)
  if (isBarrel && !hasSideEffectsFalse(projectRoot, targetId)) {
    return results.map((r) => ({ ...r, shakeable: false }));
  }

  return results.length
    ? results
    : [{ to: targetId, names: importedNames, through, shakeable: false }];
}

function resolveRelativeSpec(
  fromId: string,
  specifier: string,
  modulesById: Map<string, ExtractedModule>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    // Could be alias — check if any module imports match; fall back to id lookup
    for (const id of modulesById.keys()) {
      if (id === specifier || id.startsWith(specifier + "/")) return id;
    }
    return undefined;
  }

  const fromDir = path.posix.dirname(fromId);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
    `${joined}/index.jsx`,
  ];
  for (const c of candidates) {
    if (modulesById.has(c)) return c;
  }
  // Try without worrying about exact extension match in map
  for (const id of modulesById.keys()) {
    const noExt = id.replace(/\.(tsx?|jsx?)$/, "");
    if (
      noExt === joined ||
      noExt === `${joined}/index` ||
      id === joined
    ) {
      return id;
    }
  }
  return undefined;
}

function buildImportEdges(
  parsed: ParsedProject,
  modulesById: Map<string, ExtractedModule>,
  moduleNodes: Map<string, ModuleNode>,
): { edges: ImportEdge[]; limitations: Limitation[] } {
  const edges: ImportEdge[] = [];
  const limitations: Limitation[] = [];

  for (const mod of parsed.modules) {
    for (const raw of mod.imports) {
      if (raw.isTypeOnly || raw.type === "type") continue; // P3

      const resolved = parsed.resolveModule(mod.path, raw.specifier);

      if (resolved.unresolved) {
        limitations.push({
          kind: "unresolved-import",
          file: mod.id,
          detail: `Cannot resolve import "${raw.specifier}"`,
        });
        const unknownId = `unresolved:${mod.id}:${raw.specifier}`;
        if (!moduleNodes.has(unknownId)) {
          moduleNodes.set(unknownId, {
            id: unknownId,
            path: "",
            environment: "unknown",
            environmentReason: { kind: "unresolved" },
            directives: [],
            imports: [],
            exports: [],
            isRoute: false,
            clientSignals: [],
            isExternal: false,
          });
        }
        edges.push({
          from: mod.id,
          to: unknownId,
          type: raw.type,
          isTypeOnly: false,
          importedNames: raw.importedNames,
          reachability: "direct",
          through: [],
          loc: raw.loc,
          specifier: raw.specifier,
          unresolved: true,
        });
        continue;
      }

      if (resolved.isExternal && resolved.id) {
        // Ensure external node exists
        if (!moduleNodes.has(resolved.id)) {
          moduleNodes.set(resolved.id, {
            id: resolved.id,
            path: resolved.resolvedPath ?? "",
            environment: "shared",
            environmentReason: { kind: "unresolved" },
            directives: [],
            imports: [],
            exports: [],
            isRoute: false,
            clientSignals: [],
            isExternal: true,
            sizeBytes: resolved.sizeBytes,
            packageName: resolved.packageName,
            forcedServer: resolved.packageName === "server-only",
            forcedClient: resolved.packageName === "client-only",
          });

          // Detect "use client" in package entry for C3
          if (resolved.resolvedPath && fs.existsSync(resolved.resolvedPath)) {
            try {
              const head = fs.readFileSync(resolved.resolvedPath, "utf8").slice(0, 500);
              if (
                /["']use client["']/.test(head) ||
                head.trimStart().startsWith('"use client"') ||
                head.trimStart().startsWith("'use client'")
              ) {
                const node = moduleNodes.get(resolved.id)!;
                node.directives = ["use client"];
                node.environment = "client";
                node.environmentReason = { kind: "directive" };
              }
            } catch {
              // ignore
            }
          }
        }

        edges.push({
          from: mod.id,
          to: resolved.id,
          type: raw.type,
          isTypeOnly: false,
          importedNames: raw.importedNames,
          reachability: "direct",
          through: [],
          loc: raw.loc,
          specifier: raw.specifier,
        });
        continue;
      }

      const targetId = resolved.id!;
      const traced = traceNamedExports(
        modulesById,
        mod.id,
        targetId,
        raw.importedNames,
        parsed.project.root,
      );

      for (const t of traced) {
        edges.push({
          from: mod.id,
          to: t.to,
          type: raw.type,
          isTypeOnly: false,
          importedNames: t.names,
          reachability: t.shakeable ? "shakeable" : "direct",
          through: t.through,
          loc: raw.loc,
          specifier: raw.specifier,
        });
      }
    }
  }

  return { edges, limitations };
}

function seedEnvironments(
  modules: Map<string, ModuleNode>,
  projectRoot: string,
): Limitation[] {
  const limitations: Limitation[] = [];

  for (const mod of modules.values()) {
    if (mod.isExternal) continue;

    // Forced
    if (mod.forcedServer) {
      mod.environment = "server";
      mod.environmentReason = { kind: "forced" };
      continue;
    }
    if (mod.forcedClient || mod.directives.includes("use client")) {
      mod.environment = "client";
      mod.environmentReason = {
        kind: mod.forcedClient ? "forced" : "directive",
      };
      continue;
    }

    // Route conventions
    if (mod.routeKind === "route") {
      mod.environment = "server";
      mod.environmentReason = { kind: "route-convention" };
      continue;
    }
    if (
      mod.routeKind === "error" ||
      path.basename(mod.id).startsWith("global-error")
    ) {
      mod.environment = "client";
      mod.environmentReason = { kind: "route-convention" };
      continue;
    }
    if (mod.routeKind === "page" || mod.routeKind === "layout") {
      if (!mod.directives.includes("use client")) {
        mod.environment = "server";
        mod.environmentReason = { kind: "route-convention" };
        continue;
      }
    }

    // middleware
    const base = path.basename(mod.id);
    if (base.startsWith("middleware.")) {
      // Try to read runtime config — default edge
      let runtime: Environment = "edge";
      try {
        const content = fs.readFileSync(mod.path, "utf8");
        const m = content.match(
          /export\s+const\s+config\s*=\s*\{[^}]*runtime:\s*['"](\w+)['"]/,
        );
        if (m?.[1] === "nodejs" || m?.[1] === "node") {
          runtime = "server";
        } else if (!m) {
          limitations.push({
            kind: "dynamic-config",
            file: mod.id,
            detail:
              "middleware runtime not statically readable; assuming edge (stricter).",
          });
        }
      } catch {
        limitations.push({
          kind: "dynamic-config",
          file: mod.id,
          detail: "Could not read middleware; assuming edge.",
        });
      }
      mod.environment = runtime;
      mod.environmentReason = { kind: "route-convention" };
      continue;
    }

    // Default: shared (undetermined)
    mod.environment = "shared";
    mod.environmentReason = { kind: "reachability" };
  }

  return limitations;
}

function propagateClient(graph: {
  modules: Map<string, ModuleNode>;
  edges: ImportEdge[];
  conflicts: Array<{ edge: ImportEdge; moduleId: string }>;
}): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.isTypeOnly) continue;
      const from = graph.modules.get(edge.from);
      const to = graph.modules.get(edge.to);
      if (!from || !to) continue;
      if (from.environment !== "client") continue;
      if (to.environment === "client") continue;
      if (to.hasServerActionDirective) continue; // P2

      if (to.forcedServer) {
        graph.conflicts.push({ edge, moduleId: to.id });
        continue; // P5
      }

      to.environment = "client";
      to.environmentReason = {
        kind: "propagated",
        via: [from.id, ...(from.environmentReason.via ?? [])],
      };
      changed = true;
    }
  }
}

function resolveSharedByReachability(
  modules: Map<string, ModuleNode>,
  edges: ImportEdge[],
): void {
  // P6: shared modules only reachable from server → treat as server-equivalent
  // Build reverse reachability from client
  const reachableFromClient = new Set<string>();
  const queue: string[] = [];
  for (const m of modules.values()) {
    if (m.environment === "client") {
      reachableFromClient.add(m.id);
      queue.push(m.id);
    }
  }
  const outEdges = new Map<string, string[]>();
  for (const e of edges) {
    if (e.isTypeOnly) continue;
    const list = outEdges.get(e.from) ?? [];
    list.push(e.to);
    outEdges.set(e.from, list);
  }
  while (queue.length) {
    const id = queue.pop()!;
    for (const to of outEdges.get(id) ?? []) {
      if (!reachableFromClient.has(to)) {
        reachableFromClient.add(to);
        queue.push(to);
      }
    }
  }

  for (const m of modules.values()) {
    if (m.environment === "shared" && !reachableFromClient.has(m.id)) {
      m.environment = "server";
      m.environmentReason = { kind: "reachability" };
    }
  }
}

function parseRouteSegments(routePath: string): RouteSegment[] {
  const parts = routePath.split("/").filter(Boolean);
  return parts.map((name) => {
    if (name.startsWith("@")) {
      return { name, kind: "parallel" as const };
    }
    if (name.startsWith("(") && name.endsWith(")")) {
      return { name, kind: "group" as const };
    }
    if (name.startsWith("[[...") && name.endsWith("]]")) {
      return { name, kind: "optional-catch-all" as const };
    }
    if (name.startsWith("[...") && name.endsWith("]")) {
      return { name, kind: "catch-all" as const };
    }
    if (name.startsWith("[") && name.endsWith("]")) {
      return { name, kind: "dynamic" as const };
    }
    if (name.startsWith("(.") || name.startsWith("(..")) {
      return { name, kind: "intercepting" as const };
    }
    return { name, kind: "static" as const };
  });
}

function buildRoutes(
  modules: Map<string, ModuleNode>,
  edges: ImportEdge[],
  appDir: string | undefined,
  projectRoot: string,
): Map<string, RouteNode> {
  const routes = new Map<string, RouteNode>();
  if (!appDir) return routes;

  const appRel = path.relative(projectRoot, appDir).replace(/\\/g, "/");

  const pages = [...modules.values()].filter((m) => m.routeKind === "page");
  for (const page of pages) {
    // page id like src/app/dashboard/settings/page.tsx
    let dir = path.posix.dirname(page.id);
    if (dir.startsWith(appRel)) {
      dir = dir.slice(appRel.length);
    }
    dir = dir.replace(/^\//, "");
    const url =
      "/" +
      dir
        .split("/")
        .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
        .filter((s) => !s.startsWith("@"))
        .join("/");
    const routeId = url === "/" ? "/" : url.replace(/\/$/, "") || "/";

    // Collect layouts walking up
    const layouts: string[] = [];
    let walk = path.posix.dirname(page.id);
    while (walk && (walk === appRel || walk.startsWith(appRel))) {
      for (const m of modules.values()) {
        if (
          m.routeKind === "layout" &&
          path.posix.dirname(m.id) === walk
        ) {
          layouts.unshift(m.id);
        }
      }
      if (walk === appRel || walk === "." || walk === "") break;
      const parent = path.posix.dirname(walk);
      if (parent === walk) break;
      walk = parent;
    }

    const moduleClosure = computeClosure(page.id, layouts, edges);
    const clientClosure = moduleClosure.filter(
      (id) => modules.get(id)?.environment === "client",
    );

    routes.set(routeId, {
      id: routeId,
      segments: parseRouteSegments(dir),
      page: page.id,
      layouts,
      children: [],
      moduleClosure,
      clientClosure,
    });
  }

  return routes;
}

function computeClosure(
  pageId: string,
  layouts: string[],
  edges: ImportEdge[],
): string[] {
  const start = [pageId, ...layouts];
  const seen = new Set<string>(start);
  const queue = [...start];
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.isTypeOnly || e.unresolved) continue;
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  while (queue.length) {
    const id = queue.pop()!;
    for (const to of out.get(id) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return [...seen];
}

function findBoundaries(
  modules: Map<string, ModuleNode>,
  edges: ImportEdge[],
): BoundaryEdge[] {
  const boundaries: BoundaryEdge[] = [];
  for (const edge of edges) {
    if (edge.isTypeOnly) continue;
    const from = modules.get(edge.from);
    const to = modules.get(edge.to);
    if (!from || !to) continue;
    // Boundary = server → client import
    if (
      (from.environment === "server" || from.environment === "edge") &&
      to.environment === "client"
    ) {
      boundaries.push({
        from: from.id,
        to: to.id,
        importFrom: edge.from,
        importTo: edge.to,
      });
    }
  }
  return boundaries;
}

function toModuleNode(extracted: ExtractedModule): ModuleNode {
  return {
    id: extracted.id,
    path: extracted.path,
    environment: "shared",
    environmentReason: { kind: "reachability" },
    directives: extracted.directives,
    directiveLoc: extracted.directiveLoc,
    awaits: extracted.awaits,
    imports: [], // filled after edge resolution
    exports: extracted.exports,
    isRoute: extracted.isRoute,
    routeKind: extracted.routeKind,
    clientSignals: extracted.clientSignals,
    isExternal: false,
    forcedServer: extracted.forcedServer,
    forcedClient: extracted.forcedClient,
    hasServerActionDirective: extracted.hasServerActionDirective,
  };
}

/**
 * Build the architecture graph from a parsed project (pipeline ④⑤⑥).
 */
export function buildGraph(parsed: ParsedProject): {
  graph: ArchitectureGraph;
  limitations: Limitation[];
} {
  const modulesById = new Map(
    parsed.modules.map((m) => [m.id, m] as const),
  );
  const moduleNodes = new Map<string, ModuleNode>();
  for (const m of parsed.modules) {
    moduleNodes.set(m.id, toModuleNode(m));
  }

  const { edges, limitations: resolveLimitations } = buildImportEdges(
    parsed,
    modulesById,
    moduleNodes,
  );

  // Attach edges onto modules
  for (const edge of edges) {
    const mod = moduleNodes.get(edge.from);
    if (mod) mod.imports.push(edge);
  }

  const seedLimitations = seedEnvironments(
    moduleNodes,
    parsed.project.root,
  );

  // Also seed client from client-only packages already marked
  for (const m of moduleNodes.values()) {
    if (m.isExternal && m.directives.includes("use client")) {
      m.environment = "client";
      m.environmentReason = { kind: "directive" };
    }
    if (m.packageName === "client-only") {
      m.environment = "client";
      m.environmentReason = { kind: "forced" };
      m.forcedClient = true;
    }
    if (m.packageName === "server-only") {
      m.environment = "server";
      m.environmentReason = { kind: "forced" };
      m.forcedServer = true;
    }
  }

  const conflicts: Array<{ edge: ImportEdge; moduleId: string }> = [];
  propagateClient({ modules: moduleNodes, edges, conflicts });
  resolveSharedByReachability(moduleNodes, edges);

  // Enrich transitive client signals (C1, C2, C3)
  enrichTransitiveSignals(moduleNodes, edges);

  const routes = buildRoutes(
    moduleNodes,
    edges,
    parsed.project.appDir,
    parsed.project.root,
  );
  const boundaries = findBoundaries(moduleNodes, edges);

  const graph = new GraphImpl(
    moduleNodes,
    edges,
    routes,
    boundaries,
    conflicts,
  );

  return {
    graph,
    limitations: [...resolveLimitations, ...seedLimitations],
  };
}

function enrichTransitiveSignals(
  modules: Map<string, ModuleNode>,
  edges: ImportEdge[],
): void {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.isTypeOnly || e.unresolved) continue;
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }

  function hasStrongClientSignal(id: string, seen: Set<string>): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const m = modules.get(id);
    if (!m) return false;
    if (m.directives.includes("use client")) return true;
    if (m.forcedClient) return true;
    if (m.clientSignals.some((s) => s.strength === "strong")) return true;
    for (const to of out.get(id) ?? []) {
      const t = modules.get(to);
      if (!t) continue;
      if (t.isExternal && t.directives.includes("use client")) return true;
      if (t.packageName === "client-only") return true;
      if (!t.isExternal && hasStrongClientSignal(to, seen)) return true;
    }
    return false;
  }

  for (const m of modules.values()) {
    if (m.isExternal) continue;
    // C2/C3: imported module has use client
    for (const e of m.imports) {
      const to = modules.get(e.to);
      if (!to) continue;
      if (
        to.directives.includes("use client") ||
        to.packageName === "client-only" ||
        (to.isExternal && to.directives.includes("use client"))
      ) {
        m.clientSignals.push({
          kind: "client-module",
          strength: "strong",
          name: to.packageName ?? to.id,
          via: [to.id],
        });
      }
    }

    // C1: transitive hooks — if we already have transitive-hook placeholder, verify
    const transitiveHooks = m.clientSignals.filter(
      (s) => s.kind === "transitive-hook",
    );
    for (const sig of transitiveHooks) {
      // Find imported module that exports this hook
      let found = false;
      for (const e of m.imports) {
        if (
          e.importedNames.includes(sig.name) ||
          e.importedNames.includes("*")
        ) {
          if (hasStrongClientSignal(e.to, new Set())) {
            sig.via = [e.to];
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // Remove false transitive-hook if target has no client signals
        const idx = m.clientSignals.indexOf(sig);
        if (idx >= 0) m.clientSignals.splice(idx, 1);
      }
    }
  }
}

export type { ArchitectureGraph, BoundaryEdge };
