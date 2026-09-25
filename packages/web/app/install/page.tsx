// SPEC-6 §4 — install flow, verbatim from the approved mock (Long Document
// macro · N1a nav · Ft1 footer — this page keeps its own nav/footer per the
// mock, distinct from the landing). Static server component: no props, no
// fetch, no dynamic content. Every value is a real historical artifact (tx
// 0x6456…9e20 — the live v2 smoke attestation, score 41 matches the banner —
// per docs/deployments/tempo.md deploy #2); the rextor.yaml config is
// unshipped and carries the "shipping Oct 2026" annotation — the page never
// claims a gate that does not exist yet.
import type { Metadata } from "next";

import { Wordmark } from "@/components/nav";

export const metadata: Metadata = {
  title: "Install — Rextor Audit",
};

// Nonce-CSP requires per-request rendering (see app/page.tsx) — the
// middleware's fresh nonce must stamp every inline script in the served
// HTML, which build-time prerendering cannot do.
export const dynamic = "force-dynamic";

const REXTOR_YAML = `# paths audited on every PR (globs, relative to repo root)
include:
  - "contracts/**/*.sol"
exclude:
  - "test/**"
  - "node_modules/**"
# the check run fails when a finding at or above this severity is present
severity_gate: high`;

const docLink =
  "font-mono text-xs no-underline whitespace-nowrap text-muted-foreground hover:text-foreground";

