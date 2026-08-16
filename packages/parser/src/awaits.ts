import ts from "typescript";
import type { AwaitInfo, SourceLocation } from "@next-architect/core";

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

/**
 * D3: awaits inside try / catch / finally are excluded. Ordering there is
 * frequently load-bearing, and we would rather stay silent than guess.
 */
function isInTryStatement(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isTryStatement(cur)) return true;
    if (ts.isFunctionLike(cur)) return false;
    cur = cur.parent;
  }
  return false;
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  let found = false;
  function visit(n: ts.Node): void {
    if (n === target) found = true;
    if (!found) ts.forEachChild(n, visit);
  }
  if (root === target) return true;
  visit(root);
  return found;
}

/**
 * Extract ordered awaits from async functions in a source file (docs/03 §3.5).
 *
 * Runs inside the cached extraction pass so rules never re-read or re-parse
 * source files of their own.
 */
export function extractAwaits(sf: ts.SourceFile): AwaitInfo[] {
  const awaits: AwaitInfo[] = [];
  let counter = 0;

  function visitFunction(fn: ts.FunctionLikeDeclaration): void {
    if (!fn.body || !ts.isBlock(fn.body)) return;
    const isAsync =
      fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
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

      // const x = await ...
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (decl.initializer && containsNode(decl.initializer, node)) {
            unusedResult = false;
            if (ts.isIdentifier(decl.name)) {
              boundNames.push(decl.name.text);
            } else if (
              ts.isObjectBindingPattern(decl.name) ||
              ts.isArrayBindingPattern(decl.name)
            ) {
              for (const el of decl.name.elements) {
                if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
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
      if (isInTryStatement(node)) {
        excluded = true;
        excludeReason = "inside try/catch/finally";
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
      visitFunction(node as ts.FunctionLikeDeclaration);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return awaits;
}
