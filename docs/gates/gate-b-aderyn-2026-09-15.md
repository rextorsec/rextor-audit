# Gate B Spike Report — Aderyn × Anchor Fixture

**Date:** 2026-09-15 · **Question:** Does Aderyn (Cyfrin's Rust static analyzer) produce credible findings on a deliberately vulnerable Anchor program, well enough to anchor Rextor Audit's Solana module?
**Verdict up front:** **WEAK_PIVOT_EVM_FIRST** — Aderyn is a Solidity-only analyzer; it produced **zero findings and zero output artifacts** on the Anchor fixture. It is not broken (proven functional on an equivalent Solidity fixture), but it cannot anchor a Solana module.

---

## 1. Install

### Attempt 1 (assignment primary): `cargo install --locked aderyn` — FAILED

crates.io latest is stale at **aderyn 0.1.9** (early-2024, self-described "Rust based Solidity AST analyzer"). Build fails under rustc 1.94.1 — the `svm-rs-builds` build script generates duplicate constants:

```
error[E0428]: the name `SOLC_VERSION_0_8_35` is defined multiple times
   --> .../out/builds.rs:171:1
171 | pub const SOLC_VERSION_0_8_35: semver::Version = semver::Version::new(0,8,35);
    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ `SOLC_VERSION_0_8_35` redefined here
error: could not compile `svm-rs-builds` (lib) due to 4 previous errors
error: failed to compile `aderyn v0.1.9`
```

(4 duplicate-const errors total: `SOLC_VERSION_0_8_31[_CHECKSUM]`, `SOLC_VERSION_0_8_35[_CHECKSUM]`.) Cargo-from-git would bypass the stale crate, but was unnecessary — see attempt 2.

### Attempt 2 (README current method): official installer — SUCCESS

Upstream README (default branch `dev`) no longer recommends cargo; current release is **aderyn-v0.6.8** (2026-01-22). Installed via:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/cyfrin/aderyn/releases/latest/download/aderyn-installer.sh | bash
```

```
downloading aderyn 0.6.8 aarch64-apple-darwin
installing to /Users/rector/.cargo/bin
  aderyn
  aderyn-update
everything's installed!
```

`aderyn --version` → **`aderyn 0.6.8`**. All detection runs below use 0.6.8. (Alternative documented channels: `brew install cyfrin/tap/aderyn`, `npm i @cyfrin/aderyn -g`, `cyfrinup`.)

### Key CLI fact

0.6.8 has **no `detect` subcommand**. Usage is `aderyn [OPTIONS] [ROOT]` — detection is the default run; `ROOT` is documented as "**Solidity project root directory**". Subcommands: `init`, `mcp`, `registry`, `docs`, `completions`.

## 2. Fixture

`fixtures/solana-vault/` — minimal Anchor-style program (static-analysis target only; no `anchor build`, no lockfile):

- `Cargo.toml`: `anchor-lang = "0.31.1"` dep only.
- `src/lib.rs`: `withdraw(ctx: Context<Withdraw>, amount)` moves lamports with **no authority/signer check** (vuln a); `set_owner(ctx: Context<SetOwner>, new_owner)` writes `vault.owner` with **no signer constraint** (vuln b). `SetOwner` struct has no authority account at all; `Withdraw` has no `Signer<'info>`.

## 3. Runs against the Anchor fixture (verbatim, exact exit codes)

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `aderyn fixtures/solana-vault/ -o /tmp/aderyn_gateb_report1.md` | 1 | Error, no report written |
| 2 | `aderyn fixtures/solana-vault/src/ -o /tmp/aderyn_gateb_report2.md` | 1 | Error, no report written |
| 3 | `aderyn fixtures/solana-vault/ -i src/lib.rs -o /tmp/aderyn_gateb_report3.md` | 1 | Error, no report written |
| 4 | `aderyn fixtures/solana-vault/ -o /tmp/aderyn_gateb_report4.json` | 1 | Error, no JSON written |

Verbatim stderr/stdout of run 1 (identical for all runs except auto-exclude list in run 2):

```
---------------------------------------------------------------------------------
# Configuration
---------------------------------------------------------------------------------
Root - /Users/rector/local-dev/rextorsec/rextor-audit/fixtures/solana-vault
Source - /Users/rector/local-dev/rextorsec/rextor-audit/fixtures/solana-vault/src
Remappings - []
EVM version - prague
---------------------------------------------------------------------------------
# Compiling Abstract Syntax Trees
---------------------------------------------------------------------------------
---------------------------------------------------------------------------------
# Scanning Contracts
---------------------------------------------------------------------------------
No solidity files found in given scope!
Error making context: No solidity files found in given scope!
```

**Aderyn never attempts to parse Rust.** `aderyn --help` lists **no language/domain flag** either — there is no option to point the toolchain at anything but Solidity (negative result, checked during the spike). Even a forced `-i src/lib.rs` include changes nothing — the toolchain (`solidity-ast-rs` + `foundry-compilers`, i.e. solc AST) has no Rust frontend. Post-run: zero files matching `/tmp/aderyn_gateb_report*` exist.

## 4. Fairness sanity check — same binary, same bug pattern, Solidity

To separate "broken install" from "wrong domain", ran 0.6.8 on `/tmp/aderyn_sol_test` — a 13-nSLOC `Vault.sol` mirroring the fixture (unguarded `withdraw`, unguarded `setOwner`). **Exit 0, full markdown + JSON reports.** Findings:

- **H-1 `eth-send-unchecked-address`** — "ETH transferred without address checks" → `withdraw` line 11. (Auth-adjacent true positive for vuln a.)
- **L-3 unchecked address state write** — `owner = newOwner` line 18; **L-2 state change without event** ×2 (both functions). (Partially covers vuln b, as hygiene findings, not auth-failure findings.)
- Noise: L-1 PUSH0, L-5 unspecific pragma, L-4 unsafe low-level `transfer` — 3 low-value findings. **1 high + 5 low on 13 nSLOC: acceptable Slither-grade signal/noise.**

So the *detectors that conceptually match* exist — but they key off EVM AST patterns (`msg.sender`, `payable(...).transfer`). The Anchor equivalents (`Signer<'info>`, `#[account(constraint = vault.owner == authority)]`, `has_one`) live in Anchor's `#[derive(Accounts)]` macro expansion and are structurally invisible to a solc-AST analyzer.

_Caveat: no CLEAN-fixture false-positive measurement was taken (both fixtures are deliberately vulnerable) — the acceptable-signal/noise judgment rests on a single vulnerable 13-nSLOC micro-fixture._

Corroboration: `aderyn registry` (full detector list) — **0** matches for solana/anchor; GitHub code search "anchor" in Cyfrin/aderyn — no hits; third-party catalog (counterscarp.io) lists Aderyn as **EVM-only** and sells Solana/Anchor analysis as a separate proprietary product.

## 5. Output format / JSON parseability (on working input)

Aderyn emits a **single structured JSON document** (not NDJSON): top-level keys `detectors_used, files_details, files_summary, high_issues, low_issues, issue_count`; finding shape:

```json
{"title": "...", "description": "...", "detector_name": "eth-send-unchecked-address",
 "instances": [{"contract_path": "src/Vault.sol", "line_no": 11, "src": "237:8", "src_char": "235:8"}]}
```

Machine-parseable: **yes**. One jq flatten (`.high_issues.issues[] + .low_issues.issues[]` → per-finding records) yields Rextor's NDJSON finding stream; `.sarif` output is also supported. Formats: `*.md`, `*.json`, `*.sarif` via `-o`.

## 6. Credibility assessment

| Criterion | Result |
|---|---|
| Runs at all on Anchor source? | **No** — exit 1, "No solidity files found", no artifact, on every invocation |
| Flags missing-signer/missing-constraint? | **No** (zero output). On the Solidity twin: H-1 + L-3 partially cover it |
| Noise level | Unmeasurable on Solana; ~3/6 low-value on Solidity (acceptable) |
| JSON output | Single JSON doc (not NDJSON) + SARIF; trivially convertible |
| Install health | Official 0.6.8 binary: clean. crates.io `cargo install`: broken (stale 0.1.9, won't compile) |

**Recommendation: `WEAK_PIVOT_EVM_FIRST`.** Aderyn contributes nothing to the Solana module — not because it is defective, but because it is domain-mismatched by design (Solidity/solc-AST only). It is simultaneously a *credible EVM anchor*: on the twin fixture it caught the unchecked-send high and near-caught the unguarded owner write, with manageable noise and clean JSON. That combination — functional and parseable on EVM, with auth-detection unproven beyond one micro-fixture, and null on Solana — is precisely the weak-pivot signature: anchor Rextor's static-analyzer leg on Aderyn **for EVM**, and treat Solana finding-generation as manual/custom (candidates for a future Gate B′: Anchor IDL constraint validation, custom semgrep Anchor rules over `#[derive(Accounts)]` structs, or a Solana-specific analyzer — none Cyfrin-owned). It is **not** `SOLANA_FLAGSHIP_CREDIBLE` (zero Solana coverage) and **not** `BROKEN` (tool installs and runs flawlessly on its intended input; the cargo failure is a stale-crate packaging issue with a documented official alternative).

## Appendix — environment

- cargo 1.94.1 / rustc 1.94.1, macOS darwin 25.6.0 arm64
- `aderyn --version` → `aderyn 0.6.8` (binary from `aderyn-installer.sh`, release aderyn-v0.6.8, 2026-01-22)
- Fixture committed nowhere; report + `fixtures/solana-vault/{Cargo.toml,src/lib.rs}` are the only repo writes. Sanity fixture lives in `/tmp/aderyn_sol_test/`.
