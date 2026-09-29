#!/usr/bin/env sh
# Contract: NDJSON findings on stdout; exit 3 + {"status":"incomplete"} on analyzer failure.
set -u
# SPEC-8 §1 — chain dispatch by repo shape. Anchor.toml at the repo root, or
# anchor-lang declared under programs/*/Cargo.toml, routes to the Solana
# (semgrep) slice; own .sol sources route to the EVM (Slither) slice. A MIXED
# repo (both shapes — e.g. a monorepo with contracts/ AND programs/) runs BOTH
# and merges the NDJSON: a monorepo must not lose its EVM half just because an
# Anchor program shares the tree. The NDJSON/incomplete contract is
# chain-blind; in dual mode each side's incomplete line carries
# "scope":"solana"|"evm" so the pipeline can degrade per scope instead of
# discarding a side that scanned clean (parseAnalyzerReport, SPEC-1 §1).
anchor=false
[ -f /repo/Anchor.toml ] && anchor=true
if [ "$anchor" = false ] && grep -qs 'anchor-lang' /repo/programs/*/Cargo.toml; then
  anchor=true
fi
# Own-source check mirrors evm.sh's vendored-tree walker: lib/, node_modules/,
# out/, cache/, artifacts/, broadcast/, .git/ are never the repo's own code.
own_sol=false
if find /repo -name '*.sol' -not -path '*/lib/*' -not -path '*/node_modules/*' \
     -not -path '*/out/*' -not -path '*/cache/*' -not -path '*/artifacts/*' \
     -not -path '*/broadcast/*' -not -path '*/.git/*' 2>/dev/null | grep -q .; then
  own_sol=true
fi
if [ "$anchor" = true ] && [ "$own_sol" = false ]; then
  exec /usr/local/bin/solana.sh
fi
if [ "$anchor" = false ]; then
  exec /usr/local/bin/evm.sh
fi
# DUAL — both shapes present: run each side, tag its incompletes, merge.
WORK="$(mktemp -d)" || { echo '{"status":"incomplete","reason":"workdir-unavailable"}'; exit 3; }
/usr/local/bin/solana.sh >"$WORK/solana.ndjson"; s_rc=$?
/usr/local/bin/evm.sh >"$WORK/evm.ndjson"; e_rc=$?
python3 - "$WORK/solana.ndjson" "$WORK/evm.ndjson" "$s_rc" "$e_rc" <<'PY'
import json, sys

def load(path):
    out = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(("rec", json.loads(line)))
                    except Exception:
                        out.append(("raw", line))
    except OSError:
        pass
    return out

def side(lines, rc, scope):
    findings, reason = [], None
    for kind, rec in lines:
        if kind == "raw":
            findings.append(rec)  # never mangled; passes through verbatim
            continue
        if isinstance(rec, dict) and rec.get("status") == "incomplete":
            reason = str(rec.get("reason", f"{scope}-crash"))
        else:
            findings.append(rec)
    # A side that died without producing its own incomplete line (SIGKILL,
    # python crash) is still a failure — synthesize the contract's reason.
    if rc not in (0, 3) and reason is None:
        reason = f"{scope}-crash (exit {rc})"
    return findings, reason

sf, si = side(load(sys.argv[1]), int(sys.argv[3]), "solana")
ef, ei = side(load(sys.argv[2]), int(sys.argv[4]), "evm")
for f in sf + ef:
    print(json.dumps(f))
degraded = [(s, r) for s, r in (("solana", si), ("evm", ei)) if r]
if not sf and not ef:
    # Both sides failed: the report is incomplete — emit both scoped reasons.
    for scope, reason in degraded:
        print(json.dumps({"status": "incomplete", "reason": reason, "scope": scope}))
    sys.exit(3)
# At least one side completed: findings flow; scoped incompletes ride along as
# visible degradation (parseAnalyzerReport surfaces them as a comment note —
# never silent, never report-losing).
if degraded:
    print(json.dumps({
        "status": "incomplete",
        "reason": " | ".join(f"{s}: {r}" for s, r in degraded),
        "scope": "dual",
    }))
sys.exit(0)
PY
rc=$?
rm -rf "$WORK"
# rc 0 = merged report on stdout; rc 3 = both-failed incompletes already
# emitted; anything else is a dispatcher crash — emit the contract line.
if [ "$rc" -eq 0 ]; then
  exit 0
fi
if [ "$rc" -ne 3 ]; then
  echo '{"status":"incomplete","reason":"crash"}'
fi
exit 3
