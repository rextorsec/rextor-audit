FROM python:3.12-slim

# curl + ca-certificates: absent from the slim base; needed by solc-select and
# foundryup. Build-time only — the runtime container runs with --network none.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Pinned: the no-contract failure classification in run.sh keys on this
# version's exact stderr wording and fail_on default (verified against 0.11.6).
RUN pip install --no-cache-dir slither-analyzer==0.11.6 \
 && pip cache purge

# SPEC-8 §1 — Solana (Anchor) slice: semgrep pinned to the version the rule
# pack's acceptance evidence was produced against (1.176.0, 2026-09-19).
RUN pip install --no-cache-dir semgrep==1.176.0 \
 && pip cache purge

# solc-select shim is global (pip); the version cache is per-user and is
# populated below as the runtime user, so the shim resolves at run time.
RUN pip install --no-cache-dir solc-select \
 && pip cache purge

# Unprivileged runtime user (SPEC-1 invariant 3: PR content is untrusted — its
# foundry.toml drives forge build, so it must not run as root).
RUN useradd -m -s /usr/sbin/nologin analyzer
USER analyzer
ENV HOME=/home/analyzer
ENV PATH="/home/analyzer/.foundry/bin:${PATH}"

# solc via solc-select, pinned; cache lives in the analyzer user's HOME.
RUN solc-select install 0.8.24 && solc-select use 0.8.24

# Foundry (Ruling 6): crytic-compile detects foundry.toml and invokes `forge
# build`, so the image must ship the forge toolchain. Pinned release
# (v1.8.3, latest at time of writing) — never floating `stable`.
RUN curl -L https://foundry.paradigm.xyz | bash \
 && /home/analyzer/.foundry/bin/foundryup -i v1.8.5

# Pre-warm foundry's own solc 0.8.24 (fixtures pin solc_version = "0.8.24"):
# runtime runs with --network none, so the svm cache must already hold the
# compiler — a PR-triggered `forge build` must never need to download one.
RUN set -ex \
 && mkdir -p /tmp/warm/src \
 && printf '[profile.default]\nsrc = "src"\nsolc_version = "0.8.24"\n' > /tmp/warm/foundry.toml \
 && printf '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract Warm {}\n' > /tmp/warm/src/Warm.sol \
 && cd /tmp/warm && forge build \
 && rm -rf /tmp/warm

# Pre-warm foundry's own solc 0.8.28 the same way: real-world monorepos pin
# newer compilers (first live monorepo review, sip-protocol#1267, pinned
# 0.8.28 — an offline `forge build` cannot auto-install, so any unpinned
# compiler is an instant InvalidCompilation and a false INCOMPLETE receipt).
# Keep the pragma permissive (`>=0.8.28`) so the pinned compiler is the one
# that builds the warm project.
RUN set -ex \
 && mkdir -p /tmp/warm28/src \
 && printf '[profile.default]\nsrc = "src"\nsolc_version = "0.8.28"\n' > /tmp/warm28/foundry.toml \
 && printf '// SPDX-License-Identifier: MIT\npragma solidity >=0.8.28;\ncontract Warm {}\n' > /tmp/warm28/src/Warm.sol \
 && cd /tmp/warm28 && forge build \
 && rm -rf /tmp/warm28
# Pre-warm foundry's own solc 0.8.37 (same class as 0.8.28 above): first
# target found live 2026-10-09 (trindadeRodrigo/colosseum contracts/ pins
# 0.8.37 + cancun + via_ir). Note the image's foundry must be new enough to
# KNOW 0.8.37 — v1.8.3's bundled svm release list predates it and answers
# "does not exist" (verified against binaries.soliditylang.org list.json,
# latestRelease 0.8.37) — hence the v1.8.5 pin above.
RUN set -ex \
 && mkdir -p /tmp/warm37/src \
 && printf '[profile.default]\nsrc = "src"\nsolc_version = "0.8.37"\n' > /tmp/warm37/foundry.toml \
 && printf '// SPDX-License-Identifier: MIT\npragma solidity >=0.8.37;\ncontract Warm {}\n' > /tmp/warm37/src/Warm.sol \
 && cd /tmp/warm37 && forge build \
 && rm -rf /tmp/warm37
WORKDIR /repo
USER root
COPY run.sh /usr/local/bin/run.sh
COPY evm.sh /usr/local/bin/evm.sh
COPY sim.sh /usr/local/bin/sim.sh
COPY solana.sh /usr/local/bin/solana.sh
# Known-good forge-std, baked for the sim harness: sim.sh pins the
# `forge-std/` remapping here so a PR's vendored/poisoned forge-std can never
# own the assertions a PoC "passes" on (see vendor/forge-std/PROVENANCE.md).
COPY vendor/forge-std /opt/rextor/forge-std
# SPEC-8 §1 — Solana rule pack, baked read-only at /opt/rextor/rules: a PR
# never supplies the rules it is judged by.
COPY rules/solana-anchor /opt/rextor/rules/solana-anchor
RUN chmod +x /usr/local/bin/run.sh /usr/local/bin/evm.sh /usr/local/bin/sim.sh /usr/local/bin/solana.sh
USER analyzer
# Self-termination just inside the runner's 150s execFile timeout: SIGKILL on
# the CLI would otherwise strand a hung container holding its 2g/2cpu budget.
# coreutils `timeout` ships with debian slim (priority:required).
ENTRYPOINT ["timeout", "-k", "5s", "140s", "/usr/local/bin/run.sh"]
