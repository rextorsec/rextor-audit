// SPEC-6 §4 — install page tests. The page is a static server component:
// no props, no fetch, no dynamic content — every assertion pins copy from
// the approved mock verbatim (real historical artifacts, never invented).
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InstallPage from "@/app/install/page";

const REXTOR_YAML = `# paths audited on every PR (globs, relative to repo root)
include:
  - "contracts/**/*.sol"
exclude:
  - "test/**"
  - "node_modules/**"
# the check run fails when a finding at or above this severity is present
severity_gate: high`;

function step(n: number) {
  return screen.getByRole("region", { name: new RegExp(`^Step ${n} — `) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("install page — document structure (approved mock)", () => {
  it("renders the kicker, headline, lede, and four steps in order", () => {
    render(<InstallPage />);

    expect(screen.getByText("Setup guide")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "From zero to an attested review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Four steps\. No YAML ceremony required — the agent works out of the box, and every choice it makes is documented below\./,
      ),
    ).toBeInTheDocument();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Install the GitHub App",
      "Optionally add rextor.yaml",
      "Open a pull request",
      "What arrives on the PR",
    ]);
  });

  it("carries the N1a nav and Ft1 footer per the mock", () => {
    render(<InstallPage />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Docs" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toMatch(/whitespace-nowrap/);
    }

    expect(
      screen.getByText("Audits are point‑in‑time. Code is continuous."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rextor Security" })).toHaveAttribute(
      "href",
      "https://rextorsecurity.com",
    );
  });
});

describe("install page — step 1: real permissions list", () => {
  it("lists the live App permissions and event filter verbatim", () => {
    render(<InstallPage />);

    const items = within(step(1))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Pull requests: read & write — posts the review comment and the check run on each PR.",
      "Contents: read‑only — clones the PR head to run analyzers and fork simulations.",
      "Events: pull_request only — the app ignores everything else.",
    ]);
    expect(
      within(step(1)).getByText(/installs per‑repository\. Your source never leaves the review pipeline/),
    ).toBeInTheDocument();
  });
});

describe("install page — step 2: static rextor.yaml snippet", () => {
  it("renders the exact YAML copy in a typographic frame with the shipping annotation", () => {
    render(<InstallPage />);

    const section = step(2);
    expect(within(section).getByText("shipping Oct 2026")).toBeInTheDocument();
    expect(within(section).getByText(/rextor\.yaml — copy‑paste/)).toBeInTheDocument();

    const pre = within(section).getByText((_, element) => element?.tagName === "PRE");
    expect(pre.textContent).toBe(REXTOR_YAML);
  });

  it("is static — renders with no props and never touches fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<InstallPage />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("install page — step 4: comment-anatomy facsimile (real artifacts)", () => {
  it("mirrors the real banner, findings table, and attestation footer", () => {
    render(<InstallPage />);

    const anatomy = screen.getByRole("region", { name: "Comment anatomy" });
    expect(
      within(anatomy).getByText(/rextor‑audit\[bot\] · riskScore/),
    ).toBeInTheDocument();
    expect(within(anatomy).getByText("41 / 100")).toBeInTheDocument();
    expect(
      within(anatomy).getByText(/1 reclassification, 0 additions/),
    ).toBeInTheDocument();

    // Findings table — real rows from the test-repo comment.
    for (const cell of ["Vault.sol:L41‑44", "Vault.sol:L19‑23"]) {
      expect(within(anatomy).getByText(cell)).toBeInTheDocument();
    }
    expect(within(anatomy).getByText(/ETH lock‑in via unguarded/)).toBeInTheDocument();
    expect(within(anatomy).getByText("setOwner")).toBeInTheDocument();
    expect(
      within(anatomy).getByText(/unchecked send before state finalization/),
    ).toBeInTheDocument();

    // Attestation footer — the real receipt link and recipe lines.
    expect(within(anatomy).getByText(/attested on Tempo testnet \(42431\)/)).toBeInTheDocument();
    const receipt = within(anatomy).getByRole("link", { name: "0x6456…9e20 ↗" });
    expect(receipt).toHaveAttribute("href", "https://explore.testnet.tempo.xyz/tx/0x64569102970c3c841ce2d656438fbbb1373feb9305bc5aaeab41cd3275db9e20");
    expect(
      within(anatomy).getByText(/reviewId = keccak256\("rextor\/review\/v1\|owner\/repo\|2\|<headSha>"\)/),
    ).toBeInTheDocument();
    expect(
      within(anatomy).getByText(
        /findingsHash = sha256 of the exact findings JSON in this comment — recompute it and call verify\(\)/,
      ),
    ).toBeInTheDocument();
  });
});
