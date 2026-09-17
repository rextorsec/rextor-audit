// SPEC-4 §1 verdict-identity vectors — shared by findings.test.ts (T1) and
// attest.test.ts (T8) so both suites pin the SAME externally-computed
// literals. Digests computed OUTSIDE the implementation:
//   printf %s '<CANONICAL_FINDINGS_LITERAL>' | shasum -a 256
//   printf %s '[]' | shasum -a 256

/** Canonical form (SPEC-2 §2) of VECTOR_FINDINGS — sorted keys, compact. */
export const CANONICAL_FINDINGS_LITERAL =
  '[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]';

/** sha256(CANONICAL_FINDINGS_LITERAL), hex, no 0x prefix. */
export const CANONICAL_FINDINGS_SHA256 =
  "e68cea4f66e1dde2b0bdba549c0d57ae7d37550a35896f946459666fd607a244";

/** The findings the canonical vector was computed over (analyzer order, ids assigned). */
export const VECTOR_FINDINGS = [
  { file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d", id: 0 },
] as const;

/** sha256("[]") — the hard-incomplete (empty findings) payload hash. */
export const EMPTY_FINDINGS_SHA256 =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
