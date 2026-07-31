/**
 * Minimal recursive AST walker for @babel/parser output. We deliberately
 * avoid @babel/traverse to keep the dependency footprint small — we only
 * need parent-aware pre-order visits, nothing more.
 */

export interface AstNode {
  type: string;
  [key: string]: unknown;
}

export function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

export type Visitor = (node: AstNode, parent: AstNode | null, stmt: AstNode | null) => void;

/**
 * Pre-order walk. `stmt` is the nearest enclosing Statement/Declaration —
 * used to find leading comments, which babel attaches at statement level.
 */
export function walk(node: AstNode, visit: Visitor, parent: AstNode | null = null, stmt: AstNode | null = null): void {
  const nextStmt = node.type.endsWith("Statement") || node.type.endsWith("Declaration") ? node : stmt;
  visit(node, parent, nextStmt);
  for (const key of Object.keys(node)) {
    if (key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit, node, nextStmt);
      }
    } else if (isNode(value)) {
      walk(value, visit, node, nextStmt);
    }
  }
}
