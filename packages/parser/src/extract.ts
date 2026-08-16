import path from "node:path";
import ts from "typescript";
import type {
  ClientSignal,
  ExportInfo,
  Limitation,
  RouteKind,
  SourceLocation,
} from "@next-architect/core";

const STRONG_HOOKS = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useRef",
  "useContext",
  "useSyncExternalStore",
  "useOptimistic",
  "useFormStatus",
  "useTransition",
  "useDeferredValue",
  "useImperativeHandle",
  "useInsertionEffect",
]);

const NEXT_CLIENT_HOOKS = new Set([
  "useRouter",
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
]);

const WEAK_REACT_APIS = new Set(["forwardRef", "memo"]);
const STRONG_REACT_APIS = new Set(["createContext"]);

const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "matchMedia",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "addEventListener",
]);

export interface RawImport {
  specifier: string;
  type: "static" | "dynamic" | "type" | "side-effect";
  isTypeOnly: boolean;
  importedNames: string[];
  loc: SourceLocation;
}

export interface ExtractedModule {
  id: string;
  path: string;
  directives: string[];
  imports: RawImport[];
  exports: ExportInfo[];
  clientSignals: ClientSignal[];
  isRoute: boolean;
  routeKind?: RouteKind;
  forcedServer: boolean;
  forcedClient: boolean;
  hasServerActionDirective: boolean;
  contentHash: string;
}

function locOf(node: ts.Node, sf: ts.SourceFile): SourceLocation {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: start.line + 1, column: start.character + 1 };
}

function getDirectives(sf: ts.SourceFile): string[] {
  const directives: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) break;
    if (!ts.isStringLiteral(stmt.expression)) break;
    const text = stmt.expression.text;
    if (text === "use client" || text === "use server") {
      directives.push(text);
    } else {
      break;
    }
  }
  return directives;
}

function detectRouteKind(
  relativePath: string,
): { isRoute: boolean; routeKind?: RouteKind } {
  const base = path.basename(relativePath).replace(/\.(jsx?|tsx?)$/, "");
  const kinds: RouteKind[] = [
    "page",
    "layout",
    "template",
    "error",
    "loading",
    "route",
    "default",
  ];
  if (kinds.includes(base as RouteKind)) {
    // Must live under app/
    const normalized = relativePath.replace(/\\/g, "/");
    if (
      normalized.includes("/app/") ||
      normalized.startsWith("app/") ||
      normalized.includes("/src/app/") ||
      normalized.startsWith("src/app/")
    ) {
      return { isRoute: true, routeKind: base as RouteKind };
    }
  }
  if (base === "global-error") {
    return { isRoute: true, routeKind: "error" };
  }
  return { isRoute: false };
}

