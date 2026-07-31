import { parse, type ParserOptions } from "@babel/parser";
import { walk, isNode, type AstNode } from "./walk.js";
import type { HttpMethod, RouteParam } from "../types.js";

/** A route as registered in one file, before mount prefixes are applied. */
export interface RawRoute {
  method: HttpMethod;
  path: string;
  /** Variable the route was registered on (app or router). */
  owner: string;
  handlerName?: string;
  doc?: string;
  /** query/body params inferred from the handler body. */
  params: RouteParam[];
}

export interface RawMount {
  /** Variable .use() was called on. */
  owner: string;
  prefix: string;
  /** Local identifier mounted, e.g. `productsRouter`. */
  targetVar?: string;
  /** Module specifier for inline `app.use('/x', require('./y'))`. */
  targetSource?: string;
}

/** Everything ahaft needs to know about one source file. */
export interface FileFacts {
  file: string;
  appVars: Set<string>;
  routerVars: Set<string>;
  routes: RawRoute[];
  mounts: RawMount[];
  /** local name -> module specifier, for default imports / require(). */
  imports: Map<string, string>;
  /** Variable exported via `export default x` / `module.exports = x`. */
  defaultExport?: string;
  usesExpressImport: boolean;
}

const ROUTE_METHODS: Record<string, HttpMethod> = {
  get: "GET",
  head: "HEAD",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};

function parserOptions(file: string): ParserOptions {
  const plugins: NonNullable<ParserOptions["plugins"]> = ["typescript"];
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) plugins.push("jsx");
  return {
    sourceType: "unambiguous",
    plugins,
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  };
}

function ident(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;
}

function stringLiteral(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "StringLiteral") return node.value as string;
  if (
    node.type === "TemplateLiteral" &&
    (node.expressions as unknown[]).length === 0 &&
    (node.quasis as AstNode[]).length === 1
  ) {
    const quasi = (node.quasis as AstNode[])[0];
    return (quasi?.cooked as string) ?? ((quasi?.value as AstNode | undefined)?.cooked as string | undefined);
  }
  return undefined;
}

/** Unwrap `foo as Bar` / parenthesized expressions. */
function unwrap(node: unknown): AstNode | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "ParenthesizedExpression") {
    return unwrap(node.expression);
  }
  return node;
}

/** Strip JSDoc decoration and keep the description text before any @tag. */
function cleanComment(raw: string): string | undefined {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*+\s?/, "").trim());
  const text: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@")) break;
    text.push(line);
  }
  const joined = text.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > 0 ? joined : undefined;
}

function docFromStatement(stmt: AstNode | null): string | undefined {
  if (!stmt) return undefined;
  const comments = stmt.leadingComments as AstNode[] | undefined;
  if (!comments || comments.length === 0) return undefined;
  const last = comments[comments.length - 1];
  if (!last) return undefined;
  return cleanComment(last.value as string);
}

interface HandlerInfo {
  params: RouteParam[];
  name?: string;
  doc?: string;
}

function typeOfLiteral(node: unknown): RouteParam["type"] {
  if (!isNode(node)) return "unknown";
  if (node.type === "NumericLiteral") return "number";
  if (node.type === "BooleanLiteral") return "boolean";
  if (node.type === "StringLiteral") return "string";
  return "unknown";
}

