// SPEC-2 §1 — triage ops: the LLM proposes, deterministic TS validates + applies.
import { SEVERITIES, withIds, type Finding, type Severity } from "./findings";
import { chatCompletion, extractJsonArray, triageModelFor, TriageUnavailableError, type ChatMessage } from "./openrouter";
import { PROFILE_V1_SYSTEM, buildTriageUserMessage } from "./profile";
import type { DiffScopeResult } from "./diff-scope";

export type TriageOp =
  | { op: "reclassify"; id: number; severity: Severity; reason: string }
  | { op: "dedup"; canonicalId: number; duplicateIds: number[] }
  | { op: "add"; file: string; line: number; severity: Severity; check: string; description: string };

export interface UniverseEntry { file: string; lines: Array<[number, number]> }
export interface TriageOutcome {
  valid: TriageOp[];
  rejected: Array<{ op: unknown; reason: string }>;
}

export function buildCitationUniverse(findings: Finding[], scope: DiffScopeResult): UniverseEntry[] {
  const byFile = new Map<string, Array<[number, number]>>();
  const add = (file: string, range: [number, number]) => {
    byFile.set(file, [...(byFile.get(file) ?? []), range]);
  };
  for (const f of findings) add(f.file, [f.line, f.line]);
  for (const sf of scope.contractFiles) for (const r of sf.changedLineRanges) add(sf.path, r);
  return [...byFile.entries()].map(([file, lines]) => ({ file, lines }));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isSev = (v: unknown): v is Severity => SEVERITIES.includes(v as Severity);
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function validateOps(raw: unknown, findings: Finding[], universe: UniverseEntry[]): TriageOutcome {
  const valid: TriageOp[] = [];
  const rejected: Array<{ op: unknown; reason: string }> = [];
  const push = (op: unknown, reason: string) => rejected.push({ op, reason });
  if (!Array.isArray(raw)) return { valid, rejected: [{ op: raw, reason: "ops: not an array" }] };

  const live = new Set<number>();
  for (const f of findings) if (f.id !== undefined) live.add(f.id);
  const removed = new Set<number>(); // consumed by earlier dedup
  const usedAsDup = new Set<number>();
  const inUniverse = (file: string, line: number) =>
    universe.some((e) => e.file === file && e.lines.some(([a, b]) => line >= a && line <= b));

  for (const el of raw) {
    if (!isObj(el)) { push(el, "op: not an object"); continue; }
    if (el.op === "reclassify") {
      if (!isId(el.id) || !live.has(el.id) || removed.has(el.id)) { push(el, `reclassify: unknown or removed id ${String(el.id)}`); continue; }
      if (!isSev(el.severity)) { push(el, "reclassify: severity outside enum"); continue; }
      if (typeof el.reason !== "string" || el.reason.length === 0) { push(el, "reclassify: empty reason"); continue; }
      valid.push({ op: "reclassify", id: el.id, severity: el.severity, reason: el.reason });
    } else if (el.op === "dedup") {
      if (!isId(el.canonicalId) || !live.has(el.canonicalId) || removed.has(el.canonicalId)) { push(el, `dedup: unknown or removed canonicalId ${String(el.canonicalId)}`); continue; }
      const dups = el.duplicateIds;
      if (!Array.isArray(dups) || dups.length === 0) { push(el, "dedup: duplicateIds must be a non-empty array"); continue; }
      const seen = new Set<number>();
      let bad: string | null = null;
      for (const d of dups) {
        if (!isId(d) || !live.has(d) || removed.has(d)) { bad = `dedup: unknown or removed id ${String(d)}`; break; }
        if (d === el.canonicalId) { bad = "dedup: duplicateId equals canonicalId"; break; }
        if (seen.has(d) || usedAsDup.has(d)) { bad = `dedup: id ${d} used as duplicate twice`; break; }
        seen.add(d);
      }
      if (bad) { push(el, bad); continue; }
      for (const d of dups) { removed.add(d); usedAsDup.add(d); }
      valid.push({ op: "dedup", canonicalId: el.canonicalId, duplicateIds: [...dups] });
    } else if (el.op === "add") {
      if (typeof el.file !== "string" || !isId(el.line)) { push(el, "add: file must be string, line non-negative integer"); continue; }
      if (!isSev(el.severity)) { push(el, "add: severity outside enum"); continue; }
      if (typeof el.check !== "string" || el.check.length === 0) { push(el, "add: empty check"); continue; }
      if (typeof el.description !== "string" || el.description.length === 0) { push(el, "add: empty description"); continue; }
      if (!inUniverse(el.file, el.line)) { push(el, `add: ${el.file}:${String(el.line)} outside citation universe`); continue; }
      valid.push({ op: "add", file: el.file, line: el.line, severity: el.severity, check: el.check, description: el.description });
    } else {
      push(el, `op: unknown kind ${String(el.op)}`);
    }
  }
  return { valid, rejected };
}

export function applyTriage(findings: Finding[], ops: TriageOp[]): Finding[] {
  const byId = new Map<number, Finding>();
  const order: number[] = [];
  for (const f of findings) {
    const copy = { ...f };
    if (copy.id !== undefined) { byId.set(copy.id, copy); order.push(copy.id); }
  }
  const isDedup = (o: TriageOp): o is Extract<TriageOp, { op: "dedup" }> => o.op === "dedup";
  const isReclassify = (o: TriageOp): o is Extract<TriageOp, { op: "reclassify" }> => o.op === "reclassify";
  const isAdd = (o: TriageOp): o is Extract<TriageOp, { op: "add" }> => o.op === "add";

  for (const op of ops.filter(isDedup)) {
    const canonical = byId.get(op.canonicalId);
    if (!canonical) continue;
    const merged = [...(canonical.mergedChecks ?? [canonical.check])];
    for (const id of op.duplicateIds) {
      const dup = byId.get(id);
      if (dup && !merged.includes(dup.check)) merged.push(dup.check);
      byId.delete(id);
      const i = order.indexOf(id);
      if (i >= 0) order.splice(i, 1);
    }
    canonical.mergedChecks = merged;
  }
  for (const op of ops.filter(isReclassify)) {
    const target = byId.get(op.id);
    if (!target) continue;
    target.severity = op.severity;
    target.triageNote = op.reason;
  }
  let nextId = order.length ? Math.max(...order) + 1 : 0;
  for (const op of ops.filter(isAdd)) {
    const added: Finding = {
      id: nextId++, file: op.file, line: op.line, severity: op.severity,
      check: `rextor/${op.check}`, description: op.description,
    };
    byId.set(added.id!, added);
    order.push(added.id!);
  }
  return order.map((id) => byId.get(id)!);
}

/** Outcome of the triage stage: what SPEC-2 §4 renders and scores. */
export interface TriageResult {
  finalFindings: Finding[];
  ops: TriageOp[];
  rejectedOps: Array<{ op: unknown; reason: string }>;
  modelUsed: string;
  triageStatus: "complete" | "incomplete";
}

export const NO_TRIAGE_MODEL = "none (unconfigured)";

/** Soft-incomplete passthrough: raw findings, no ops, no model. */
export function rawFindingsResult(findings: Finding[]): TriageResult {
  return { finalFindings: findings, ops: [], rejectedOps: [], modelUsed: NO_TRIAGE_MODEL, triageStatus: "incomplete" };
}

/**
 * Default triage dep: env resolved per call (SPEC-1 env-at-call-time pattern).
 * `opts.fetchFn` is the transport seam — tests inject it, production leaves it
 * unset for the platform fetch. Unset env → soft-incomplete, never a crash.
 */
export function triageFromEnv(
  readEnv: () => NodeJS.ProcessEnv = () => process.env,
  opts: { fetchFn?: typeof fetch } = {},
): (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult> {
  return async (findingsIn, scope) => {
    const env = readEnv();
    const model = triageModelFor(findingsIn, env);
    const apiKey = env.OPENROUTER_API_KEY;
    if (!model || !apiKey) {
      // Partial config (a key or a model set, but not both) is a misconfiguration
      // worth surfacing; a fully unconfigured env is the normal skipped path.
      if (model === null && (env.REXTOR_TRIAGE_MODEL || env.REXTOR_FRONTIER_MODEL || apiKey)) {
        console.warn("[rextor] triage env incomplete — need OPENROUTER_API_KEY, REXTOR_TRIAGE_MODEL, REXTOR_FRONTIER_MODEL; running untriaged");
      }
      return rawFindingsResult(findingsIn);
    }
    const findings = withIds(findingsIn);
    const universe = buildCitationUniverse(findings, scope);
    const messages: ChatMessage[] = [
      { role: "system", content: PROFILE_V1_SYSTEM },
      { role: "user", content: buildTriageUserMessage(findings, universe) },
    ];
    try {
      let raw = await chatCompletion({ apiKey, model, fetchFn: opts.fetchFn }, messages);
      let parsed = extractJsonArray(raw);
      if (parsed === null) {
        // SPEC-2 §3: retry ONCE with a corrective note.
        raw = await chatCompletion({ apiKey, model, fetchFn: opts.fetchFn }, [
          ...messages,
          { role: "assistant", content: raw.slice(0, 500) },
          { role: "user", content: "Your previous output was not valid JSON. Return ONLY the JSON array." },
        ]);
        parsed = extractJsonArray(raw);
      }
      if (parsed === null) throw new TriageUnavailableError("no JSON array in response after retry");
      const { valid, rejected } = validateOps(parsed, findings, universe);
      return {
        finalFindings: applyTriage(findings, valid),
        ops: valid,
        rejectedOps: rejected,
        modelUsed: model,
        triageStatus: "complete",
      };
    } catch (err) {
      console.error("[rextor] triage failed:", err instanceof Error ? err.message : err);
      return {
        ...rawFindingsResult(findings),
        modelUsed: model,
      };
    }
  };
}