export default function InstallPage() {
  return (
    <>
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-[46rem] items-center justify-between py-6"
      >
        <Wordmark />
        <div className="flex gap-6">
          <a className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground" href="#">
            Docs
          </a>
          <a className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground" href="#">
            Dashboard
          </a>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-[46rem] pt-10 pb-16">
        <p className="mb-4 font-mono text-xs tracking-[0.14em] uppercase text-label">Setup guide</p>
        <h1 className="mb-6 text-2xl leading-[1.1] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
          From zero to an attested review
        </h1>
        <p className="mb-16 max-w-[58ch] text-muted-foreground">
          Four steps. No YAML ceremony required — the agent works out of the box, and every choice
          it makes is documented below.
        </p>

        <section aria-label="Step 1 — Install the GitHub App" className="border-t border-border py-16">
          <p className="mb-3 font-mono text-sm tracking-[0.14em] text-label">1</p>
          <h2 className="mb-4 text-lg font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">
            Install the GitHub App
          </h2>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            Grant exactly what the review needs — <strong className="font-medium text-foreground">nothing more</strong>:
          </p>
          <ul className="mb-4 ml-6 max-w-[60ch] text-muted-foreground">
            <li className="mb-1">
              <strong className="font-medium text-foreground">Pull requests: read &amp; write</strong> —
              posts the review comment and the check run on each PR.
            </li>
            <li className="mb-1">
              <strong className="font-medium text-foreground">Contents: read‑only</strong> — clones the
              PR head to run analyzers and fork simulations.
            </li>
            <li className="mb-1">
              <strong className="font-medium text-foreground">
                Events: <code className="font-mono text-[0.9em] text-foreground">pull_request</code> only</strong> —
              the app ignores everything else.
            </li>
          </ul>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            The app installs per‑repository. Your source never leaves the review pipeline; the only
            artifacts it publishes are the PR comment and the on‑chain attestation.
          </p>
        </section>

        <section
          aria-label="Step 2 — Optionally add rextor.yaml"
          className="border-t border-border py-16"
        >
          <p className="mb-3 font-mono text-sm tracking-[0.14em] text-label">2</p>
          <h2 className="mb-4 text-lg font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">
            Optionally add <code className="font-mono text-[0.9em] text-foreground">rextor.yaml</code>
          </h2>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            The agent audits every PR against its default profile. A config file tunes scope and
            thresholds per repo{" "}
            <span className="ml-2 inline-block rounded-full border border-border px-2 font-mono text-xs whitespace-nowrap text-label">
              shipping Oct 2026
            </span>
            :
          </p>
          <div className="my-6 border-t border-b border-border py-4">
            <p className="mb-3 font-mono text-xs tracking-[0.12em] uppercase text-subtle-foreground">
              rextor.yaml — copy‑paste
            </p>
            <pre className="min-w-0 font-mono text-sm leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]">
              {REXTOR_YAML}
            </pre>
          </div>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            Without a config, the defaults above apply — Solidity sources audited, tests excluded,
            no merge gate.
          </p>
        </section>

        <section
          aria-label="Step 3 — Open a pull request"
          className="border-t border-border py-16"
        >
          <p className="mb-3 font-mono text-sm tracking-[0.14em] text-label">3</p>
          <h2 className="mb-4 text-lg font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">
            Open a pull request
          </h2>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            Any PR that touches the audited paths triggers a review: the diff is scoped to changed
            functions and callsites, deterministic analyzers run sandboxed, the LLM triages with
            citations, and criticals are reproduced on a fork before anything is reported.
          </p>
        </section>

        <section
          aria-label="Step 4 — What arrives on the PR"
          className="border-t border-border py-16"
        >
          <p className="mb-3 font-mono text-sm tracking-[0.14em] text-label">4</p>
          <h2 className="mb-4 text-lg font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">
            What arrives on the PR
          </h2>
          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            A review comment with the verdict — and an attestation footer pointing at the on‑chain
            record. The anatomy below mirrors a{" "}
            <strong className="font-medium text-foreground">real comment</strong> from our test
            repository:
          </p>

          <div
            aria-label="Comment anatomy"
            role="region"
            className="my-6 rounded-lg border border-border p-6"
          >
            <p className="mb-4 border-b border-border py-3 font-mono text-sm tabular-nums">
              rextor‑audit[bot] · riskScore <strong className="font-bold text-warning">41 / 100</strong> · 1
              reclassification, 0 additions
            </p>
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border-b border-border pt-1 pr-4 pb-1 text-left font-mono text-xs font-normal tracking-[0.1em] uppercase text-subtle-foreground"
                  >
                    Severity
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border pt-1 pr-4 pb-1 text-left font-mono text-xs font-normal tracking-[0.1em] uppercase text-subtle-foreground"
                  >
                    Finding
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border pt-1 pr-4 pb-1 text-left font-mono text-xs font-normal tracking-[0.1em] uppercase text-subtle-foreground"
                  >
                    Location
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top">medium</td>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top">
                    ETH lock‑in via unguarded{" "}
                    <code className="font-mono text-[0.9em] text-foreground">setOwner</code> — added by
                    triage, cited lines
                  </td>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top font-mono text-xs whitespace-nowrap text-muted-foreground">
                    Vault.sol:L41‑44
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top">high</td>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top">
                    unchecked send before state finalization — reclassified high→critical, reverted to
                    high on PoC
                  </td>
                  <td className="border-b border-border pt-1 pr-4 pb-1 align-top font-mono text-xs whitespace-nowrap text-muted-foreground">
                    Vault.sol:L19‑23
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 font-mono text-xs leading-[1.8] text-muted-foreground [overflow-wrap:anywhere]">
              attested on Tempo testnet (42431) · tx{" "}
              <a
                className="text-primary no-underline whitespace-nowrap hover:underline hover:underline-offset-[3px]"
                href="https://explore.testnet.tempo.xyz/tx/0x64569102970c3c841ce2d656438fbbb1373feb9305bc5aaeab41cd3275db9e20"
              >
                0x6456…9e20 ↗
              </a>
              <br />
              reviewId = keccak256("rextor/review/v1|owner/repo|2|&lt;headSha&gt;")
              <br />
              findingsHash = sha256 of the exact findings JSON in this comment — recompute it and call
              verify()
            </p>
          </div>

          <p className="mb-4 max-w-[60ch] text-muted-foreground">
            The check run reports the same verdict, so branch protection can consume it. Every number
            in the comment is{" "}
            <strong className="font-medium text-foreground">
              recomputable from the findings JSON alone
            </strong>{" "}
            — the rubric is published, the hash is on‑chain, and the PR comment carries the exact
            recipe.
          </p>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-[46rem] border-t border-border pt-16 pb-6">
        <Wordmark size="md" className="tracking-[0.08em]" />
        <p className="mt-1 text-sm text-muted-foreground">
          Audits are point‑in‑time. Code is continuous.
        </p>
        <div className="mt-4 flex flex-wrap gap-6">
          <a className={docLink} href="#">
            Docs
          </a>
          <a className={docLink} href="#">
            Dashboard
          </a>
          {/* Firm link reduced to plain text — rextorsecurity.com does not
              resolve (2026-09-22). Relink when DNS goes live. */}
          <span className={docLink}>Rextor Security</span>
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">© 2026</span>
        </div>
      </footer>
    </>
  );
}
