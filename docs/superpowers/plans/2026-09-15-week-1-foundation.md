# Week 1 — Foundation: Engine Loop on EVM (Implementation Plan)

> **✅ EXECUTED 2026-09-15** — all 5 tasks complete on `feat/week-1-engine-loop` (92d62eb..9ebebfb), 46/46 vitest + tsc strict green, every task review-gated (SDD), final whole-branch review clean after one fix wave. 9 controller rulings recorded in the archived ledger (`docs/superpowers/reports/week-1-foundation/progress.md`). Gates A & B resolved the same day (see PLAN.md + docs/gates/) — Gate B pivoted the product EVM-first (Tempo flagship).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end engine loop on a test repo: PR webhook → diff-scope → Slither-in-Docker → findings JSON → PR comment (no LLM yet), plus the vulnerable fixture that proves the whole pipeline.

**Architecture:** GitHub App webhook hits the agent service; it clones the PR head, scopes the diff to contract files, runs the Slither container, normalizes findings, and posts a PR comment via octokit. Everything deterministic — LLM triage lands in Week 2 on top of this spine.

**Tech Stack:** TypeScript (strict), Node 22 + tsx, vitest, Docker, Slither, Foundry, octokit.

**Spec:** [`docs/specs/SPEC-1-engine-loop.md`](../../specs/SPEC-1-engine-loop.md) — this plan implements it task-by-task; contracts live there, steps live here.

## Global Constraints

- pnpm v9, TypeScript `strict: true`. No `any` without a comment justifying it.
- Analyzer failures produce `{ status: "incomplete", reason }` — never an empty findings array pretending to be a clean pass.
- Findings carry `file`, `line`, `severity`, `check`, `description` — the schema Week 2's triage consumes.
- One commit per task. Prefixes `feat:` / `test:` / `chore:`.

---

### Task 1: Fixture — vulnerable Vault + proving Foundry test

**Files:**
- Create: `fixtures/vault/foundry.toml`
- Create: `fixtures/vault/src/Vault.sol`
- Create: `fixtures/vault/test/Vault.t.sol`

**Interfaces:**
- Produces: a Solidity contract with (a) reentrancy in `withdraw` and (b) unguarded `setOwner` lock-in — the same vuln pair the Conatus demo used, so Slither + Week-2 triage have known ground truth.

- [ ] **Step 1: Create `fixtures/vault/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
```

- [ ] **Step 2: Write `fixtures/vault/src/Vault.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Deliberately vulnerable demo fixture — NOT for production. Ground truth for pipeline tests.
contract Vault {
    mapping(address => uint256) public deposits;
    address public owner;

    constructor() { owner = msg.sender; }

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
    }

    // VULN 1: reentrancy — external call before state zeroing
    function withdraw() external {
        uint256 amount = deposits[msg.sender];
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        deposits[msg.sender] = 0;
    }

    // VULN 2: unguarded owner change — ETH lock-in vector
    function setOwner(address next) external {
        owner = next;
    }
}
```

- [ ] **Step 3: Write the proving test `fixtures/vault/test/Vault.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract Attacker {
    Vault private immutable vault;
    constructor(Vault v) { vault = v; }
    receive() external payable {
        if (address(vault).balance >= 1 ether) vault.withdraw();
    }
}

contract VaultTest is Test {
    Vault vault;

    function setUp() public { vault = new Vault(); }

    function test_reentrancy_drains_vault() public {
        vault.deposit{value: 1 ether}();
        Attacker attacker = new Attacker(vault);
        payable(address(attacker)).transfer(0);
        // prime the attack: attacker needs a deposit to start the drain
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        vault.deposit{value: 1 ether}();
        vm.prank(address(attacker));
        vault.withdraw();
        assertGt(address(attacker).balance, 1 ether, "reentrancy must drain more than deposited");
    }
}
```

- [ ] **Step 4: Run it — vuln must be proven**

Run: `cd fixtures/vault && forge test -vvv`
Expected: `test_reentrancy_drains_vault` PASS (the exploit works — that IS the proof the fixture is vulnerable).

- [ ] **Step 5: Commit**

```bash
git add fixtures/vault
git commit -m "test: vulnerable Vault fixture with reentrancy proving test"
```

---

### Task 2: Slither runner image + CLI contract

