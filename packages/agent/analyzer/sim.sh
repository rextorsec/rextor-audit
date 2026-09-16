#!/bin/sh
# SPEC-3 §2 — fork-sim harness. Runs INSIDE the analyzer container as the
# unprivileged analyzer user. Mounts: /repo = target repo (read-only), /poc =
# writable overlay holding RextorPoc.t.sol. Env: FORK_URL (required),
# FORK_BLOCK (optional pin). Artifacts: /poc/result.json, /poc/stderr.txt,
# /poc/block.txt.
#
# Untrusted-input policy: every config-bearing PR file is either excluded from
# the simroot mirror (remappings.txt) or replaced by a patched copy
# (foundry.toml), and both FFI and the forge-std remapping are verified
# against the RESOLVED config fail-closed — a violation is a harness failure
# (unproven upstream), never a run with attacker-owned cheatcode or asserts.
set -eu
: "${FORK_URL:?FORK_URL is required}"
BLOCK="${FORK_BLOCK:-$(cast block-number --rpc-url "$FORK_URL")}"

# Simroot: a writable mirror of the repo. Repo entries are SYMLINKED in
# (skipping build dirs and everything the harness owns), so forge compiles
# against repo sources without ever writing to the :ro mount. test/ must be a
# REAL dir — it receives the generated PoC — so the repo's test dir is merged
# into it entry-by-entry: symlinking the dir itself would make `ln` nest
# (test/test) and double every relative import path (empirically verified).
mkdir -p /poc/simroot/test
for d in /repo/* /repo/.[!.]*; do
  [ -e "$d" ] || continue
  base="$(basename "$d")"
  case "$base" in out|cache|.git|test|foundry.toml|remappings.txt) continue ;; esac
  ln -sfn "$d" "/poc/simroot/$base"
done
for f in /repo/test/* /repo/test/.[!.]*; do
  [ -e "$f" ] || continue
  ln -sfn "$f" "/poc/simroot/test/$(basename "$f")"
done
cp /poc/RextorPoc.t.sol /poc/simroot/test/RextorPoc.t.sol

# foundry.toml is a patched COPY, never the PR's original: ffi's default is
# false, and a PR-controlled `ffi = true` in foundry.toml BEATS the
# FOUNDRY_FFI env var (forge 1.8.3: `FOUNDRY_FFI=false forge config` resolves
# ffi = true from the project file — env loses to config). Rewriting ONLY ffi
# assignments to false keeps the rest of the PR's build config intact. This
# sed is hygiene — line-based rewriting cannot be exhaustive (dotted keys,
# quoted keys, future syntax), so the RESOLVED config is asserted below.
if [ -f /repo/foundry.toml ]; then
  cp /repo/foundry.toml /poc/simroot/foundry.toml
  sed -i "s/^[[:space:]]*[\"']\{0,1\}ffi[\"']\{0,1\}[[:space:]]*=.*/ffi = false/" /poc/simroot/foundry.toml
fi

cd /poc/simroot

# Remappings are harness-owned: the PR's root remappings.txt never enters the
# simroot, so this fresh file is the single source. Seed it with forge's
# resolved view of the PR config (toml remappings + lib auto-detection) so
# legitimate project mappings survive, then pin forge-std to the baked
# known-good copy — a PR shipping its own forge-std (vendored lib, toml
# remappings, or remappings.txt) must not own the assertions a PoC "passes"
# on. remappings.txt overrides toml and auto-detection entirely (verified on
# 1.8.3), so the effective set is exactly this file.
BAKED_FORGE_STD="/opt/rextor/forge-std/src/"
forge remappings 2>/dev/null | grep -v '^forge-std/' > remappings.txt || true
grep -qx 'src/=src/' remappings.txt || echo 'src/=src/' >> remappings.txt
echo "forge-std/=$BAKED_FORGE_STD" >> remappings.txt

# Fail-closed gate 1 — FFI: whatever the PR's config trickery, the RESOLVED
# config (env + project file + global) must have ffi disabled. A resolved
# ffi=true is a harness failure (unproven), never a run with vm.ffi available
# to PR-controlled test code in the only network-enabled container.
if FOUNDRY_FFI=false forge config --json 2>/dev/null \
    | grep -q '"ffi"[[:space:]]*:[[:space:]]*true'; then
  echo "resolved foundry config has ffi enabled — refusing to run" >&2
  exit 1
fi

# Fail-closed gate 2 — forge-std: the resolved remappings must pin forge-std
# to the baked copy, exactly once. Anything else (PR remappings winning,
# duplicate mappings, missing bake) refuses the run.
resolved_remappings="$(forge remappings 2>/dev/null || true)"
if [ "$(printf '%s\n' "$resolved_remappings" | grep -c '^forge-std/' || true)" != "1" ] || \
   ! printf '%s\n' "$resolved_remappings" | grep -qx "forge-std/=$BAKED_FORGE_STD"; then
  echo "forge-std remapping is not pinned to the baked copy — refusing to run" >&2
  exit 1
fi

# FFI denied — belt and braces with the gates above.
export FOUNDRY_FFI=false
# Self-termination just inside the runner's 240s execFile timeout (SIGKILL on
# the CLI must not strand a hung container holding the analyzer's budget).
status=0
timeout -k 5s 220s forge test --match-contract RextorPocTest \
  --match-path 'test/RextorPoc.t.sol' \
  --fork-url "$FORK_URL" --fork-block-number "$BLOCK" --json \
  > /poc/result.json 2> /poc/stderr.txt || status=$?
# The exit code is diagnostic only — result.json is the source of truth for
# the outcome (a failing test still yields parseable JSON).
echo "forge exit: $status" >> /poc/stderr.txt
# The block actually used, recorded even when forge fails (SPEC-3 §2
# reproducibility). A failed BLOCK resolution above dies via set -e, leaving
# block.txt absent — the runner reads that as a harness failure (unproven).
echo "$BLOCK" > /poc/block.txt
