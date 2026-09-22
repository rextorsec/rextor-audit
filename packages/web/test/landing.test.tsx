// Landing v2 tests — Linear-studied DNA retheme (mockups/landing-v2 approved
// 2026-09-22). The chain-read seam is module-mocked per the dashboard pattern:
// no viem client, no RPC, no live network.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LandingPage from "@/app/page";
import { readAgentIdentity } from "@/lib/chain-read";
import type { AgentIdentity } from "@/lib/chain-read";

vi.mock("@/lib/chain-read", () => ({
  readAgentIdentity: vi.fn(async () => null),
}));

const identityMock = vi.mocked(readAgentIdentity);

const TEMPO_ID: AgentIdentity = { name: "rextor-audit[bot]", active: true, reviewCount: 7 };
const HYPE_ID: AgentIdentity = { name: "rextor-audit[bot]", active: true, reviewCount: 2 };

async function renderPage() {
  const ui = await LandingPage();
  return render(ui);
}

describe("LandingPage", () => {
  beforeEach(() => {
    // Factory default (resolves null) — per-test implementations never leak.
    identityMock.mockReset();
  });

  it("renders the hero with the positioning copy, current contracts, and honest fallback facts", async () => {
    identityMock.mockResolvedValue(null);
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /Audits are point‑in‑time/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/audits money changes/)).toBeInTheDocument();
    expect(screen.getAllByText(/chainId 42431/).length).toBeGreaterThan(0);
    // Contract v2, deploy #3 (0x51ac… — deploy #2 at 0x7fe6 is retired);
    // HyperEVM mainnet fact.
    expect(screen.getByText(/Attestation v2 · deploy #3 · 0x51ac…495a/)).toBeInTheDocument();
    expect(screen.getByText(/HyperEVM mainnet · 999 · 0x8f63…850c/)).toBeInTheDocument();
    expect(screen.getByText(/rextor-audit\[bot\] · active/)).toBeInTheDocument();
    // RPC outage → last-verified counts (5 on-chain as of 2026-09-22).
    expect(screen.getByText(/Attested reviews · 5/)).toBeInTheDocument();
  });

  it("sums live review counts from the chain reads", async () => {
    identityMock.mockImplementation(async (key: string) =>
      key === "tempo" ? TEMPO_ID : HYPE_ID,
    );
    await renderPage();
    expect(screen.getByText(/Attested reviews · 9/)).toBeInTheDocument();
  });

  it("renders the plain-words strip — three dual-register steps", async () => {
    await renderPage();
    expect(document.getElementById("plain")).toBeInTheDocument();
    expect(screen.getByText("Step 01")).toBeInTheDocument();
    expect(screen.getByText("Step 02")).toBeInTheDocument();
    expect(screen.getByText("Step 03")).toBeInTheDocument();
    expect(screen.getByText(/machines find, citations prove, forks test/)).toBeInTheDocument();
    expect(screen.getByText(/diff-scoped · Slither · Foundry fork-sim/)).toBeInTheDocument();
  });

  it("renders the five-stage tour with honest artifact frames", async () => {
    await renderPage();
    const tour = document.getElementById("tour")!;
    expect(tour).toHaveAttribute("aria-label", "How a review runs");
    for (const stage of [
      "Scope the diff",
      "Detect deterministically",
      "Triage with citations",
      "Prove by execution",
      "Anchor the verdict",
    ]) {
      expect(screen.getByRole("heading", { name: stage })).toBeInTheDocument();
    }
    expect(screen.getByText(/Slither 0\.11\.6, Docker/)).toBeInTheDocument();
    expect(screen.getByText(/critical 60 · high 25 · medium 10 · low 3/)).toBeInTheDocument();
    // Stage 5 anchors BOTH live chains.
    const hyperLink = screen.getByRole("link", { name: "HyperEVM 999 ↗" });
    expect(hyperLink).toHaveAttribute(
      "href",
      "https://hyperevmscan.io/address/0x8f63c0581ab3b2836c95f97fcf104d2dd962850c",
    );
  });

  it("renders matrix, tracks, can't-do integrity, FAQ, final CTA, statement footer", async () => {
    await renderPage();
    expect(document.getElementById("matrix")).toBeInTheDocument();
    expect(document.getElementById("tracks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /What Rextor can't do/ })).toBeInTheDocument();
    expect(screen.getByText(/It can't invent findings\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Questions, answered straight/ })).toBeInTheDocument();
    expect(screen.getByText("What does it cost?")).toBeInTheDocument();
    expect(screen.getByText("Does this replace my auditor?")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Install once. Every PR after that is an audit event." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rextor Security/)).toBeInTheDocument();
    // Ft5 statement closes with the brand refrain — h1 carries it too (its
    // textContent fuses the <br>-split spans, so match the sentence start).
    expect(screen.getAllByText(/Audits are point‑in‑time/)).toHaveLength(2);
    expect(screen.getByText(/Audits are point‑in‑time\. Code is continuous\./)).toBeInTheDocument();
  });

  it("keeps nav affordances single-line-safe", async () => {
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("carries the 56.25rem/60rem collapses as responsive utilities", async () => {
    await renderPage();
    // Nav centre links hidden below 56.25rem; hero grid single-column below 60rem.
    const navLinks = document.querySelector("nav div.justify-self-center")!;
    expect(navLinks.className).toMatch(/hidden/);
    expect(navLinks.className).toMatch(/min-\[56\.25rem\]:flex/);
    const heroGrid = document.querySelector("header .grid")!;
    expect(heroGrid.className).toMatch(/min-\[60rem\]:grid-cols/);
  });
});
