#!/usr/bin/env sh
# Contract: NDJSON findings on stdout; exit 3 + {"status":"incomplete"} on analyzer failure.
set -u
cd /repo
if ! command -v slither >/dev/null 2>&1; then
  echo '{"status":"incomplete","reason":"slither-missing"}'; exit 3
fi
TMP="$(mktemp -d)/slither.json" || exit 3
# --fail-none keeps the exit code a completion signal: by default slither exits 255
# whenever a Medium/High finding exists, which would misroute a finding-rich (clean)
# run into the incomplete branch. The JSON file is the source of truth.
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
  [ "$rc" -eq 0 ] || exit 3
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