**Files:**
- Create: `packages/agent/analyzer/Dockerfile`
- Create: `packages/agent/analyzer/run.sh`
- Test: `packages/agent/test/analyzer.contract.test.ts` (vitest, `describe.skipIf(!dockerAvailable)`)

**Interfaces:**
- Produces: CLI contract — `docker run rextor/analyzer <repo-path>` exits 0 and prints NDJSON lines: `{"file":string,"line":number,"severity":"critical"|"high"|"medium"|"low","check":string,"description":string}` on stdout; on Slither crash prints a single line `{"status":"incomplete","reason":string}` and exits 3.

- [ ] **Step 1: Write `Dockerfile`** (slim, prune in-layer — Conatus learnings)

```dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir slither-analyzer \
 && pip cache purge
# solc via solc-select; pin one version
RUN pip install --no-cache-dir solc-select \
 && solc-select install 0.8.24 && solc-select use 0.8.24 \
 && pip cache purge
WORKDIR /repo
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
```

- [ ] **Step 2: Write `run.sh`**

```bash
#!/usr/bin/env sh
# Contract: NDJSON findings on stdout; exit 3 + {"status":"incomplete"} on analyzer failure.
set -u
cd /repo
if ! command -v slither >/dev/null 2>&1; then
  echo '{"status":"incomplete","reason":"slither-missing"}'; exit 3
fi
TMP="$(mktemp)"/slither.json || exit 3
if slither . --json "$TMP" 2>"$TMP.err"; then
  python3 - "$TMP" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for d in data.get("results", {}).get("detectors", []):
    sev = {"High": "high", "Medium": "medium", "Low": "low"}.get(d.get("impact"), "low")
    first = d.get("elements", [{}])[0]
    src = first.get("source_mapping", {}) or {}
    print(json.dumps({
        "file": (src.get("filename_relative") or "?").split("/")[-1],
        "line": (src.get("lines") or [0])[0],
        "severity": sev,
        "check": d.get("check", "?"),
        "description": d.get("description", "")[:500],
    }))
PY
  rm -rf "$(dirname "$TMP")"
else
  echo "{\"status\":\"incomplete\",\"reason\":\"slither-error: $(head -c 200 "$TMP.err" | tr '\n' ' ')\"}"
  rm -rf "$(dirname "$TMP")"; exit 3
fi
```

- [ ] **Step 3: Build and run against the fixture**

Run: `docker build -t rextor/analyzer packages/agent/analyzer && docker run --rm -v $(pwd)/fixtures/vault:/repo rextor/analyzer`
Expected: NDJSON lines including a `reentrancy-eth` `high` finding on `Vault.sol`.

- [ ] **Step 4: Contract test `packages/agent/test/analyzer.contract.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const docker = (() => {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

describe.skipIf(!docker)("analyzer container contract", () => {
  it("flags reentrancy in the Vault fixture", () => {
    const out = execFileSync("docker", [
      "run", "--rm", "-v", `${process.cwd()}/fixtures/vault:/repo`, "rextor/analyzer",
    ]).toString();
    const findings = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(findings.some((f) => f.check === "reentrancy-eth" && f.severity === "high")).toBe(true);
  });
  it("emits incomplete (never silent clean) on analyzer failure", () => {
    // repo with no contracts → slither errors → contract requires status:incomplete + exit 3
    const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
    let exited3 = false;
    try {
      execFileSync("docker", ["run", "--rm", "-v", `${tmp}:/repo`, "rextor/analyzer"]);
    } catch (e: any) { exited3 = e.status === 3; }
    expect(exited3).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests, then commit**

Run: `cd packages/agent && pnpm vitest run test/analyzer.contract.test.ts` — Expected: PASS (skipped gracefully when Docker absent).
Commit: `git add packages/agent/analyzer packages/agent/test && git commit -m "feat: slither runner container with NDJSON contract"`

---

### Task 3: agent package scaffold + diff-scope module

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`, `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/diff-scope.ts`
- Test: `packages/agent/test/diff-scope.test.ts`

**Interfaces:**
- Consumes: unified diff text (GitHub PR `.diff` format) + repo file list.
- Produces: `scopeDiff(diff: string): { contractFiles: ScopedFile[]; hasContractChanges: boolean }` where `ScopedFile = { path: string; changedLineRanges: Array<[number, number]>; isContract: boolean }`. `isContract` = path matches `/*.sol`, `/contracts/**`, `/src/**/*.sol`, `programs/**` (Solana) heuristics — exported as `CONTRACT_PATH_RE` for reuse.

