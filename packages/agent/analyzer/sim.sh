#!/bin/sh
# SPEC-3 §2 — fork-sim harness. Runs INSIDE the analyzer container as the
# unprivileged analyzer user. Mounts: /repo = target repo (read-only), /poc =
# writable overlay holding RextorPoc.t.sol. Env: FORK_URL (required),
# FORK_BLOCK (optional pin). Artifacts: /poc/result.json, /poc/stderr.txt,
# /poc/block.txt.
set -eu
: "${FORK_URL:?FORK_URL is required}"
BLOCK="${FORK_BLOCK:-$(cast block-number --rpc-url "$FORK_URL")}"

# Simroot: a writable mirror of the repo. Repo entries are SYMLINKED in
# (skipping build dirs), so forge compiles against repo sources without ever
# writing to the :ro mount. test/ must be a REAL dir — it receives the
# generated PoC — so the repo's test dir is merged into it entry-by-entry:
# symlinking the dir itself would make `ln` nest (test/test) and double every
# relative import path (empirically verified).
mkdir -p /poc/simroot/test
for d in /repo/* /repo/.[!.]*; do
  [ -e "$d" ] || continue
  base="$(basename "$d")"
  case "$base" in out|cache|.git|test|foundry.toml) continue ;; esac
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
# ffi = true from the project file — env loses to config), so the env override
# alone cannot deny FFI. Rewriting ONLY ffi assignments to false keeps the
# rest of the PR's build config intact while making denial unconditional.
if [ -f /repo/foundry.toml ]; then
  cp /repo/foundry.toml /poc/simroot/foundry.toml
  sed -i "s/^[[:space:]]*[\"']\{0,1\}ffi[\"']\{0,1\}[[:space:]]*=.*/ffi = false/" /poc/simroot/foundry.toml
fi

cd /poc/simroot
# Alias-style imports ("src/X.sol") don't resolve from test/ by themselves:
# seed remappings.txt with forge's auto-detected remappings plus the src
# alias. Relative imports ("../src/X.sol") need no help.
forge remappings > remappings.txt 2>/dev/null || true
grep -qx "src/=src/" remappings.txt || echo "src/=src/" >> remappings.txt

# FFI denied — belt and braces with the patched config above.
export FOUNDRY_FFI=false
# Self-termination just inside the runner's 240s execFile timeout (SIGKILL on
# the CLI must not strand a hung container holding the analyzer's budget).
status=0
timeout -k 5s 220s forge test --match-contract RextorPocTest \
  --fork-url "$FORK_URL" --fork-block-number "$BLOCK" --json \
  > /poc/result.json 2> /poc/stderr.txt || status=$?
# The exit code is diagnostic only — result.json is the source of truth for
# the outcome (a failing test still yields parseable JSON).
echo "forge exit: $status" >> /poc/stderr.txt
# The block actually used, recorded even when forge fails (SPEC-3 §2
# reproducibility). A failed BLOCK resolution above dies via set -e, leaving
# block.txt absent — the runner reads that as a harness failure (unproven).
echo "$BLOCK" > /poc/block.txt
