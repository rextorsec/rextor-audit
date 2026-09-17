### Task 1: SPEC-2 triage core (pure) — findings extensions + validateOps/applyTriage + rubric v1 + findingsHash

**Files:**
- Modify: `packages/agent/src/findings.ts`
- Create: `packages/agent/src/triage.ts`
- Create: `packages/agent/test/triage.test.ts`
- Modify: `packages/agent/test/findings.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `Finding`, `Severity`, `SEVERITIES` (currently private — export it), `score`.
- Produces (later tasks rely on these EXACT names):
  - `findings.ts`: `export interface PocInfo { status: "confirmed" | "unproven" | "skipped"; testSource?: string; block?: number }`; `Finding` gains optional `id?: number; triageNote?: string; mergedChecks?: string[]; poc?: PocInfo`; `withIds(findings: Finding[]): Finding[]`; `scoreV1(findings: Finding[]): number`; `canonicalFindingsJson(findings: Finding[]): string`; `findingsHash(findings: Finding[]): string`.
  - `triage.ts`: `export type TriageOp = { op: "reclassify"; id: number; severity: Severity; reason: string } | { op: "dedup"; canonicalId: number; duplicateIds: number[] } | { op: "add"; file: string; line: number; severity: Severity; check: string; description: string }`; `export interface UniverseEntry { file: string; lines: Array<[number, number]> }`; `export interface TriageOutcome { valid: TriageOp[]; rejected: Array<{ op: unknown; reason: string }> }`; `buildCitationUniverse(findings, scope): UniverseEntry[]`; `validateOps(raw: unknown, findings: Finding[], universe: UniverseEntry[]): TriageOutcome`; `applyTriage(findings: Finding[], ops: TriageOp[]): Finding[]`.

- [ ] **Step 1: Write the failing tests**

`packages/agent/test/triage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyTriage, buildCitationUniverse, validateOps,
  type TriageOp, type UniverseEntry,
} from "../src/triage";
import { withIds, type Finding } from "../src/findings";

const f = (over: Partial<Finding>): Finding =>
  withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d", ...over }])[0];

const scope = {
  contractFiles: [{ path: "src/V.sol", changedLineRanges: [[10, 12] as [number, number]], isContract: true as const }],
  hasContractChanges: true,
};

describe("buildCitationUniverse", () => {
  it("merges finding locations and diff-added ranges per file", () => {
    const u = buildCitationUniverse([f({ file: "src/Other.sol", line: 3 })], scope);
    expect(u).toContainEqual({ file: "src/Other.sol", lines: [[3, 3]] });
    expect(u).toContainEqual({ file: "src/V.sol", lines: [[10, 12]] });
  });
});

describe("validateOps rejection rules (one crafted bad op per rule)", () => {
  const base = withIds([
    { file: "src/V.sol", line: 10, severity: "high", check: "a", description: "da" },
    { file: "src/V.sol", line: 11, severity: "low", check: "b", description: "db" },
  ]);
  const u: UniverseEntry[] = [{ file: "src/V.sol", lines: [[10, 12]] }];
  const good = (op: object) => [op, ...[]];

  it.each([
    ["unknown id", { op: "reclassify", id: 99, severity: "low", reason: "x" }],
    ["bad severity", { op: "reclassify", id: 0, severity: "blocker", reason: "x" }],
    ["empty reason", { op: "reclassify", id: 0, severity: "low", reason: "" }],
    ["dedup empty duplicates", { op: "dedup", canonicalId: 0, duplicateIds: [] }],
    ["dedup self-referencing", { op: "dedup", canonicalId: 0, duplicateIds: [0] }],
    ["dedup duplicate ids in list", { op: "dedup", canonicalId: 0, duplicateIds: [1, 1] }],
    ["dedup same dup twice across ops", [
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
    ]],
    ["reclassify of deduped id", [
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "reclassify", id: 1, severity: "low", reason: "x" },
    ]],
    ["add outside universe (file)", { op: "add", file: "src/Nope.sol", line: 1, severity: "low", check: "c", description: "d" }],
    ["add outside universe (line)", { op: "add", file: "src/V.sol", line: 99, severity: "low", check: "c", description: "d" }],
    ["add empty check", { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "", description: "d" }],
    ["add empty description", { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "c", description: "" }],
    ["unknown op kind", { op: "delete", id: 0 }],
    ["not an object", 42],
  ])("rejects %s", (_name, bad) => {
    const out = validateOps(good(bad as never), base, u);
    expect(out.rejected).toHaveLength(1);
    expect(out.valid).toHaveLength(0);
    expect(out.rejected[0].reason).toBeTruthy();
  });

  it("accepts well-formed ops of all three kinds", () => {
    const out = validateOps([
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "reclassify", id: 0, severity: "medium", reason: "r" },
      { op: "add", file: "src/V.sol", line: 12, severity: "low", check: "new", description: "nd" },
    ], base, u);
    expect(out.rejected).toEqual([]);
    expect(out.valid).toHaveLength(3);
  });

  it("rejects the whole input when not an array", () => {
    expect(validateOps({ op: "reclassify" }, base, u).rejected).toHaveLength(1);
  });
});

