#!/usr/bin/env sh
# SPEC-8 §1 — Solana (Anchor) analyzer slice: baked semgrep rule pack → NDJSON.
# Same contract as run.sh (SPEC-1 §1): NDJSON findings on stdout; exit 3 +
# {"status":"incomplete","reason":…} on analyzer failure. Never a silent clean
# pass: a scan that ends with semgrep errors, or a rust-bearing repo with zero
# findings, is incompleteness — never clean (invariant 25).
set -u
if ! command -v semgrep >/dev/null 2>&1; then
  echo '{"status":"incomplete","reason":"semgrep-missing"}'; exit 3
fi
# Same hygiene as run.sh: analyze a writable COPY, never the read-only mount.
WORK="$(mktemp -d)" || { echo '{"status":"incomplete","reason":"workdir-unavailable"}'; exit 3; }
cp -r /repo/. "$WORK"/ 2>/dev/null || true
cd "$WORK"
TMP="$(mktemp -d)/semgrep.json" || { echo '{"status":"incomplete","reason":"tmpdir-unavailable"}'; exit 3; }

# Fail-closed presence check: an Anchor-dispatched repo with no Rust sources
# is a dispatch error, not a clean pass (mirrors run.sh's no-contract rule).
if ! find . -name '*.rs' -not -path './target/*' -not -path './.git/*' | grep -q .; then
  echo '{"status":"incomplete","reason":"no-rust-analyzed"}'
  rm -rf "$WORK" "$(dirname "$TMP")"; exit 3
fi

# Findings don't gate the exit code; the JSON file is the source of truth
# (same discipline as run.sh's slither --fail-none). A semgrep that dies
# before writing JSON leaves an unparseable file → the incomplete branch.
semgrep --config /opt/rextor/rules/solana-anchor --json . > "$TMP" 2>"$TMP.err"
python3 - "$TMP" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({"status": "incomplete", "reason": f"semgrep-json-unparseable: {e}"}))
    sys.exit(3)
# Fail-closed gate: the errors array inside otherwise-valid JSON means the
# scan was PARTIAL (unparseable rust file, config trouble). Partial is not
# clean — spec §1 and invariant 25.
errors = data.get("errors") or []
if errors:
    first = str((errors[0] or {}).get("message", "semgrep-error"))[:200].replace("\n", " ")
    print(json.dumps({"status": "incomplete", "reason": f"semgrep-error: {first}"}))
    sys.exit(3)
SEV = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
for r in data.get("results", []):
    extra = r.get("extra") or {}
    meta = extra.get("metadata") or {}
    # Severity authority: rule metadata.rextor_severity; semgrep's own level
    # is the documented fallback — never silent (SPEC-8 §1).
    sev = meta.get("rextor_severity") or SEV.get(extra.get("severity"), "low")
    print(json.dumps({
        "file": (r.get("path") or "?").split("/")[-1],
        "line": (r.get("start") or {}).get("line") or 0,
        "severity": sev,
        "check": (r.get("check_id") or "?").split(".")[-1],
        "description": (extra.get("message") or "")[:500],
    }))
PY
rc=$?
rm -rf "$WORK" "$(dirname "$TMP")"
# A post-parse crash must still carry the incomplete line — exit 3 with empty
# stdout reads as a contract violation (same rule as run.sh).
[ "$rc" -eq 0 ] || { echo '{"status":"incomplete","reason":"crash"}'; exit 3; }
exit 0