function collectClientSignals(
  sf: ts.SourceFile,
  imports: RawImport[],
): ClientSignal[] {
  const signals: ClientSignal[] = [];
  const importedBindings = new Map<string, { from: string; name: string }>();

  for (const imp of imports) {
    for (const name of imp.importedNames) {
      if (name === "*" || name === "default") continue;
      // Rough: local name equals imported name for named imports
      importedBindings.set(name, { from: imp.specifier, name });
    }
    if (imp.specifier === "client-only") {
      signals.push({
        kind: "client-only-import",
        strength: "strong",
        name: "client-only",
        loc: imp.loc,
      });
    }
  }

  function visit(node: ts.Node): void {
    // Hooks / React APIs / next hooks via call expressions
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let name: string | undefined;
      if (ts.isIdentifier(expr)) name = expr.text;
      else if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.name)
      ) {
        name = expr.name.text;
      }

      if (name) {
        if (STRONG_HOOKS.has(name)) {
          signals.push({
            kind: "hook",
            strength: "strong",
            name,
            loc: locOf(node, sf),
          });
        } else if (NEXT_CLIENT_HOOKS.has(name)) {
          signals.push({
            kind: "next-client-api",
            strength: "strong",
            name,
            loc: locOf(node, sf),
          });
        } else if (STRONG_REACT_APIS.has(name)) {
          signals.push({
            kind: "react-api",
            strength: "strong",
            name,
            loc: locOf(node, sf),
          });
        } else if (WEAK_REACT_APIS.has(name)) {
          signals.push({
            kind: "react-api",
            strength: "weak",
            name,
            loc: locOf(node, sf),
          });
        } else if (name.startsWith("use") && name.length > 3) {
          // Custom hook call — may be transitive; mark for later C1
          const binding = importedBindings.get(name);
          if (binding) {
            signals.push({
              kind: "transitive-hook",
              strength: "strong",
              name,
              loc: locOf(node, sf),
              via: [binding.from],
            });
          }
        }
      }
    }

    // Browser globals
    if (ts.isIdentifier(node) && BROWSER_GLOBALS.has(node.text)) {
      // Skip property names and import bindings declarations
      const parent = node.parent;
      if (
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node
      ) {
        // skip
      } else if (
        !ts.isImportSpecifier(parent) &&
        !ts.isBindingElement(parent) &&
        !(ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        signals.push({
          kind: "browser-api",
          strength: "strong",
          name: node.text,
          loc: locOf(node, sf),
        });
      }
    }

    // Class components
    if (ts.isClassDeclaration(node) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          const text = type.expression.getText(sf);
          if (
            text === "Component" ||
            text === "PureComponent" ||
            text === "React.Component" ||
            text === "React.PureComponent"
          ) {
            signals.push({
              kind: "class-component",
              strength: "strong",
              name: text,
              loc: locOf(node, sf),
            });
          }
        }
      }
    }

    // JSX event handlers on*
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const attr = node.name.text;
      if (
        /^on[A-Z]/.test(attr) &&
        node.initializer &&
        (ts.isJsxExpression(node.initializer) ||
          ts.isStringLiteral(node.initializer) === false)
      ) {
        const init = node.initializer;
        if (
          ts.isJsxExpression(init) &&
          init.expression &&
          (ts.isArrowFunction(init.expression) ||
            ts.isFunctionExpression(init.expression) ||
            ts.isIdentifier(init.expression) ||
            ts.isPropertyAccessExpression(init.expression))
        ) {
          signals.push({
            kind: "event-handler",
            strength: "strong",
            name: attr,
            loc: locOf(node, sf),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  // Deduplicate by kind+name+line
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = `${s.kind}:${s.name}:${s.loc?.line ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractImports(sf: ts.SourceFile): RawImport[] {
  const imports: RawImport[] = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const isTypeOnly = stmt.importClause?.isTypeOnly ?? false;
      const names: string[] = [];
      const clause = stmt.importClause;

      if (!clause) {
        imports.push({
          specifier,
          type: "side-effect",
          isTypeOnly: false,
          importedNames: [],
          loc: locOf(stmt, sf),
        });
        continue;
      }

      if (clause.name) names.push("default");
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) {
          names.push("*");
        } else if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (el.isTypeOnly) continue;
            names.push(el.propertyName?.text ?? el.name.text);
          }
        }
      }

      // Detect server-only / client-only side-effect style
      const type: RawImport["type"] = isTypeOnly
        ? "type"
        : names.length === 0
          ? "side-effect"
          : "static";

      imports.push({
        specifier,
        type,
        isTypeOnly,
        importedNames: names.length ? names : [],
        loc: locOf(stmt, sf),
      });
    }
  }

  // Dynamic imports: import("x")
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({
        specifier: node.arguments[0].text,
        type: "dynamic",
        isTypeOnly: false,
        importedNames: ["*"],
        loc: locOf(node, sf),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return imports;
}

function extractExports(sf: ts.SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const from =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : undefined;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          exports.push({
            name: el.name.text,
            from,
            isTypeOnly: el.isTypeOnly || (stmt.isTypeOnly ?? false),
            loc: locOf(el, sf),
          });
        }
      } else if (!stmt.exportClause && from) {
        exports.push({
          name: "*",
          from,
          isTypeOnly: stmt.isTypeOnly ?? false,
          isStar: true,
          loc: locOf(stmt, sf),
        });
      }
    } else if (ts.isExportAssignment(stmt)) {
      exports.push({
        name: "default",
        isTypeOnly: false,
        loc: locOf(stmt, sf),
      });
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isVariableStatement(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt)) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const isDefault = stmt.modifiers.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            exports.push({
              name: isDefault ? "default" : decl.name.text,
              isTypeOnly: false,
              loc: locOf(decl, sf),
            });
          }
        }
      } else if ("name" in stmt && stmt.name && ts.isIdentifier(stmt.name)) {
        const isTypeOnly =
          ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt);
        exports.push({
          name: isDefault ? "default" : stmt.name.text,
          isTypeOnly,
          loc: locOf(stmt, sf),
        });
      } else if (isDefault) {
        exports.push({
          name: "default",
          isTypeOnly: false,
          loc: locOf(stmt, sf),
        });
      }
    }
  }

  return exports;
}

export function extractFromSourceFile(
  sf: ts.SourceFile,
  projectRoot: string,
  contentHash: string,
): ExtractedModule {
  const absolute = sf.fileName;
  const id = normalizeModuleId(projectRoot, absolute);
  const directives = getDirectives(sf);
  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const clientSignals = collectClientSignals(sf, imports);
  const { isRoute, routeKind } = detectRouteKind(id);

  const forcedServer = imports.some((i) => i.specifier === "server-only");
  const forcedClient = imports.some((i) => i.specifier === "client-only");
  const hasServerActionDirective = directives.includes("use server");

  return {
    id,
    path: absolute,
    directives,
    imports,
    exports,
    clientSignals,
    isRoute,
    routeKind,
    forcedServer,
    forcedClient,
    hasServerActionDirective,
    contentHash,
  };
}

export function normalizeModuleId(projectRoot: string, absolutePath: string): string {
  let rel = path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) {
    // ok
  }
  // Strip extension for stable ids? Keep with extension for uniqueness of .ts vs .tsx
  return rel;
}

export interface CompilerContext {
  rootNames: string[];
  host: ts.CompilerHost;
  options: ts.CompilerOptions;
  limitations: Limitation[];
}

/** Load tsconfig + project source roots without creating a Program. */
export function loadCompilerContext(
  projectRoot: string,
  tsconfigPath: string,
): CompilerContext {
  const limitations: Limitation[] = [];
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  if (parsed.errors.length) {
    for (const err of parsed.errors.slice(0, 5)) {
      limitations.push({
        kind: "parse-error",
        detail: ts.flattenDiagnosticMessageText(err.messageText, "\n"),
      });
    }
  }

  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    allowJs: parsed.options.allowJs ?? true,
    jsx: parsed.options.jsx ?? ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    // Architecture analysis only needs ASTs of project sources. Auto-including
    // ambient @types (and `/// <reference types="next" />`) walks into ancestor
    // node_modules and can pull 100+ unrelated .d.ts files — enough to blow
    // fixture / cold-start budgets (and previously trip Vitest's 5s timeout).
    types: [],
  };

  const rootAbs = path.resolve(projectRoot);
  const rootNames = parsed.fileNames.filter((fileName) => {
    const abs = path.resolve(fileName);
    if (!abs.startsWith(rootAbs + path.sep) && abs !== rootAbs) return false;
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) return false;
    if (abs.endsWith(".d.ts")) return false;
    return /\.(tsx?|jsx?)$/.test(abs);
  });

  const host = ts.createCompilerHost(options, true);
  return { rootNames, host, options, limitations };
}

export function createProgram(
  projectRoot: string,
  tsconfigPath: string,
): {
  program: ts.Program;
  host: ts.CompilerHost;
  options: ts.CompilerOptions;
  limitations: Limitation[];
} {
  const ctx = loadCompilerContext(projectRoot, tsconfigPath);
  const program = ts.createProgram({
    rootNames: ctx.rootNames,
    options: ctx.options,
    host: ctx.host,
  });

  return {
    program,
    host: ctx.host,
    options: ctx.options,
    limitations: ctx.limitations,
  };
}

/** Parse a single project source file for extraction (no Program binding). */
export function createProjectSourceFile(
  fileName: string,
  content: string,
): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".ts") || fileName.endsWith(".js")
      ? fileName.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
      : ts.ScriptKind.TSX;
  return ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    kind,
  );
}

export { STRONG_HOOKS, NEXT_CLIENT_HOOKS };
