import type { HttpMethod } from "../analyzer/types.js";
import type { AccessLevel } from "./schema.js";

/**
 * Tokens in a route path or handler name that suggest an operation is
 * dangerous even when the HTTP method says "write": deletion, payments,
 * and email sending. Escalation only ever tightens (write -> destructive),
 * so a false positive just means one more tool the developer reviews
 * before enabling — the safe direction to err in.
 */
const DESTRUCTIVE_TOKENS = new Set([
  // deletion
  "delete", "remove", "destroy", "purge", "drop", "erase", "wipe", "truncate",
  // payments
  "pay", "payment", "charge", "refund", "billing", "checkout", "invoice", "transfer",
  // email / outbound messaging
  "email", "mail", "send", "notify", "notification",
]);

/** Split camelCase / snake_case / kebab-case / path segments into tokens. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function hasDestructiveToken(text: string): boolean {
  return tokenize(text).some((token) => {
    const singular = token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
    return DESTRUCTIVE_TOKENS.has(token) || DESTRUCTIVE_TOKENS.has(singular);
  });
}

/**
 * Access rules:
 *  - GET/HEAD           -> read
 *  - DELETE             -> destructive
 *  - POST/PUT/PATCH     -> write, escalated to destructive when the path or
 *                          handler name suggests deletion/payment/email.
 */
export function classifyAccess(method: HttpMethod, routePath: string, handlerName?: string): AccessLevel {
  if (method === "GET" || method === "HEAD") return "read";
  if (method === "DELETE") return "destructive";
  const haystack = `${routePath} ${handlerName ?? ""}`;
  return hasDestructiveToken(haystack) ? "destructive" : "write";
}

/** Only read tools are enabled by default; everything else needs review. */
export function defaultEnabled(access: AccessLevel): boolean {
  return access === "read";
}
