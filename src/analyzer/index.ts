import type { Analyzer, DetectResult } from "./types.js";
import { expressAnalyzer } from "./express/index.js";

export * from "./types.js";

/**
 * Analyzer registry. To support a new framework, implement the Analyzer
 * interface and add it here — nothing else in the codebase needs to change.
 *
 * TODO(next.js): app-router / pages-router route handlers.
 * TODO(django): urls.py + views (Python analyzers will shell out to a
 *   bundled read-only Python AST script, still no code execution of the app).
 * TODO(fastapi): decorator-based routes.
 */
const analyzers: Analyzer[] = [expressAnalyzer];

export interface DetectionOutcome {
  analyzer?: Analyzer;
  /** Per-analyzer detection details, for the "why not" message. */
  details: Array<{ name: string; result: DetectResult }>;
}

export async function detectFramework(rootDir: string): Promise<DetectionOutcome> {
  const details: Array<{ name: string; result: DetectResult }> = [];
  const matches: Analyzer[] = [];
  for (const analyzer of analyzers) {
    const result = await analyzer.detect(rootDir);
    details.push({ name: analyzer.name, result });
    if (result.detected) matches.push(analyzer);
  }
  // With one registered analyzer ambiguity can't happen yet, but the
  // contract is: exactly one match or we refuse to guess.
  if (matches.length === 1) return { analyzer: matches[0], details };
  return { details };
}
