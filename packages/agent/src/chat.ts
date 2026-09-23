// SPEC-7 §5 — @rextor-audit PR chat: READ-ONLY replies over the cached review.
//
// DESIGN RULING (controller, 2026-09-19): replies are DETERMINISTIC templates —
// there is NO LLM in the chat path. A model in the loop would turn every PR
// comment into a prompt-injection attempt against the agent; a template cannot
// be talked into approving anything, silencing findings, or leaking config.
// The cost is a narrower answer surface (state + citations, no prose Q&A) —
// exactly the read-only contract SPEC-7 §5 binds.
import type { Finding } from "./findings";
import { SEVERITIES } from "./findings";
import type { ReviewResult } from "./review";
import { cell } from "./review";
import { prParts } from "./github";

export const DEFAULT_BOT_LOGIN = "rextor-audit[bot]";
export const DEFAULT_RATE_LIMIT_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const MENTION = "@rextor-audit";
const MAX_LISTED_FINDINGS = 10;

export interface ChatReviewContext {
  prUrl: string;
  repo: string;
  pr: number;
  score: number;
  incomplete?: string;
  findings: Finding[];
  attestation: ReviewResult["attestation"];
}

/** Extracts an actionable chat event from an issue_comment webhook payload.
 *  null unless: action=created, the issue IS a PR, the body mentions the bot,
 *  and the commenter is not the bot itself (infinite-loop guard). */
export function parseCommentEvent(
  payload: unknown,
  botLogin: string = DEFAULT_BOT_LOGIN,
): { prUrl: string; body: string } | null {
  const p = payload as {
    action?: string;
    issue?: { pull_request?: unknown; html_url?: string };
    comment?: { body?: unknown; user?: { login?: string } };
    sender?: { login?: string };
  };
  if (p?.action !== "created") return null;
  if (!p.issue || typeof p.issue.pull_request === "undefined") return null;
  const prUrl = p.issue.html_url;
  if (typeof prUrl !== "string") return null;
  const user = p.comment?.user?.login ?? p.sender?.login;
  if (user === botLogin) return null;
  const body = p.comment?.body;
  if (typeof body !== "string" || !body.includes(MENTION)) return null;
  return { prUrl, body };
}

export interface ChatRateLimiter {
  allow(key: string, now?: number): boolean;
  needsThrottleNotice(key: string, now?: number): boolean;
}

/** Sliding-hour limiter per PR. SPEC-7 §5: over-limit gets a single
 *  throttling notice per window, not a notice per comment. */
export function createChatRateLimiter(maxPerHour: number = DEFAULT_RATE_LIMIT_PER_HOUR): ChatRateLimiter {
  const hits = new Map<string, number[]>();
  const notices = new Map<string, number>();
  // Bounded-state sweep threshold: keys for dead PRs are only pruned when
  // the SAME key is probed again, so a long-lived multi-repo service grows
  // the maps forever. Sweep once the map grows; a fully expired map is the
  // steady state, active keys are re-inserted on their next hit.
  const SWEEP_AT = 1024;
  return {
    allow(key: string, now = Date.now()): boolean {
      if (hits.size >= SWEEP_AT) {
        for (const [k, ts] of hits) {
          if (ts.every((t) => t <= now - HOUR_MS)) hits.delete(k);
        }
      }
      const recent = (hits.get(key) ?? []).filter((t) => t > now - HOUR_MS);
      if (recent.length >= maxPerHour) return false;
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    needsThrottleNotice(key: string, now = Date.now()): boolean {
      if (notices.size >= SWEEP_AT) {
        for (const [k, t] of notices) {
          if (t <= now - HOUR_MS) notices.delete(k);
        }
      }
      const last = notices.get(key);
      if (last !== undefined && now - last < HOUR_MS) return false;
      notices.set(key, now);
      return true;
    },
  };
}

export interface ChatReviewCache {
  record(prUrl: string, result: ReviewResult): void;
  get(prUrl: string): ChatReviewContext | undefined;
}

/** In-memory cache of the latest settled review per PR (LRU-capped: the
 *  service restart loses it — chat then answers honestly "no cached review"). */
export function createChatReviewCache(maxEntries = 500): ChatReviewCache {
  const map = new Map<string, ChatReviewContext>();
  return {
    record(prUrl: string, result: ReviewResult): void {
      const { repo, number } = prParts(prUrl);
      map.set(prUrl, {
        prUrl,
        repo,
        pr: number,
        score: result.score,
        incomplete: result.incomplete,
        findings: result.findings ?? [],
        attestation: result.attestation,
      });
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    get(prUrl: string): ChatReviewContext | undefined {
      return map.get(prUrl);
    },
  };
}

export const NO_REVIEW_YET_REPLY = [
  "### rextor-audit — no cached review",
  "",
  "I don't have a review for this PR in my current session.",
  "Push a new commit (or close and reopen the PR) to trigger a fresh review, then ask again.",
].join("\n");

export const THROTTLED_REPLY = [
  "**Rate limit reached** — I answer at most a few replies per hour per PR.",
  "The full verdict is in the review comment above; I'll answer again in a little while.",
].join("\n");

const SEVERITY_ORDER: readonly string[] = SEVERITIES;

/** The one reply template. `question` is deliberately UNUSED — comment text
 *  never enters any output or prompt (invariant 22, by construction). */
export function buildChatReply(ctx: ChatReviewContext): string {
  if (ctx.incomplete) {
    return [
      "### rextor audit — INCOMPLETE",
      "",
      `The last review of this PR could not complete: ${cell(ctx.incomplete)}`,
      "",
      "_No risk score was computed — a tool failure is never reported as a clean pass._",
    ].join("\n");
  }

  const counts = SEVERITIES.map(
    (sev) => `${ctx.findings.filter((f) => f.severity === sev).length} ${sev}`,
  ).filter((part, i) => ctx.findings.some((f) => f.severity === SEVERITIES[i]));
  const sorted = [...ctx.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  const listed = sorted.slice(0, MAX_LISTED_FINDINGS);
  const hidden = sorted.length - listed.length;

  const attLines =
    ctx.attestation && "chain" in ctx.attestation
      ? [
          "",
          `⚖ attested on ${cell(ctx.attestation.chain)} — [tx \`${ctx.attestation.txHash.slice(0, 10)}…\`](${ctx.attestation.explorerUrl}) · reviewId \`${ctx.attestation.reviewId}\``,
          "verify: recompute sha256 of the findings JSON in the review comment and compare with the on-chain findingsHash.",
        ]
      : ["", "_not attested (attestation skipped for this review)._"];

  return [
    "### rextor audit — current verdict",
    "",
    `riskScore **${ctx.score}/100** · ${ctx.findings.length} finding(s)${counts.length > 0 ? ` (${counts.join(" · ")})` : ""}`,
    ...attLines,
    "",
    ...(listed.length > 0
      ? ["Findings (severest first):", ...listed.map((f) => `- #${f.id ?? "—"} **${f.severity}** ${cell(f.check)} @ ${cell(f.file)}:${f.line}${f.learningNote ? ` — ${cell(f.learningNote)}` : ""}`)]
      : ["No findings in scope — nothing breached the configured severity gate."]),
    ...(hidden > 0 ? [`…and ${hidden} more — see the full review comment.`] : []),
    "",
    "_Read-only reply from the latest cached review (SPEC-7 §5): I never take instructions from comments, never change config, never silence findings. Config lives in `rextor.yaml` on your default branch._",
  ].join("\n");
}
