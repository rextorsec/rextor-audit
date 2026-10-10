#!/usr/bin/env sh
# Contract: NDJSON findings on stdout; exit 3 + {"status":"incomplete"} on analyzer failure.
set -u
# SPEC-8 §1 — chain dispatch by repo shape. Anchor.toml at the repo root, or
# anchor-lang declared under programs/*/Cargo.toml, routes to the Solana
# (semgrep) slice; own .sol sources route to the EVM (Slither) slice. A MIXED
# repo (both shapes — e.g. a monorepo with contracts/ AND programs/) runs BOTH
# slices and STREAMS their NDJSON: a monorepo must not lose its EVM half just
# because an Anchor program shares the tree. Dual streaming contract: each
# slice's NDJSON is flushed to stdout the moment that slice's script exits,
# BEFORE the other slice starts (scope tagging included), so the ENTRYPOINT's
# 140s timeout can kill at most the side still running — a side that finished
# is never lost to end-of-run buffering again. The NDJSON/incomplete contract
# is chain-blind; in dual mode each side's incomplete line carries
# "scope":"solana"|"evm" so the pipeline can degrade per scope instead of
# discarding a side that scanned clean (parseAnalyzerReport, SPEC-1 §1).
# Exit codes: 0 iff both slices scanned clean; 3 when any side is incomplete —
# its line is already on stdout; a dispatcher (tagger) crash emits the
# contract's unscoped crash line, then exits 3.
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
# DUAL — both shapes present. Per-slice streaming: buffer one slice's NDJSON
# in $WORK, and as soon as its script exits flush the tagged lines to stdout,
# then (and only then) launch the other slice. tag_scope exits 0 (side clean),
# 3 (side incomplete — tagged or synthesized line already emitted), anything
# else is a dispatcher crash. Nothing but NDJSON lines may reach stdout here;
# tagger diagnostics go to stderr.
tag_scope() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys

# The old end-of-run merge's per-scope side() semantics, applied as each slice
# streams: findings pass through (raw non-JSON lines too, re-emitted
# JSON-encoded exactly like the merge's load()); an incomplete line is
# re-emitted once, after this slice's findings, carrying this slice's "scope";
# a slice that died without producing its own incomplete line (SIGKILL,
# interpreter crash) gets a synthesized one so the failure is never silent.
path, rc, scope = sys.argv[1], int(sys.argv[2]), sys.argv[3]
findings, reason = [], None
try:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                findings.append(line)  # never mangled; passes through verbatim
                continue
            if isinstance(rec, dict) and rec.get("status") == "incomplete":
                reason = str(rec.get("reason", f"{scope}-crash"))
            else:
                findings.append(rec)
except OSError:
    pass
for f in findings:
    print(json.dumps(f))
if reason is None:
    if rc == 0:
        sys.exit(0)
    # Non-zero with no incomplete line of its own — including a contract-
    # violating rc 3 — is still a failure: synthesize the scoped line.
    print(json.dumps({"status": "incomplete", "scope": scope,
                      "reason": f"slice-failed-rc-{rc}"}))
    sys.exit(3)
print(json.dumps({"status": "incomplete", "reason": reason, "scope": scope}))
sys.exit(3)
PY
}

WORK="$(mktemp -d)" || { echo '{"status":"incomplete","reason":"workdir-unavailable"}'; exit 3; }
/usr/local/bin/solana.sh >"$WORK/solana.ndjson"; s_rc=$?
tag_scope "$WORK/solana.ndjson" "$s_rc" solana; st_rc=$?
/usr/local/bin/evm.sh >"$WORK/evm.ndjson"; e_rc=$?
tag_scope "$WORK/evm.ndjson" "$e_rc" evm; et_rc=$?
rm -rf "$WORK"
# Exit contract: 0 iff both slices clean; 3 if any side incomplete (its line
# already streamed); a tagger exit outside {0,3} is a dispatcher crash — emit
# the contract's crash line.
for trc in "$st_rc" "$et_rc"; do
  if [ "$trc" -ne 0 ] && [ "$trc" -ne 3 ]; then
    echo '{"status":"incomplete","reason":"crash"}'
    exit 3
  fi
done
if [ "$st_rc" -eq 3 ] || [ "$et_rc" -eq 3 ]; then
  exit 3
fi
exit 0
