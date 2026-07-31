import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const AUDIT_DIR = ".ahaft";
export const AUDIT_FILE = "audit.log";

const SENSITIVE_KEY = /token|secret|password|key|authorization/i;

/** Recursively replace values of sensitive-looking keys. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  args: unknown;
  status?: number;
  durationMs?: number;
  error?: string;
}

/** Append-only JSONL audit log at <root>/.ahaft/audit.log. */
export class AuditLog {
  private readonly file: string;
  private ready: Promise<unknown> | undefined;

  constructor(rootDir: string) {
    this.file = path.join(rootDir, AUDIT_DIR, AUDIT_FILE);
  }

  get path(): string {
    return this.file;
  }

  async record(entry: Omit<AuditEntry, "ts" | "args"> & { args: Record<string, unknown> }): Promise<void> {
    this.ready ??= mkdir(path.dirname(this.file), { recursive: true });
    await this.ready;
    const line: AuditEntry = { ts: new Date().toISOString(), ...entry, args: redact(entry.args) };
    await appendFile(this.file, `${JSON.stringify(line)}\n`, "utf8");
  }
}
