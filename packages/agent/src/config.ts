// SPEC-7 §1 — repo config (rextor.yaml, read from the BASE branch: the only
// trusted silencing channel, invariant 21). Parsing is all-or-nothing: ANY
// schema violation (bad YAML, unknown key, invalid value, dismissal without a
// reason) rejects the whole config with a visible error — the review then
// proceeds on defaults and the comment says so. A half-applied config would
// make the gate's meaning depend on which lines happened to parse.
//
// The gate itself (gateConclusion) is pure: dismissedKeys are INJECTED so the
// dismissals store can move from yaml-sync (D2) to the server-side SQLite
// sync (D4) without touching the gate. Caller maps INCOMPLETE → "neutral";
// the gate only ever answers failure|success (SPEC-7 §1 table, invariant 24).
import { parse } from "yaml";
import picomatch from "picomatch";
import type { Finding, Severity } from "./findings";

export interface DismissalEntry {
  ruleId: string;
  path: string;
  lineHint?: number;
  reason: string;
}

export interface RepoConfig {
  /** Glob allow-list for finding paths; empty = no include filter (the
   * diff-scope already selected the audited surface). */
  include: string[];
  /** Glob deny-list; wins over include (test files are never reviewed). */
  ignore: string[];
  /** Findings at severity ≥ minimum breach the gate → check-run failure. */
  gateMinimum: Severity | null;
  dismissals: DismissalEntry[];
}

export const DEFAULT_CONFIG: RepoConfig = {
  include: [],
  ignore: [],
  gateMinimum: null,
  dismissals: [],
};

export type SeverityL = "critical" | "high" | "medium" | "low";

const SEVERITIES_L: readonly SeverityL[] = ["critical", "high", "medium", "low"];

/** dismissedKeys membership key — (ruleId, path) joined by a separator that
 *  cannot appear in either (paths never contain NUL). Also used by the D4
 *  dismissals store, so the key format is the cross-layer contract. */
export function dismissalKey(ruleId: string, path: string): string {
  return `${ruleId}\0${path}`;
}

interface RawConfig {
  paths?: { include?: unknown; ignore?: unknown };
  severity_gate?: { minimum?: unknown };
  dismiss?: unknown;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const parseDismissal = (v: unknown): DismissalEntry | null => {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.rule_id !== "string" || typeof d.path !== "string" || typeof d.reason !== "string") {
    return null;
  }
  // Silencing carries a public why: an empty (or whitespace-only) reason
  // rejects the whole config rather than planting an unexplained dismissal.
  if (d.reason.trim().length === 0) return null;
  if (d.line_hint !== undefined && typeof d.line_hint !== "number") return null;
  return {
    ruleId: d.rule_id,
    path: d.path,
    lineHint: d.line_hint as number | undefined,
    reason: d.reason,
  };
};

/** Parse rextor.yaml. `null` text = no config file → defaults, no error.
 *  Every violation rejects the WHOLE config (error + defaults) — never a
 *  partial application. */
