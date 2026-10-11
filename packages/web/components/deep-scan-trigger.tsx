"use client";

// SPEC-6 §3 — Deep Scan trigger panel (approved mockups/deep-scan/index.html).
// Client island: owns only the submit lifecycle (idle → submitting → report /
// honest error). The SERVER decides whether the trigger exists at all —
// `enabled` arrives as a prop from the server page, which reads
// REXTOR_SCAN_TRIGGER_ENABLED; this module performs no env reads and talks
// only to our own /api/scan proxy, so no service URL or token is ever in the
// client bundle (invariants 18/19). Zero-meaningful loading: the affordance
// is indeterminate by design — no fake percent; the run reports when it's
// done. Banner copy mirrors the mock verbatim (409), states the route's own
// rate-limit verdict (429, + Retry-After hint), or passes the service's own
// message through (400/504/…).
import { useEffect, useId, useState, type FormEvent } from "react";
import { ScanReportView } from "@/components/scan-report";
import { Button } from "@/components/ui/button";
import type { ScanReport } from "@/lib/scans";

// Client mirror of the service's repo validation (owner/name over
// [A-Za-z0-9_.-]) — used ONLY to reject before the network call; the service
// stays authoritative and its 400 passes through.
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPO_ERROR = "invalid repo — expected owner/name · allowed [A-Za-z0-9_.-]";

// Indeterminate affordances only (transform/opacity, mock keyframes verbatim,
// scoped names so they never collide with Tailwind's built-ins). The global
// prefers-reduced-motion kill switch in tokens.css pins these too. The
// stylesheet is injected into document.head — never the body: the "%"-bearing
// keyframe offsets must stay out of the page's text content (zero-meaningful
// loading), so the panel renders no <style> element. Injected once per
// document and left in place — inert, scoped declarations with the same
// semantics as a static global stylesheet, safe across repeated mounts.
const INDETERMINATE_KEYFRAMES =
  "@keyframes rx-indslide{from{transform:translateX(-110%)}to{transform:translateX(440%)}}" +
  "@keyframes rx-pulse{0%,100%{opacity:.25}50%{opacity:1}}";
const INDETERMINATE_STYLE_ID = "rx-indeterminate-keyframes";

/** Honest error banner content: a heading (mock strong slot) + detail. */
type SubmitError = { heading: string; detail: string };

// Fallback detail when the service/route answered without a usable JSON body.
const FALLBACK_DETAIL: Record<number, string> = {
  400: "invalid scan request — fix the input and retry",
  401: "scan service rejected the trigger — deployment credentials are misconfigured",
  403: "scan service rejected the trigger — deployment credentials are misconfigured",
  413: "scan request too large",
  500: "scan service failed — no verdict was produced for this run",
  502: "scan service unreachable",
  503: "scan trigger is disabled on this deployment",
  504: "scan still running server-side — check the scans ledger",
};

/** Trust-boundary shape check before render: the proxy passes the service
 *  body through verbatim, so the client validates the fields ScanReportView
 *  indexes unguarded. One malformed report degrades to an honest banner, not
 *  a crashed panel. (Same discipline as lib/reviews.ts row validation.) */
function isScanReportShape(v: unknown): v is ScanReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (
    typeof r.repo !== "string" ||
    typeof r.ref !== "string" ||
    typeof r.head_sha !== "string" ||
    (r.status !== 0 && r.status !== 1) ||
    (r.risk_score !== null && typeof r.risk_score !== "number") ||
    typeof r.finding_count !== "number" ||
    !Array.isArray(r.findings)
  ) {
    return false;
  }
  return r.findings.every(
    (f: unknown) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as Record<string, unknown>).file === "string" &&
      typeof (f as Record<string, unknown>).line === "number" &&
      typeof (f as Record<string, unknown>).check === "string" &&
      typeof (f as Record<string, unknown>).description === "string" &&
      ["critical", "high", "medium", "low"].includes(
        (f as Record<string, unknown>).severity as string,
      ),
  );
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // non-JSON error body — fall through to the honest fallback copy
  }
  return FALLBACK_DETAIL[res.status] ?? `scan trigger failed — HTTP ${res.status}`;
}