- [ ] **Step 1: Scaffold package** (`package.json` with `tsx`, `vitest`, `typescript` devDeps; `tsconfig` strict; empty vitest config).

- [ ] **Step 2: Failing test first**

```typescript
import { describe, it, expect } from "vitest";
import { scopeDiff } from "../src/diff-scope";

const SOL_DIFF = `diff --git a/contracts/Vault.sol b/contracts/Vault.sol
index 111..222 100644
--- a/contracts/Vault.sol
+++ b/contracts/Vault.sol
@@ -10,4 +10,9 @@ contract Vault {
     function deposit() external payable {}
+    function withdraw() external {}
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+world`;

describe("scopeDiff", () => {
  it("scopes to contract files and records added-line ranges", () => {
    const { contractFiles, hasContractChanges } = scopeDiff(SOL_DIFF);
    expect(hasContractChanges).toBe(true);
    expect(contractFiles.map((f) => f.path)).toEqual(["contracts/Vault.sol"]);
    expect(contractFiles[0].changedLineRanges).toEqual([[14, 14]]);
  });
  it("returns hasContractChanges=false for docs-only diffs", () => {
    const { hasContractChanges, contractFiles } = scopeDiff(SOL_DIFF.split("diff --git a/README")[1].prepend ? SOL_DIFF : "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-h\n+w");
    expect(hasContractChanges).toBe(false);
    expect(contractFiles).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL** — `cd packages/agent && pnpm vitest run test/diff-scope.test.ts` → module not found.

- [ ] **Step 4: Implement `src/diff-scope.ts`** — parse `diff --git a/x b/x` headers for paths; count hunk line math (`@@ -a,b +c,d @@` → added lines `c..c+d-1`, tracking `+`-prefixed lines within hunks); classify via `CONTRACT_PATH_RE = /(\.sol$|(^|\/)contracts\/|(^|\/)programs\/)/`.

- [ ] **Step 5: PASS, then commit** — `git commit -m "feat: diff-scope module with contract-path classification"`

---

### Task 4: Findings normalizer + riskScore rubric v0

**Files:**
- Create: `packages/agent/src/findings.ts`
- Test: `packages/agent/test/findings.test.ts`

**Interfaces:**
- Produces: `normalizeFindings(ndjson: string): Finding[]` (parses Task 2's NDJSON; `status:incomplete` lines throw `IncompleteReportError(reason)`), and `score(findings: Finding[]): number` — deterministic rubric v0: `critical 60 · high 25 · medium 10 · low 3`, sum, cap 100.

- [ ] Steps: failing tests first (known vector: two highs + one medium → `min(100, 25+25+10) = 60`), implement, PASS, commit `feat: findings normalizer + rubric v0`.

---

### Task 5: Webhook endpoint + PR comment (happy path, local)

**Files:**
- Create: `packages/agent/src/server.ts` (tsx-run HTTP server), `packages/agent/src/review.ts`

**Interfaces:**
- Consumes: GitHub webhook payload (`pull_request.opened` / `synchronize`), `GITHUB_APP_SECRET`, `GITHUB_TOKEN` from env (the symlinked `.env`).
- Produces: `verifySignature(rawBody: string, sig: string, secret: string): boolean` (HMAC sha256, `sha256=` prefix — tested with a fixed vector); `runReview(prUrl: string): Promise<{ commented: boolean; score: number }>` — clones head ref (shallow), writes `.diff` via API, `scopeDiff` → if contract changes, mount repo into analyzer container → normalize → post one PR comment summary block.

- [ ] Steps: signature test first (fixed HMAC vector), then happy-path test against the fixture repo mounted via `actions/toolkit`-style mocked octokit, implement, PASS, commit `feat: webhook + review happy path`.

---

## Gate B spike (parallel, by Sep 22): Aderyn-Rust on Solana fixture

Standalone spike — NOT in this plan's task list: install Aderyn, run against a vulnerable Anchor fixture (missing-signer-check program in `fixtures/`), record finding quality. Decision recorded in PLAN.md: Solana flagship confirmed, or EVM-first pivot.
