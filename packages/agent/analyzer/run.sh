#!/usr/bin/env sh
# Contract: NDJSON findings on stdout; exit 3 + {"status":"incomplete"} on analyzer failure.
set -u
# SPEC-8 §1 — chain dispatch by repo shape: Anchor.toml at the repo root, or
# anchor-lang declared under programs/*/Cargo.toml, routes to the Solana
# (semgrep) slice; every other repo takes the Slither path byte-identical to
# pre-SPEC-8 behavior. The NDJSON/incomplete contract is chain-blind.
if [ -f /repo/Anchor.toml ] || grep -qs 'anchor-lang' /repo/programs/*/Cargo.toml; then
  exec /usr/local/bin/solana.sh
fi
if ! command -v slither >/dev/null 2>&1; then
  echo '{"status":"incomplete","reason":"slither-missing"}'; exit 3
fi
# Copy the mounted PR into a writable workdir and analyze THERE: the container
# runs as an unprivileged user (the mount may be read-only or unwritable), and
# a PR's forge build must never write back into the mounted repo.
WORK="$(mktemp -d)" || { echo '{"status":"incomplete","reason":"workdir-unavailable"}'; exit 3; }
cp -r /repo/. "$WORK"/ 2>/dev/null || true
cd "$WORK"
TMP="$(mktemp -d)/slither.json" || { echo '{"status":"incomplete","reason":"tmpdir-unavailable"}'; exit 3; }
# --fail-none keeps the exit code a completion signal: slither 0.11.6 defaults to
# fail_on=pedantic — it exits 255 whenever ANY finding exists (any impact) — which
# would misroute a finding-rich (clean) run into the incomplete branch. The JSON
# file is the source of truth.
if slither . --json "$TMP" --fail-none >/dev/null 2>"$TMP.err"; then
  python3 - "$TMP" "$TMP.err" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({"status": "incomplete", "reason": f"slither-json-unparseable: {e}"}))
    sys.exit(3)
detectors = data.get("results", {}).get("detectors", [])
try:
    with open(sys.argv[2], errors="replace") as f:
        stderr_text = f.read()
except OSError:
    stderr_text = ""
# slither exits 0 even when it compiled nothing ("No contract was analyzed",
# results: {}); that is an analyzer failure, never a clean pass.
if not detectors and "No contract was analyzed" in stderr_text:
    print('{"status":"incomplete","reason":"no-contract-analyzed"}')
    sys.exit(3)
for d in detectors:
    sev = {"High": "high", "Medium": "medium", "Low": "low"}.get(d.get("impact"), "low")
    first = (d.get("elements") or [{}])[0]
    src = first.get("source_mapping", {}) or {}
    print(json.dumps({
        "file": (src.get("filename_relative") or "?").split("/")[-1],
        "line": (src.get("lines") or [0])[0],
        "severity": sev,
        "check": d.get("check", "?"),
        "description": d.get("description", "")[:500],
    }))
PY
  rc=$?
  rm -rf "$(dirname "$TMP")"
  # A post-parse crash (python killed, disk full) must still carry the
  # incomplete line — exit 3 with empty stdout reads as a contract violation.
  [ "$rc" -eq 0 ] || { echo '{"status":"incomplete","reason":"crash"}'; exit 3; }
else
  # Interpolate through json.dumps: raw stderr can contain quotes, which would
  # break the single-line JSON contract.
  python3 - "$TMP.err" <<'PY'
import json, sys
err = open(sys.argv[1], errors="replace").read()[:200].replace("\n", " ").strip()
print(json.dumps({"status": "incomplete", "reason": f"slither-error: {err}"}))
PY
  rm -rf "$(dirname "$TMP")"; exit 3
fi