export function DeepScanTrigger({ enabled }: { enabled: boolean }) {
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [repoInvalid, setRepoInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);

  // Per-instance ids — the mock's own anatomy (sibling <label for> + <input
  // id> + describedby), suffixed per panel there for the same reason: a static
  // id collides when the panel mounts more than once in a document, and the
  // first-by-document-order element wins the label association.
  const instanceId = useId();
  const repoId = `${instanceId}-repo`;
  const refId = `${instanceId}-ref`;

  // Keyframes ride in document.head (see INDETERMINATE_KEYFRAMES above) so no
  // "%" ever lands in rendered text content while the run is indeterminate.
  useEffect(() => {
    if (!submitting) return;
    if (document.getElementById(INDETERMINATE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = INDETERMINATE_STYLE_ID;
    style.textContent = INDETERMINATE_KEYFRAMES;
    document.head.appendChild(style);
  }, [submitting]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enabled || submitting) return;
    setError(null);
    setReport(null);
    // Inline field validation BEFORE any network call (mock: rejected before
    // the scan starts, no ledger row).
    if (!REPO_PATTERN.test(repo)) {
      setRepoInvalid(true);
      return;
    }
    setRepoInvalid(false);
    setSubmitting(true);
    try {
      // A blank ref resolves to HEAD service-side — send only what the run
      // pins. Leading/trailing whitespace is form noise, not part of a ref.
      const trimmedRef = ref.trim();
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmedRef ? { repo, ref: trimmedRef } : { repo }),
      });
      if (res.status === 200) {
        const parsed: unknown = await res.json();
        if (!isScanReportShape(parsed)) {
          setError({
            heading: "unexpected response",
            detail:
              "scan service returned a shape this build can't render — check the ledger row when it settles",
          });
        } else {
          setReport(parsed);
        }
      } else if (res.status === 409) {
        // Mock verbatim: single-flight — one whole-repo scan runs at a time.
        setError({
          heading: "scan already in progress",
          detail:
            "HTTP 409 — wait for the running scan, or check the ledger for its row when it settles",
        });
      } else if (res.status === 429) {
        // Route-side per-IP rate limit. The proxy forwards only Content-Type,
        // so a Retry-After header here is always the route's own honest hint;
        // without it, the bare copy stands alone.
        const retryAfter = res.headers.get("Retry-After");
        setError({
          heading: "HTTP 429",
          detail: `too many scans from your address — try again later${
            retryAfter === null ? "" : ` — retry after ${retryAfter}s`
          }`,
        });
      } else {
        setError({ heading: `HTTP ${res.status}`, detail: await errorDetail(res) });
      }
    } catch {
      setError({
        heading: "network error",
        detail: "could not reach the scan trigger — check the connection and retry",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="Deep Scan trigger">
      <div className="rounded-lg border border-border bg-card p-lg">
        <form onSubmit={onSubmit} noValidate>
          <div className="grid gap-md md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2xs">
              <label
                htmlFor={repoId}
                className="font-mono text-xs tracking-[0.12em] uppercase text-subtle-foreground"
              >
                repo
              </label>
              <input
                id={repoId}
                name="repo"
                type="text"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  if (repoInvalid) setRepoInvalid(false);
                }}
                placeholder="owner/repo"
                spellCheck={false}
                autoComplete="off"
                disabled={!enabled || submitting}
                aria-invalid={repoInvalid || undefined}
                aria-describedby={repoInvalid ? `${repoId}-error` : `${repoId}-hint`}
                className={`w-full rounded-sm border bg-background px-md py-sm font-mono text-sm text-foreground placeholder:text-subtle-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [overflow-wrap:anywhere] ${
                  repoInvalid ? "border-danger" : "border-border"
                }`}
              />
              {repoInvalid ? (
                <p
                  id={`${repoId}-error`}
                  className="font-mono text-xs text-danger [overflow-wrap:anywhere]"
                >
                  {REPO_ERROR}
                </p>
              ) : (
                <p
                  id={`${repoId}-hint`}
                  className="font-mono text-xs text-subtle-foreground [overflow-wrap:anywhere]"
                >
                  owner/name · charset [A-Za-z0-9_.-]
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2xs">
              <label
                htmlFor={refId}
                className="font-mono text-xs tracking-[0.12em] uppercase text-subtle-foreground"
              >
                ref · optional
              </label>
              <input
                id={refId}
                name="ref"
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="HEAD"
                spellCheck={false}
                autoComplete="off"
                disabled={!enabled || submitting}
                aria-describedby={`${refId}-hint`}
                className="w-full rounded-sm border border-border bg-background px-md py-sm font-mono text-sm text-foreground placeholder:text-subtle-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
              />
              <p
                id={`${refId}-hint`}
                className="font-mono text-xs text-subtle-foreground [overflow-wrap:anywhere]"
              >
                branch, tag or sha — empty resolves to HEAD
              </p>
            </div>
          </div>
          <div className="mt-md flex flex-wrap items-center gap-md">
            {submitting ? (
              <Button type="button" disabled aria-busy="true">
                scanning whole repo — this takes minutes
                <span aria-hidden="true">
                  <span style={{ animation: "rx-pulse 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite" }}>
                    .
                  </span>
                  <span
                    style={{
                      animation: "rx-pulse 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
                      animationDelay: "0.2s",
                    }}
                  >
                    .
                  </span>
                  <span
                    style={{
                      animation: "rx-pulse 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
                      animationDelay: "0.4s",
                    }}
                  >
                    .
                  </span>
                </span>
              </Button>
            ) : (
              <Button type="submit" disabled={!enabled}>
                Run Deep Scan
              </Button>
            )}
            <p className="font-mono text-xs text-muted-foreground">
              {enabled
                ? "whole-repo run · synchronous · expect minutes, not seconds"
                : "Deep Scan trigger is disabled on this deployment."}
            </p>
          </div>
          {submitting ? (
            <div
              className="mt-md h-0.5 overflow-hidden rounded-sm bg-elevated"
              role="progressbar"
              aria-label="Scan progress — indeterminate"
            >
              <div
                className="h-full w-[30%] bg-primary"
                style={{ animation: "rx-indslide 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite" }}
              />
            </div>
          ) : null}
        </form>
        {error ? (
          <div
            role="alert"
            className="mt-md flex flex-wrap items-baseline gap-md rounded-sm border border-danger bg-elevated px-md py-sm font-mono text-xs tabular-nums"
          >
            <strong className="whitespace-nowrap font-medium text-danger">{error.heading}</strong>
            <span className="[overflow-wrap:anywhere]">{error.detail}</span>
          </div>
        ) : null}
        {report ? (
          <div className="mt-md">
            <div
              role="status"
              className="flex flex-wrap items-baseline gap-md rounded-sm border border-success bg-elevated px-md py-sm font-mono text-xs tabular-nums"
            >
              <span className="[overflow-wrap:anywhere]">
                status {report.status} · risk {report.risk_score ?? "—"} / 100 ·{" "}
                {report.finding_count} findings · head{" "}
                {report.head_sha ? report.head_sha.slice(0, 7) : "—"}
              </span>
            </div>
            <ScanReportView report={report} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
