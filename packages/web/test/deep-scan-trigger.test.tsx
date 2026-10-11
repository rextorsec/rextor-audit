// DeepScanTrigger — client island lifecycle: flag-off renders inert (never
// fetches), invalid repo is rejected BEFORE the network, loading is honestly
// indeterminate (no fake percent), 409/429/400/504/network banners, success
// renders the report. global fetch is a stub; no live network, ever.
import { fireEvent, render, screen, within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepScanTrigger } from "@/components/deep-scan-trigger";
import type { ScanReport } from "@/lib/scans";

const REPORT: ScanReport = {
  repo: "rextorsec/rextor-audit-test",
  ref: "main",
  head_sha: "ce7f6a9d2b42abcd599537e4abffa33d8760496c",
  status: 0,
  risk_score: 34,
  finding_count: 4,
  findings: [
    {
      file: "src/Vault.sol",
      line: 87,
      severity: "high",
      check: "reentrancy-eth",
      description: "External call sends ETH before the balance state flip.",
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function submitForm(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (!form) throw new Error("trigger form not rendered");
  fireEvent.submit(form);
}

function renderEnabled(): RenderResult {
  return render(<DeepScanTrigger enabled={true} />);
}

/** Renders the panel, fills repo (and optional ref), submits the form. Scoped
 *  queries go through the returned RenderResult — renders accumulate within a
 *  test, so screen-level queries would hit sibling instances. */
async function typeRepoAndSubmit(repo: string, ref?: string): Promise<RenderResult> {
  const result = renderEnabled();
  fireEvent.change(within(result.container).getByLabelText("repo"), { target: { value: repo } });
  if (ref !== undefined) {
    fireEvent.change(within(result.container).getByLabelText("ref · optional"), {
      target: { value: ref },
    });
  }
  submitForm(result.container);
  return result;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepScanTrigger — disabled deployment", () => {
  it("renders honestly disabled: button off, one-line notice, never fetches", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<DeepScanTrigger enabled={false} />);

    expect(screen.getByRole("button", { name: "Run Deep Scan" })).toBeDisabled();
    expect(
      screen.getByText("Deep Scan trigger is disabled on this deployment."),
    ).toBeInTheDocument();

    submitForm(container);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DeepScanTrigger — client-side validation", () => {
  it("rejects an invalid repo inline BEFORE any network call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderEnabled();

    fireEvent.change(screen.getByLabelText("repo"), { target: { value: "vault core!" } });
    submitForm(container);

    expect(
      screen.getByText("invalid repo — expected owner/name · allowed [A-Za-z0-9_.-]"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("repo")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the charset hint in the resting state and clears the error once fixed", () => {
    const { container } = renderEnabled();

    expect(screen.getByText("owner/name · charset [A-Za-z0-9_.-]")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("repo"), { target: { value: "vault core!" } });
    submitForm(container);
    expect(screen.queryByText("owner/name · charset [A-Za-z0-9_.-]")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("repo"), { target: { value: "owner/repo" } });
    expect(screen.queryByText(/invalid repo/)).not.toBeInTheDocument();
    expect(screen.getByText("owner/name · charset [A-Za-z0-9_.-]")).toBeInTheDocument();
  });
});

describe("DeepScanTrigger — request shape", () => {
  it("sends {repo, ref} for a pinned ref and {repo} alone when ref is blank", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, REPORT));
    vi.stubGlobal("fetch", fetchMock);

    const pinned = await typeRepoAndSubmit("owner/repo", " develop ");
    await within(pinned.container).findByText("status 0 · complete");
    expect(
      JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual({ repo: "owner/repo", ref: "develop" });

    const blank = await typeRepoAndSubmit("owner/repo");
    await within(blank.container).findByText("status 0 · complete");
    expect(
      JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual({ repo: "owner/repo" });
  });
});

describe("DeepScanTrigger — loading honesty", () => {
  it("shows indeterminate minutes copy, disables the button, never fakes a percent", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderEnabled();

    fireEvent.change(screen.getByLabelText("repo"), { target: { value: "owner/repo" } });
    submitForm(container);

    const busyButton = screen.getByRole("button", { name: /scanning whole repo — this takes minutes/ });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("progressbar", { name: "Scan progress — indeterminate" }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%/);
  });
});

describe("DeepScanTrigger — honest banners", () => {
  it("renders the 409 single-flight banner verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(409, { error: "scan already in progress" })));

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("scan already in progress")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "HTTP 409 — wait for the running scan, or check the ledger for its row when it settles",
      ),
    ).toBeInTheDocument();
  });

  it("renders the 429 rate-limit banner with the Retry-After hint when the route sends it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "too many scans from your address — try again later" }),
            {
              status: 429,
              headers: { "Content-Type": "application/json", "Retry-After": "3599" },
            },
          ),
      ),
    );

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("HTTP 429")).toBeInTheDocument();
    expect(
      await screen.findByText("too many scans from your address — try again later — retry after 3599s"),
    ).toBeInTheDocument();
    // Rate limiting is a refusal, not a run: no receipt line may appear.
    expect(screen.queryByText("status 0 · complete")).not.toBeInTheDocument();
  });

  it("renders the bare 429 copy when no Retry-After header is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(429, { error: "too many scans from your address — try again later" })),
    );

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("HTTP 429")).toBeInTheDocument();
    expect(
      await screen.findByText("too many scans from your address — try again later"),
    ).toBeInTheDocument();
  });

  it("passes the service's 400 message through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "unsafe ref — not a valid git ref" })),
    );

    await typeRepoAndSubmit("owner/repo", "HEAD~..");

    expect(await screen.findByText("HTTP 400")).toBeInTheDocument();
    expect(await screen.findByText("unsafe ref — not a valid git ref")).toBeInTheDocument();
  });

  it("passes the 504 still-running message through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(504, { error: "scan still running server-side — check the scans ledger" }),
      ),
    );

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("HTTP 504")).toBeInTheDocument();
    expect(
      await screen.findByText("scan still running server-side — check the scans ledger"),
    ).toBeInTheDocument();
  });

  it("renders an honest banner when the network itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("network error")).toBeInTheDocument();
    expect(
      await screen.findByText("could not reach the scan trigger — check the connection and retry"),
    ).toBeInTheDocument();
  });
});

describe("DeepScanTrigger — success", () => {
  it("renders the receipt banner and the full report, returning the panel to idle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, REPORT)));

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText(/status 0 · risk 34 \/ 100 · 4 findings · head ce7f6a9/)).toBeInTheDocument();
    expect(await screen.findByText("status 0 · complete")).toBeInTheDocument();
    // The receipt line legitimately composes nested spans (the repo is
    // emphasized inside the muted context line), so match the composed
    // element text rather than any single element's own text.
    expect(
      screen.getByText(
        (_, el) => el?.textContent === "rextorsec/rextor-audit-test · main @ ce7f6a9",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("External call sends ETH before the balance state flip."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Deep Scan" })).toBeEnabled();
  });

  it("degrades a malformed 200 body to an honest banner instead of a crashed panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { repo: 42 })));

    await typeRepoAndSubmit("owner/repo");

    expect(await screen.findByText("unexpected response")).toBeInTheDocument();
    expect(screen.queryByText("status 0 · complete")).not.toBeInTheDocument();
  });
});
