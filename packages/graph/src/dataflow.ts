import ts from "typescript";
import type { SourceLocation } from "@next-architect/core";

export interface AwaitExpr {
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

export interface WaterfallCandidate {
  file: string;
  independent: AwaitExpr;
  /** Preceding awaits that do not data-depend into independent. */
  preceding: AwaitExpr[];
  /** Preceding awaits that DO depend (for display). */
  dependentChain: AwaitExpr[];
}

const MUTATING_PREFIX =
  /^(create|update|delete|insert|save|send|post|put|patch|remove|write)/i;

const DYNAMIC_APIS = new Set(["cookies", "headers", "draftMode"]);

function locOf(node: ts.Node, sf: ts.SourceFile): SourceLocation {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: start.line + 1, column: start.character + 1 };
}

function collectRefs(node: ts.Node): string[] {
  const names: string[] = [];
  function visit(n: ts.Node): void {
    if (ts.isIdentifier(n)) names.push(n.text);
    ts.forEachChild(n, visit);
  }
  visit(node);
  return names;
}

function getCallName(expr: ts.Expression): string | undefined {
  if (ts.isCallExpression(expr)) {
    const c = expr.expression;
    if (ts.isIdentifier(c)) return c.text;
    if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name)) {
      return c.name.text;
    }
  }
  if (ts.isAwaitExpression(expr)) return getCallName(expr.expression);
  return undefined;
}

function isInControlFlow(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isIfStatement(cur) ||
      ts.isForStatement(cur) ||
      ts.isForInStatement(cur) ||
      ts.isForOfStatement(cur) ||
      ts.isWhileStatement(cur) ||
      ts.isDoStatement(cur) ||
      ts.isSwitchStatement(cur)
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function crossesTryCatch(a: ts.Node, b: ts.Node): boolean {
  function tryParent(node: ts.Node): ts.TryStatement | undefined {
    let cur: ts.Node | undefined = node.parent;
    while (cur) {
      if (ts.isTryStatement(cur)) return cur;
      if (ts.isFunctionLike(cur)) return undefined;
      cur = cur.parent;
    }
    return undefined;
  }
  const ta = tryParent(a);
  const tb = tryParent(b);
  return ta !== tb && (ta !== undefined || tb !== undefined);
}

/**
 * Extract ordered awaits from async functions in a source file (docs/03 §3.5).
 */
export function extractAwaits(sf: ts.SourceFile): AwaitExpr[] {
  const awaits: AwaitExpr[] = [];
  let counter = 0;

  function visitFunction(fn: ts.FunctionLikeDeclaration): void {
    if (!fn.body || !ts.isBlock(fn.body)) return;
    // Only async functions
    const isAsync =
      fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ??
      false;
    if (!isAsync) return;

    const bodyAwaits: Array<{ node: ts.AwaitExpression; stmt: ts.Statement }> =
      [];

    function walk(node: ts.Node, stmt: ts.Statement): void {
      if (ts.isAwaitExpression(node)) {
        bodyAwaits.push({ node, stmt });
      }
      // Don't descend into nested functions
      if (ts.isFunctionLike(node) && node !== fn) return;
      ts.forEachChild(node, (c) => walk(c, stmt));
    }

    for (const stmt of fn.body.statements) {
      walk(stmt, stmt);
    }

    for (const { node, stmt } of bodyAwaits) {
      const boundNames: string[] = [];
      let unusedResult = true;

      if (
        ts.isVariableStatement(stmt) ||
        (ts.isVariableDeclarationList(stmt as unknown as ts.Node))
      ) {
        // handled below
      }

      // const x = await ...
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            decl.initializer &&
            (decl.initializer === node ||
              (ts.isAwaitExpression(decl.initializer) &&
                decl.initializer === node) ||
              containsNode(decl.initializer, node))
          ) {
            unusedResult = false;
            if (ts.isIdentifier(decl.name)) {
              boundNames.push(decl.name.text);
            } else if (ts.isObjectBindingPattern(decl.name)) {
              for (const el of decl.name.elements) {
                if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
                  boundNames.push(el.name.text);
                }
              }
            } else if (ts.isArrayBindingPattern(decl.name)) {
              for (const el of decl.name.elements) {
                if (
                  ts.isBindingElement(el) &&
                  ts.isIdentifier(el.name)
                ) {
                  boundNames.push(el.name.text);
                }
              }
            }
          }
        }
      }

      // x = await ...
      if (
        ts.isExpressionStatement(stmt) &&
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        if (containsNode(stmt.expression.right, node)) {
          unusedResult = false;
          if (ts.isIdentifier(stmt.expression.left)) {
            boundNames.push(stmt.expression.left.text);
          }
        }
      }

      const referencedNames = collectRefs(node.expression);
      const callName = getCallName(node.expression);

      let excluded = false;
      let excludeReason: string | undefined;

      if (isInControlFlow(node)) {
        excluded = true;
        excludeReason = "inside control flow";
      }
      if (unusedResult) {
        excluded = true;
        excludeReason = "unused result (possible side effect)";
      }
      if (callName && MUTATING_PREFIX.test(callName)) {
        excluded = true;
        excludeReason = `mutating call name "${callName}"`;
      }
      if (callName && DYNAMIC_APIS.has(callName)) {
        excluded = true;
        excludeReason = `dynamic API "${callName}"`;
      }
      // Also exclude if await arg calls dynamic APIs
      if (referencedNames.some((n) => DYNAMIC_APIS.has(n))) {
        excluded = true;
        excludeReason = "references dynamic API";
      }

      awaits.push({
        id: `await-${counter++}`,
        boundNames,
        referencedNames,
        callName,
        loc: locOf(node, sf),
        excluded,
        excludeReason,
        unusedResult,
      });
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      visitFunction(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return awaits;
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  if (root === target) return true;
  let found = false;
  function visit(n: ts.Node): void {
    if (n === target) found = true;
    if (!found) ts.forEachChild(n, visit);
  }
  visit(root);
  return found;
}

/**
 * Find waterfall candidates: consecutive non-excluded awaits where later
 * does not depend on earlier bindings (D1–D4).
 */
export function findWaterfallCandidates(
  file: string,
  awaits: AwaitExpr[],
): WaterfallCandidate[] {
  const candidates: WaterfallCandidate[] = [];
  const usable = awaits.filter((a) => !a.excluded);
  if (usable.length < 2) return candidates;

  // Track cumulative bindings
  const boundSoFar: string[] = [];
  const preceding: AwaitExpr[] = [];
  const dependentChain: AwaitExpr[] = [];

  for (let i = 0; i < usable.length; i++) {
    const a = usable[i]!;
    const depends = a.referencedNames.some((n) => boundSoFar.includes(n));

    if (i > 0 && !depends && preceding.length > 0) {
      // Independent of all previous — waterfall candidate
      candidates.push({
        file,
        independent: a,
        preceding: [...preceding],
        dependentChain: [...dependentChain],
      });
    }

    if (depends) {
      dependentChain.push(a);
    } else {
      preceding.push(a);
    }
    boundSoFar.push(...a.boundNames);
  }

  return candidates;
}