export function parseRepoConfig(text: string | null): { config: RepoConfig; error?: string } {
  if (text === null) return { config: DEFAULT_CONFIG };
  let raw: RawConfig;
  try {
    raw = parse(text) as RawConfig;
  } catch (err) {
    return {
      config: DEFAULT_CONFIG,
      error: `rextor.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: DEFAULT_CONFIG, error: "rextor.yaml must be a mapping at the top level" };
  }

  const KNOWN = new Set(["paths", "severity_gate", "dismiss"]);
  const unknown = Object.keys(raw).filter((k) => !KNOWN.has(k));
  if (unknown.length > 0) {
    return { config: DEFAULT_CONFIG, error: `rextor.yaml has unknown keys: ${unknown.join(", ")}` };
  }

  let include: string[] = [];
  let ignore: string[] = [];
  if (raw.paths !== undefined) {
    if (typeof raw.paths !== "object" || raw.paths === null) {
      return { config: DEFAULT_CONFIG, error: "rextor.yaml `paths` must be a mapping" };
    }
    const p = raw.paths;
    const knownPaths = new Set(["include", "ignore"]);
    const unknownPaths = Object.keys(p).filter((k) => !knownPaths.has(k));
    if (unknownPaths.length > 0) {
      return {
        config: DEFAULT_CONFIG,
        error: `rextor.yaml paths has unknown keys: ${unknownPaths.join(", ")}`,
      };
    }
    if (p.include !== undefined) {
      if (!isStringArray(p.include)) {
        return { config: DEFAULT_CONFIG, error: "rextor.yaml paths.include must be a string list" };
      }
      include = p.include;
    }
    if (p.ignore !== undefined) {
      if (!isStringArray(p.ignore)) {
        return { config: DEFAULT_CONFIG, error: "rextor.yaml paths.ignore must be a string list" };
      }
      ignore = p.ignore;
    }
  }

  let gateMinimum: Severity | null = null;
  if (raw.severity_gate !== undefined) {
    if (typeof raw.severity_gate !== "object" || raw.severity_gate === null) {
      return { config: DEFAULT_CONFIG, error: "rextor.yaml `severity_gate` must be a mapping" };
    }
    const g = raw.severity_gate;
    const knownGate = new Set(["minimum"]);
    const unknownGate = Object.keys(g).filter((k) => !knownGate.has(k));
    if (unknownGate.length > 0) {
      return {
        config: DEFAULT_CONFIG,
        error: `rextor.yaml severity_gate has unknown keys: ${unknownGate.join(", ")}`,
      };
    }
    if (g.minimum !== undefined) {
      if (typeof g.minimum !== "string" || !SEVERITIES_L.includes(g.minimum as SeverityL)) {
        return {
          config: DEFAULT_CONFIG,
          error: `rextor.yaml severity_gate.minimum must be one of: ${SEVERITIES_L.join(", ")}`,
        };
      }
      gateMinimum = g.minimum as Severity;
    }
  }

  let dismissals: DismissalEntry[] = [];
  if (raw.dismiss !== undefined) {
    if (!Array.isArray(raw.dismiss)) {
      return { config: DEFAULT_CONFIG, error: "rextor.yaml `dismiss` must be a list" };
    }
    const parsed: DismissalEntry[] = [];
    for (const entry of raw.dismiss) {
      const d = parseDismissal(entry);
      if (d === null) {
        return {
          config: DEFAULT_CONFIG,
          error: "rextor.yaml dismiss entries need string rule_id, path and reason",
        };
      }
      parsed.push(d);
    }
    dismissals = parsed;
  }

  return { config: { include, ignore, gateMinimum, dismissals } };
}

/** SPEC-7 §1 paths — include allow-list / ignore deny-list over finding paths.
 *  Applied right after normalization, so comment, score, attestation payload
 *  and gate all consume the SAME in-scope list (one definition of scope). */
export function inScope(findings: Finding[], config: RepoConfig): Finding[] {
  const includeMatcher =
    config.include.length > 0 ? picomatch(config.include, { dot: true }) : null;
  const ignoreMatcher = config.ignore.length > 0 ? picomatch(config.ignore, { dot: true }) : null;
  return findings.filter((fnd) => {
    if (ignoreMatcher?.(fnd.file)) return false;
    if (includeMatcher && !includeMatcher(fnd.file)) return false;
    return true;
  });
}

/** Severity rank: lower index = more severe. A finding breaches the gate when
 *  its rank is ≤ the gate's rank (critical always breaches a high gate). */
export function gateConclusion(
  findings: Finding[],
  config: RepoConfig,
  dismissedKeys: Set<string>,
): "failure" | "success" {
  if (config.gateMinimum === null) return "success";
  const gateRank = SEVERITIES_L.indexOf(config.gateMinimum);
  const breached = findings.some((fnd) => {
    if (dismissedKeys.has(dismissalKey(fnd.check, fnd.file))) return false;
    return SEVERITIES_L.indexOf(fnd.severity) <= gateRank;
  });
  return breached ? "failure" : "success";
}