/** Infer query/body params from `req.query.x`, `req.body.x` and destructuring. */
function analyzeHandlerBody(fn: AstNode): RouteParam[] {
  const params: RouteParam[] = [];
  const seen = new Set<string>();
  const add = (p: RouteParam) => {
    const key = `${p.in}:${p.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      params.push(p);
    }
  };

  const fnParams = fn.params as AstNode[];
  const reqName = ident(fnParams[0]);
  if (!reqName) return params;

  const isReqSource = (node: unknown): "query" | "body" | undefined => {
    const n = unwrap(node);
    if (!n || n.type !== "MemberExpression" || n.computed) return undefined;
    if (ident(n.object) !== reqName) return undefined;
    const prop = ident(n.property);
    return prop === "query" || prop === "body" ? prop : undefined;
  };

  let wholeBodyUse = false;

  walk(fn, (node, parent) => {
    // req.query.x / req.body.x
    if (node.type === "MemberExpression" && !node.computed) {
      const source = isReqSource(node.object);
      const prop = ident(node.property);
      if (source && prop) {
        add({ name: prop, in: source, type: source === "query" ? "string" : "unknown", required: false });
      }
      // bare `req.body` used as a whole value (spread, res.json(req.body), ...)
      if (isReqSource(node) === "body") {
        const parentCaptures =
          (parent?.type === "MemberExpression" && !parent.computed && parent.object === node) ||
          (parent?.type === "VariableDeclarator" && isNode(parent.id) && parent.id.type === "ObjectPattern");
        if (!parentCaptures) wholeBodyUse = true;
      }
    }
    // const { a, b = 1 } = req.query / req.body
    if (node.type === "VariableDeclarator" && isNode(node.id) && node.id.type === "ObjectPattern") {
      const source = isReqSource(node.init);
      if (!source) return;
      for (const prop of node.id.properties as AstNode[]) {
        if (prop.type !== "ObjectProperty" || prop.computed) continue;
        const name = ident(prop.key);
        if (!name) continue;
        const value = prop.value as AstNode;
        const type =
          value.type === "AssignmentPattern"
            ? typeOfLiteral(value.right)
            : source === "query"
              ? "string"
              : "unknown";
        add({ name, in: source, type: source === "query" ? (type === "unknown" ? "string" : type) : type, required: false });
      }
    }
  });

  if (wholeBodyUse && !params.some((p) => p.in === "body")) {
    add({ name: "body", in: "body", type: "object", required: false });
  }
  return params;
}

/**
 * Statically extract express facts from one source file.
 * Never executes the code — parse + walk only.
 */
export function extractFileFacts(file: string, source: string): FileFacts {
  const facts: FileFacts = {
    file,
    appVars: new Set(),
    routerVars: new Set(),
    routes: [],
    mounts: [],
    imports: new Map(),
    usesExpressImport: false,
  };

  let ast: AstNode;
  try {
    ast = parse(source, parserOptions(file)) as unknown as AstNode;
  } catch {
    return facts;
  }

  const expressNames = new Set<string>(); // `express` default import names
  const routerFactoryNames = new Set<string>(); // named `Router` imports
  const functionDecls = new Map<string, { node: AstNode; stmt: AstNode }>();

  // Pass 1: imports, express()/Router() variables, named function declarations.
  walk(ast, (node, _parent, stmt) => {
    if (node.type === "ImportDeclaration") {
      const source = (node.source as AstNode).value as string;
      for (const spec of node.specifiers as AstNode[]) {
        const local = ident(spec.local);
        if (!local) continue;
        if (spec.type === "ImportDefaultSpecifier" || spec.type === "ImportNamespaceSpecifier") {
          facts.imports.set(local, source);
          if (source === "express") {
            expressNames.add(local);
            facts.usesExpressImport = true;
          }
        } else if (spec.type === "ImportSpecifier" && source === "express") {
          facts.usesExpressImport = true;
          if (ident(spec.imported) === "Router") routerFactoryNames.add(local);
        }
      }
    }
    if (node.type === "VariableDeclarator") {
      const name = ident(node.id);
      const init = unwrap(node.init);
      if (init?.type === "CallExpression") {
        const callee = unwrap(init.callee);
        // const express = require('express') / const x = require('./mod')
        if (callee && ident(callee) === "require") {
          const source = stringLiteral((init.arguments as unknown[])[0]);
          if (name && source) {
            facts.imports.set(name, source);
            if (source === "express") {
              expressNames.add(name);
              facts.usesExpressImport = true;
            }
          }
          // const { Router } = require('express')
          if (source === "express" && isNode(node.id) && node.id.type === "ObjectPattern") {
            facts.usesExpressImport = true;
            for (const prop of node.id.properties as AstNode[]) {
              if (prop.type === "ObjectProperty" && ident(prop.key) === "Router") {
                const local = ident(prop.value);
                if (local) routerFactoryNames.add(local);
              }
            }
          }
        }
      }
    }
    if (node.type === "FunctionDeclaration") {
      const name = ident(node.id);
      if (name && stmt) functionDecls.set(name, { node, stmt });
    }
  });

  // Pass 2: app/router creation (needs express import names from pass 1).
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const name = ident(node.id);
    const init = unwrap(node.init);
    if (!name || init?.type !== "CallExpression") return;
    const callee = unwrap(init.callee);
    if (!callee) return;
    if (callee.type === "Identifier") {
      if (expressNames.has(callee.name as string)) facts.appVars.add(name);
      if (routerFactoryNames.has(callee.name as string)) facts.routerVars.add(name);
    }
    if (callee.type === "MemberExpression" && !callee.computed) {
      const obj = ident(callee.object);
      if (obj && expressNames.has(obj) && ident(callee.property) === "Router") {
        facts.routerVars.add(name);
      }
    }
  });

  const owners = new Set([...facts.appVars, ...facts.routerVars]);

  // Pass 3: routes, mounts, exports.
  walk(ast, (node, _parent, stmt) => {
    if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      if (callee?.type !== "MemberExpression" || callee.computed) return;
      const owner = ident(callee.object);
      const methodName = ident(callee.property);
      if (!owner || !methodName || !owners.has(owner)) return;
      const args = (node.arguments as unknown[]).map(unwrap);

      if (methodName === "use") {
        const first = args[0];
        const prefix = stringLiteral(first);
        const target = prefix === undefined ? first : args[1];
        if (!target) return;
        if (target.type === "Identifier") {
          facts.mounts.push({ owner, prefix: prefix ?? "", targetVar: target.name as string });
        } else if (target.type === "CallExpression" && ident(unwrap(target.callee)) === "require") {
          const src = stringLiteral((target.arguments as unknown[])[0]);
          if (src) facts.mounts.push({ owner, prefix: prefix ?? "", targetSource: src });
        }
        return;
      }

      const method = ROUTE_METHODS[methodName];
      if (!method) return;
      const path = stringLiteral(args[0]);
      if (path === undefined) return;
      // `app.get('view engine')`-style config getters have no handler arg.
      const handlerArgs = args.slice(1).filter((a): a is AstNode => a !== undefined);
      if (handlerArgs.length === 0) return;

      const last = handlerArgs[handlerArgs.length - 1];
      let handler: HandlerInfo = { params: [] };
      if (last && (last.type === "FunctionExpression" || last.type === "ArrowFunctionExpression")) {
        handler = { params: analyzeHandlerBody(last), name: ident(last.id) };
      } else if (last && last.type === "Identifier") {
        const name = last.name as string;
        const decl = functionDecls.get(name);
        handler = {
          name,
          params: decl ? analyzeHandlerBody(decl.node) : [],
          doc: decl ? docFromStatement(decl.stmt) : undefined,
        };
      }

      facts.routes.push({
        method,
        path,
        owner,
        handlerName: handler.name,
        doc: docFromStatement(stmt) ?? handler.doc,
        params: handler.params,
      });
    }

    // export default router
    if (node.type === "ExportDefaultDeclaration") {
      const name = ident(unwrap(node.declaration));
      if (name && owners.has(name)) facts.defaultExport = name;
    }
    // module.exports = router
    if (node.type === "AssignmentExpression" && (node.operator as string) === "=") {
      const left = unwrap(node.left);
      if (left?.type === "MemberExpression" && !left.computed && ident(left.object) === "module" && ident(left.property) === "exports") {
        const name = ident(unwrap(node.right));
        if (name && owners.has(name)) facts.defaultExport = name;
      }
    }
  });

  return facts;
}
