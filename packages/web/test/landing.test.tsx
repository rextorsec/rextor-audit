import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "@/app/page";

describe("LandingPage", () => {
  it("renders the hero with the approved positioning copy and live facts", () => {
    render(<LandingPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Audits are point‑in‑time/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/audits money changes/)).toBeInTheDocument();
    expect(screen.getAllByText(/chainId 42431/).length).toBeGreaterThan(0);
    expect(screen.getByText(/rextor-audit\[bot\] · active/)).toBeInTheDocument();
  });

  it("renders the five-stage tour with honest artifact frames", () => {
    render(<LandingPage />);
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
    expect(screen.getByText(/Slither 0\.11\.6 \+ Aderyn/)).toBeInTheDocument();
    expect(screen.getByText(/critical 60 · high 25 · medium 10 · low 3/)).toBeInTheDocument();
  });

  it("renders the capability matrix, track board, integrity rails, final CTA, footer", () => {
    render(<LandingPage />);
    expect(document.getElementById("matrix")).toBeInTheDocument();
    expect(document.getElementById("tracks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The integrity rails" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Install once. Every PR after that is an audit event." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rextor Security/)).toBeInTheDocument();
    expect(screen.getByText(/Audits are point‑in‑time\. Code is continuous\./)).toBeInTheDocument();
  });

  it("keeps nav affordances single-line-safe", () => {
    render(<LandingPage />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("carries the 40rem/60rem collapses as responsive utilities", () => {
    render(<LandingPage />);
    // Nav links hidden below 40rem; hero grid single-column below 60rem.
    const navLinks = document.querySelector("nav")!.querySelector("div");
    expect(navLinks!.className).toMatch(/hidden/);
    expect(navLinks!.className).toMatch(/sm:flex/);
    const heroGrid = document.querySelector("header")!.firstElementChild!;
    expect(heroGrid.className).toMatch(/min-\[60rem\]:grid-cols/);
  });
});