describe("applyTriage", () => {
  it("dedup merges attribution into canonical (mergedChecks)", () => {
    const base = withIds([
      { file: "a.sol", line: 1, severity: "high", check: "slither-x", description: "d" },
      { file: "a.sol", line: 1, severity: "high", check: "aderyn-y", description: "d" },
    ]);
    const ops: TriageOp[] = [{ op: "dedup", canonicalId: 0, duplicateIds: [1] }];
    const out = applyTriage(base, ops);
    expect(out).toHaveLength(1);
    expect(out[0].check).toBe("slither-x");
    expect(out[0].mergedChecks).toEqual(["slither-x", "aderyn-y"]);
  });

  it("reclassify records triageNote and new severity", () => {
    const out = applyTriage(withIds([f({ id: 0, severity: "high" })]), [
      { op: "reclassify", id: 0, severity: "medium", reason: "guard exists" },
    ]);
    expect(out[0].severity).toBe("medium");
    expect(out[0].triageNote).toBe("guard exists");
  });

  it("add forces the rextor/ prefix and fresh sequential ids", () => {
    const out = applyTriage(withIds([f({})]), [
      { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "custom", description: "nd" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].check).toBe("rextor/custom");
    expect(out[1].id).toBe(1);
  });

  it("applies category order dedup → reclassify → add", () => {
    const base = withIds([
      { file: "a.sol", line: 1, severity: "critical", check: "a", description: "d" },
      { file: "a.sol", line: 1, severity: "critical", check: "b", description: "d" },
    ]);
    const out = applyTriage(base, [
      { op: "reclassify", id: 0, severity: "high", reason: "r" },   // applies AFTER dedup kept id 0
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("high");
  });
});
```

Append to `packages/agent/test/findings.test.ts`:

```ts
import { createHash } from "node:crypto";
import {
  canonicalFindingsJson, findingsHash, scoreV1, withIds,
} from "../src/findings";

describe("scoreV1 (rubric v1 — SPEC-2 §2)", () => {
  const finding = (severity: Severity, poc?: PocInfo["status"]): Finding => ({
    file: "a.sol", line: 1, severity, check: "c", description: "d",
    ...(poc ? { poc: { status: poc } } : {}),
  });
  it.each([
    [[finding("critical")], 60],
    [[finding("critical", "confirmed")], 60],
    [[finding("critical", "skipped")], 60],
    [[finding("critical", "unproven")], 25],
    [[finding("high")], 25],
    [[finding("medium"), finding("low")], 13],
    [[finding("critical"), finding("critical"), finding("high")], 100], // 145 capped
  ])("scoreV1(%j) === %i", (findings, expected) => {
    expect(scoreV1(findings)).toBe(expected);
  });
});

describe("canonicalFindingsJson + findingsHash", () => {
  it("is key-order independent and backtick-free", () => {
    const a = withIds([{ file: "a.sol", line: 1, severity: "low", check: "c", description: "d" }]);
    const b = [{ description: "d", check: "c", line: 1, severity: "low", file: "a.sol", id: 0 }];
    expect(canonicalFindingsJson(a)).toBe(canonicalFindingsJson(b as Finding[]));
    expect(canonicalFindingsJson(a)).not.toContain("`");
  });
  it("escapes backticks as \\u0060 but parses back identically", () => {
    const fs = withIds([{ file: "a.sol", line: 1, severity: "low", check: "c", description: "has `ticks`" }]);
    const canonical = canonicalFindingsJson(fs);
    expect(canonical).toContain("\\u0060");
    expect(JSON.parse(canonical)[0].description).toBe("has `ticks`");
  });
  it("matches an externally computed sha256 vector", () => {
    // Vector computed OUTSIDE the implementation (implementer: run
    //   printf %s '<CANONICAL_LITERAL>' | shasum -a 256
    // over the exact canonical literal asserted below and paste the digest here):
    const canonical = canonicalFindingsJson(
      withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d" }]),
    );
    expect(canonical).toBe(
      '[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]',
    );
    expect(findingsHash(
      withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d" }]),
    )).toBe("<PASTE_SHA256_HERE>");
  });
});
```

For `<PASTE_SHA256_HERE>`: compute `printf %s '[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]' | shasum -a 256` in your shell and paste the hex — this keeps the vector independent of the implementation (never derive it by calling `findingsHash`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/triage.test.ts test/findings.test.ts`
Expected: FAIL — `validateOps`/`applyTriage`/`scoreV1` not exported; TS import errors.

- [ ] **Step 3: Implement**

`packages/agent/src/findings.ts` — extend (keep every existing export and behavior intact):

```ts
export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"]; // was private, now exported

export interface PocInfo {
  status: "confirmed" | "unproven" | "skipped";
  testSource?: string;
  block?: number;
}

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  check: string;
  description: string;
  id?: number;
  triageNote?: string;
  mergedChecks?: string[];
  poc?: PocInfo;
}

/** Assign stable 0-based ids in analyzer order (SPEC-2 §1). Non-destructive. */
export function withIds(findings: Finding[]): Finding[] {
  return findings.map((f, id) => ({ ...f, id }));
}

/** Rubric v1 (SPEC-2 §2): v0 weights + one poc-aware rule. */
export function scoreV1(findings: Finding[]): number {
  const total = findings.reduce((sum, f) => {
    const w = f.severity === "critical" && f.poc?.status === "unproven" ? 25 : RUBRIC[f.severity];
    return sum + w;
  }, 0);
  return Math.min(total, SCORE_CAP);
}

function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableValue);
  if (v !== null && typeof v === "object") {
    const src = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .filter((k) => src[k] !== undefined)
        .sort()
        .map((k) => [k, stableValue(src[k])]),
    );
  }
  return v;
}

/** SPEC-2 §2 canonical form: sorted keys, compact, backticks escaped as \u0060. */
export function canonicalFindingsJson(findings: Finding[]): string {
  return JSON.stringify(stableValue(findings)).replaceAll("`", "\\u0060");
}

export function findingsHash(findings: Finding[]): string {
  return createHash("sha256").update(canonicalFindingsJson(findings), "utf8").digest("hex");
}
```

Add `import { createHash } from "node:crypto";` at the top. IMPORTANT: the existing `parseFindingLine` must NOT accept the new optional fields from analyzer NDJSON — analyzer output shape is frozen (SPEC-1 §1).

`packages/agent/src/triage.ts`:

```ts
// SPEC-2 §1 — triage ops: the LLM proposes, deterministic TS validates + applies.
import { SEVERITIES, type Finding, type Severity } from "./findings";
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
const isId = (v: unknown): v is number => Number.isInteger(v) && v >= 0;

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
```

Also `diff-scope.ts`: add `export type Scope = DiffScopeResult;` (alias so later tasks/specs can say `Scope`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run && pnpm typecheck`
Expected: ALL PASS (existing 54 + new ~25).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/findings.ts packages/agent/src/triage.ts packages/agent/src/diff-scope.ts packages/agent/test/triage.test.ts packages/agent/test/findings.test.ts
git commit -m "feat: SPEC-2 triage core — op schema, validation, application, rubric v1, findingsHash"
```

---

