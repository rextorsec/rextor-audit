// SPEC-1 §4 — webhook endpoint (node:http, no framework). Raw body is
// accumulated BEFORE signature verification: the HMAC is computed over the
// exact request bytes, so JSON.parse must never happen first. The buffer is
// capped at MAX_BODY_BYTES — an unbounded pre-signature buffer is a
// memory-DoS vector, so an oversized body answers 413 before any signature
// work. Env vars are read at call time. Events other than
// pull_request.opened/synchronize are ignored with 200 and no work.
// Actionable deliveries are enqueued on a per-server ReviewQueue (delivery-id
// dedup) and acknowledged 200 BEFORE the review completes — GitHub never
// auto-redelivers a failed (or unacknowledged) delivery, so nothing here
// relies on it: a 503 mid-drain only MARKS the delivery failed, and boot-time
// reconciliation (reconcile.ts) re-drives failed deliveries through this
// handler after restart, with the persistent-index guard deduplicating work.
// On SIGTERM/SIGINT the server drains gracefully instead (see installDrain):
// in-flight reviews finish before exit.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { githubStage, runReview, prIdentity, type ReviewDeps, type ReviewResult } from "./review";
import { createFeedbackDep, feedbackConfig, feedbackDisabledReason, type FeedbackDep } from "./feedback";
import { githubDeps } from "./github";
import { MAX_BODY_BYTES, ReviewQueue } from "./queue";
import { createReviewStore, type ReviewStore } from "./db";
import { reconcileFailedDeliveries } from "./reconcile";
import { runScan, isValidScanRepo, isValidScanRef, type ScanDeps, type ScanReport } from "./scan";
import {
  buildChatReply,
  createChatRateLimiter,
  createChatReviewCache,
  NO_REVIEW_YET_REPLY,
  THROTTLED_REPLY,
  parseCommentEvent,
  type ChatReviewCache,
  type ChatRateLimiter,
} from "./chat";
import { logError, logInfo, logLevel, logWarn } from "./logger";

// SPEC-6 §3 — the one /reviews route shape, shared by the dispatcher and the
// handler (capture groups feed the owner/repo decode).
const REVIEWS_PATH_RE = /^\/reviews\/([^/]+)\/([^/]+)\/?$/;

// SPEC-6 §3 (dashboard v2) — same shape for the repo's dismissal memory. The
// web lib (packages/web/lib/dismissals.ts) mirrors this path.
const DISMISSALS_PATH_RE = /^\/dismissals\/([^/]+)\/([^/]+)\/?$/;

// Deep Scan — synchronous whole-repo scan trigger + its ledger read. Both are
// token-gated like the other service endpoints.
const SCAN_PATH_RE = /^\/scan\/?$/;
const SCANS_PATH_RE = /^\/scans\/?$/;

export function verifySignature(rawBody: string, sig: string, secret: string): boolean {
  if (!sig.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig.slice("sha256=".length), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ReviewServerOptions {
  /** Default: real GitHub adapter + analyzer container. */
  deps?: ReviewDeps;
  /** Default: env GITHUB_APP_SECRET, read per request. */
  secret?: string;
  /** SPEC-6 §3 review index; default: store at env REXTOR_DB_PATH (read at
   *  server creation), or none — GET /reviews then reports the misconfiguration. */
  store?: ReviewStore;
  /** GET /reviews bearer token; default: env REXTOR_AGENT_TOKEN, read per request. */
  apiToken?: string;
  /** SPEC-7 §5 — @rextor-audit replies per PR per hour; default 5. */
  chatRateLimitPerHour?: number;
  /** Deep Scan runner seams (test injection); default: real git clone +
   *  analyzer container. Scans are single-flight service-wide. */
  scanDeps?: ScanDeps;
  /** Queue stall-warn interval for a single run; default 10 min (queue.ts). */
  stallWarnMs?: number;
  /** Pending-review cap: beyond it, webhook reviews answer 503 + Retry-After
   *  (GitHub marks the delivery failed; boot reconcile re-drives it).
   *  Flood control — a synchronize loop on any installed repo must not
   *  starve every other repo for hours. Default 25. */
  maxPendingReviews?: number;
}

/** Default for maxPendingReviews (see ReviewServerOptions). */
export const DEFAULT_MAX_PENDING_REVIEWS = 25;

/** HTTP server exposing the review queue drain as a test/ops affordance. */
export interface ReviewServer extends Server {
  /** Resolves when the server's review queue has no queued or in-flight work. */
  idle(): Promise<void>;
  /** True while a graceful drain is in progress (see installDrain): webhook
   *  deliveries then answer 503 + Retry-After instead of an ACK that the
   *  coming exit would turn into a silently lost review. */
  draining: boolean;
}

export function createReviewServer(options: ReviewServerOptions = {}): ReviewServer {
  // SPEC-6 §3 review index: an injected store wins; otherwise the store is
  // opened once at REXTOR_DB_PATH (the store owns its file for the server's
  // lifetime); env unset → no index — GET /reviews then fails honestly.
  const store =
    options.store ?? (process.env.REXTOR_DB_PATH ? createReviewStore(process.env.REXTOR_DB_PATH) : undefined);
  const base = options.deps ?? githubDeps();
  // Write-through wiring: queued reviews land in the index after they settle.
  // A caller-provided recordReview dep takes precedence over the store.
  // SPEC-7 §4 — the same store serves as the repo memory (dismissals +
  // learnings); ReviewStore structurally satisfies RepoMemory.
  const wired: ReviewDeps =
    store && !base.recordReview
      ? { ...base, recordReview: (row) => store.insert(row), repoMemory: store }
      : base;
  // R2 — caller-provided feedback dep wins (tests); otherwise the env-gated
  // default (undefined unless REXTOR_AUTO_FEEDBACK=on AND the wallet/registry
  // env is set — default OFF, the mainnet broadcast is a RECTOR gate).
  const deps: ReviewDeps = { ...wired, feedback: base.feedback ?? createFeedbackDep() };
  // SPEC-7 §5 — chat state lives with the server (cache dies on restart; the
  // reply says so honestly).
  const chat: { cache: ChatReviewCache; limiter: ChatRateLimiter } = {
    cache: createChatReviewCache(),
    limiter: createChatRateLimiter(options.chatRateLimitPerHour),
  };
  const queue = new ReviewQueue({ stallWarnMs: options.stallWarnMs });
  // Deep Scan: single-flight service-wide. One whole-repo scan at a time; a
  // concurrent POST /scan answers 409 instead of queueing behind an
  // unbounded container wait.
  const scanDeps = options.scanDeps ?? {};
  const scanFlight = { busy: false };
  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    // Read-only GETs (reviews index + dismissals memory + scan ledger) answer
    // during a drain: the dashboard must stay readable while the supervisor
    // restarts.
    const isDashboardRead =
      req.method === "GET" &&
      (REVIEWS_PATH_RE.test(pathname) || DISMISSALS_PATH_RE.test(pathname) || SCANS_PATH_RE.test(pathname));
    // Drain gate (R3): a delivery accepted mid-drain would be ACKed and then
    // dropped by the coming exit. 503 + Retry-After MARKS the delivery failed
    // on GitHub's side — which is safe only because boot-time reconciliation
    // (reconcile.ts) re-drives failed deliveries after restart; the
    // delivery-id dedup makes a replay single-shot. Read-only dashboard GETs
    // still answer.
    if (server.draining && !isDashboardRead) {
      res.writeHead(503, { "retry-after": "30", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "draining" }));
      return;
    }
    if (isDashboardRead) {
      const handler = REVIEWS_PATH_RE.test(pathname)
        ? handleReviews
        : SCANS_PATH_RE.test(pathname)
          ? handleScans
          : handleDismissals;
      void handler(req, res, store, options.apiToken).catch((err) => {
        logError("http.read_handler_crashed", "dashboard read handler crashed:", err, undefined, { stack: true });
        if (!res.headersSent) {
          res.statusCode = 500;
          json(res, { error: "internal error" });
        } else {
          res.end();
        }
      });
      return;
    }
    if (SCAN_PATH_RE.test(pathname)) {
      if (req.method !== "POST") {
        res.statusCode = 405;
        json(res, { error: "method not allowed" });
        return;
      }
      void handleScan(req, res, store, options.apiToken, scanDeps, scanFlight).catch((err) => {
        logError("http.scan_handler_crashed", "scan handler crashed:", err, undefined, { stack: true });
        if (!res.headersSent) {
          res.statusCode = 500;
          json(res, { error: "internal error" });
        } else {
          res.end();
        }
      });
      return;
    }
    void handleWebhook(req, res, options.secret, deps, queue, chat, store, options.maxPendingReviews ?? DEFAULT_MAX_PENDING_REVIEWS).catch((err) => {
      logError("http.webhook_handler_crashed", "webhook handler crashed:", err, undefined, { stack: true });
      if (!res.headersSent) {
        res.statusCode = 500;
        json(res, { error: "internal error" });
      } else {
        res.end();
      }
    });
  }) as ReviewServer;
  server.idle = () => queue.idle();
  server.draining = false;
  return server;
}

/** Cap on the drain wait: reviews legitimately take minutes (the stall
 *  watchdog warns at 10), so the default must outlast a real review. */
const DEFAULT_DRAIN_TIMEOUT_MS = 15 * 60 * 1000;

export interface DrainOptions {
  /** Cap on the drain wait; default env REXTOR_DRAIN_TIMEOUT_MS, else 15 min. */
  timeoutMs?: number;
  /** Exit sink; default process.exit. Tests inject a recorder. */
  exit?: (code: number) => void;
}

// Resolved ONCE at install time (= boot in production). Anything that is not
// a positive number falls back to the default with a logged warning: a cap of
// 0 would exit 1 on the FIRST signal and kill in-flight reviews post-ACK
// (silent loss), and an unparseable value must never silently shrink the cap.
function resolveDrainTimeoutMs(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  const raw = process.env.REXTOR_DRAIN_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DRAIN_TIMEOUT_MS;
  const envMs = Number(raw);
  if (Number.isFinite(envMs) && envMs > 0) return envMs;
  logWarn(
    "service.drain_env_invalid",
    `REXTOR_DRAIN_TIMEOUT_MS=${JSON.stringify(raw)} is not a positive number — using the default ${DEFAULT_DRAIN_TIMEOUT_MS}ms`,
  );
  return DEFAULT_DRAIN_TIMEOUT_MS;
}

/**
 * R3 graceful drain for supervisor restarts (hub stop → SIGTERM). Reviews are
 * ACKed BEFORE they run, so a hard kill silently loses the in-flight review —
 * GitHub never auto-redelivers. On the first SIGTERM/SIGINT: flip the drain
 * gate (new webhook deliveries get 503 + Retry-After, which MARKS them failed
 * for boot-time reconciliation to re-drive after restart) and wait for the
 * queue to go idle however long that takes. The listener stays up through the
 * drain — closing it early would turn re-driven deliveries into ECONNREFUSED
 * and bypass the Retry-After pacing. At the terminal step server.close()
 * stops accepting connections before exit. Two ways out early: the wait hits
 * the REXTOR_DRAIN_TIMEOUT_MS cap (log the state reached, exit 1 — the
 * supervisor restart is the wedged-queue doctrine), or a second signal
 * arrives (force exit 1). Returns a disposer removing the listeners (tests).
 */
export function installDrain(server: ReviewServer, options: DrainOptions = {}): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = resolveDrainTimeoutMs(options.timeoutMs);
  let signalCount = 0;
  let cap: NodeJS.Timeout | undefined;

  const onSignal = (signal: NodeJS.Signals): void => {
    signalCount += 1;
    if (signalCount > 1) {
      logError("service.drain_forced_exit", `second ${signal} during drain — force exit 1`, undefined, { signal });
      exit(1);
      return;
    }
    logInfo("service.drain_started", `${signal} — draining: finishing in-flight reviews`, { signal });
    server.draining = true;
    const startedAt = Date.now();
    cap = setTimeout(() => {
      logError("service.drain_timeout", `drain timed out after ${timeoutMs}ms — queue or feedback still busy; exiting 1`, undefined, { timeoutMs });
      server.close();
      exit(1);
    }, timeoutMs);
    void server.idle().then(
      () => {
        // I1 — the queue is idle but feedback broadcasts may still be in
        // flight; hold the exit until they settle. The cap above stays armed
        // and bounds this wait (on cap: log + exit 1).
        void feedbackIdle().then(() => {
          clearTimeout(cap);
          server.close();
          logInfo("service.drain_complete", `queue drained in ${Math.round((Date.now() - startedAt) / 1000)}s — exit 0`);
          exit(0);
        });
      },
      (err: unknown) => {
        clearTimeout(cap);
        server.close();
        logError("service.drain_idle_failed", "queue idle failed — exiting 1:", err);
        exit(1);
      },
    );
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, onSignal);
  return () => {
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.removeListener(signal, onSignal);
    clearTimeout(cap);
  };
}

// Timing-safe token comparison: same length-guard pattern as verifySignature.
function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// SPEC-6 §3 — dashboard data source. Token-gated (X-API-Token vs
// REXTOR_AGENT_TOKEN); an unset token fails closed (401 for everything).
// Unknown repo → 200 { reviews: [] } — the dashboard's empty state, not an
// error. Path segments are PR-derived untrusted strings: stored verbatim and
// JSON-encoded on the way out (JSON escapes — inert data, no rendering here).
async function handleReviews(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReviewStore | undefined,
  apiTokenOpt: string | undefined,
): Promise<void> {
  const expected = apiTokenOpt ?? process.env.REXTOR_AGENT_TOKEN;
  const provided = header(req, "x-api-token");
  if (!expected || !provided || !tokensEqual(provided, expected)) {
    res.statusCode = 401;
    json(res, { error: "unauthorized" });
    return;
  }
  if (!store) {
    logError("http.store_missing", "REXTOR_DB_PATH is not configured");
    res.statusCode = 500;
    json(res, { error: "server misconfigured: no review index" });
    return;
  }
  const match = REVIEWS_PATH_RE.exec((req.url ?? "/").split("?")[0]);
  if (!match) {
    res.statusCode = 404;
    json(res, { error: "not found" });
    return;
  }
  const repo = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
  // R2 — feedback-path receipts ride the same payload: the ledger renders
  // them as rows next to the review attestations.
  json(res, { reviews: store.listForRepo(repo), feedback_receipts: store.listFeedbackReceipts(repo) });
}

// SPEC-6 §3 (dashboard v2) — the repo's server-side dismissal memory
// (invariant 21: never a repo file, so PR content cannot silence findings).
// Same trust posture as handleReviews: token-gated, unknown repo → 200
// { dismissals: [] } (the panel's zero state, not an error).
async function handleDismissals(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReviewStore | undefined,
  apiTokenOpt: string | undefined,
): Promise<void> {
  const expected = apiTokenOpt ?? process.env.REXTOR_AGENT_TOKEN;
  const provided = header(req, "x-api-token");
  if (!expected || !provided || !tokensEqual(provided, expected)) {
    res.statusCode = 401;
    json(res, { error: "unauthorized" });
    return;
  }
  if (!store) {
    logError("http.store_missing", "REXTOR_DB_PATH is not configured");
    res.statusCode = 500;
    json(res, { error: "server misconfigured: no review index" });
    return;
  }
  const match = DISMISSALS_PATH_RE.exec((req.url ?? "/").split("?")[0]);
  if (!match) {
    res.statusCode = 404;
    json(res, { error: "not found" });
    return;
  }
  const repo = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
  json(res, { dismissals: store.listDismissals(repo) });
}

// Deep Scan ledger read — GET /scans?repo=. Same trust posture as
// handleReviews: token-gated, unknown repo → 200 { scans: [] } (the ledger's
// zero state, not an error); repo omitted → every repo, newest first.
async function handleScans(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReviewStore | undefined,
  apiTokenOpt: string | undefined,
): Promise<void> {
  const expected = apiTokenOpt ?? process.env.REXTOR_AGENT_TOKEN;
  const provided = header(req, "x-api-token");
  if (!expected || !provided || !tokensEqual(provided, expected)) {
    res.statusCode = 401;
    json(res, { error: "unauthorized" });
    return;
  }
  if (!store) {
    logError("http.store_missing", "REXTOR_DB_PATH is not configured");
    res.statusCode = 500;
    json(res, { error: "server misconfigured: no review index" });
    return;
  }
  const repo = new URL(req.url ?? "/", "http://localhost").searchParams.get("repo") ?? undefined;
  json(res, { scans: store.listScans(repo) });
}

// Deep Scan trigger — POST /scan {repo, ref?}, synchronous: the response is
// the scan report after the run completes (container time is accepted for
// v1). Token-gated exactly like the dashboard reads; single-flight
// service-wide (concurrent → 409). Every COMPLETED run records a deep_scans
// row — complete or INCOMPLETE: the row records what happened, receipts-not-
// claims. Repo/ref are validated before the runner sees them (the ref is a
// git argv slot; the repo lands in an HTTPS URL path), and both reach git as
// execFile array args — never a shell string.
async function handleScan(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReviewStore | undefined,
  apiTokenOpt: string | undefined,
  scanDeps: ScanDeps,
  flight: { busy: boolean },
): Promise<void> {
  const expected = apiTokenOpt ?? process.env.REXTOR_AGENT_TOKEN;
  const provided = header(req, "x-api-token");
  if (!expected || !provided || !tokensEqual(provided, expected)) {
    res.statusCode = 401;
    json(res, { error: "unauthorized" });
    return;
  }
  if (!store) {
    logError("http.store_missing", "REXTOR_DB_PATH is not configured");
    res.statusCode = 500;
    json(res, { error: "server misconfigured: no review index" });
    return;
  }
  // Same bounded pre-parse discipline as the webhook: {repo, ref} is tiny,
  // so hitting the cap means garbage — refuse before JSON.parse sees it.
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      oversized = true;
      break;
    }
    chunks.push(buf);
  }
  if (oversized) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "payload too large" }), () => req.destroy());
    return;
  }
  let body: { repo?: unknown; ref?: unknown };
  try {
    body = (JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {}) as typeof body;
  } catch {
    res.statusCode = 400;
    json(res, { error: "malformed JSON body" });
    return;
  }
  if (typeof body.repo !== "string" || !isValidScanRepo(body.repo)) {
    res.statusCode = 400;
    json(res, { error: "repo must match owner/name over [A-Za-z0-9_.-]" });
    return;
  }
  let scanRef: string | undefined;
  if (body.ref !== undefined) {
    if (typeof body.ref !== "string" || !isValidScanRef(body.ref)) {
      res.statusCode = 400;
      json(res, { error: "ref is not a safe git ref" });
      return;
    }
    scanRef = body.ref;
  }
  if (flight.busy) {
    res.statusCode = 409;
    json(res, { error: "scan already in progress" });
    return;
  }
  flight.busy = true;
  try {
    const report: ScanReport = await runScan(body.repo, scanRef, scanDeps);
    // Receipts-not-claims: the row is written for every completed run. The
    // scan settled and the response carries the verdict — a failed row write
    // degrades to a log line, never a failed response (settleFeedback's
    // receipt-write discipline).
    try {
      store.recordScan({
        repo: report.repo,
        ref: report.ref,
        head_sha: report.head_sha,
        status: report.status,
        risk_score: report.risk_score,
        finding_count: report.finding_count,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      logError("http.scan_ledger_write_failed",
        "deep-scan ledger write failed:",
        err, { repo: report.repo });
    }
    json(res, report);
  } finally {
    flight.busy = false;
  }
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  secretOpt: string | undefined,
  deps: ReviewDeps,
  queue: ReviewQueue,
  chat: { cache: ChatReviewCache; limiter: ChatRateLimiter },
  store: ReviewStore | undefined,
  maxPendingReviews: number,
): Promise<void> {
  // Cap the pre-signature buffer: stop accumulating the moment the ceiling is
  // crossed and answer 413 — signature work (and any review) never sees it.
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      oversized = true;
      break;
    }
    chunks.push(buf);
  }
  if (oversized) {
    // The delivery can never succeed at this cap: record it as permanently
    // unrecoverable so boot reconcile does not re-drive — and re-refuse —
    // it at every boot, crowding recoverable failures out of the page
    // budget. Header is available without body work; absent id → nothing
    // to record.
    const oversizeDeliveryId = header(req, "x-github-delivery");
    if (store && oversizeDeliveryId !== undefined) {
      try {
        store.skipDelivery(oversizeDeliveryId, "payload exceeds 1 MiB cap");
      } catch (err) {
        logError("webhook.skiplist_write_failed",
          "skip-list write failed:",
          err, { deliveryId: oversizeDeliveryId });
      }
    }
    res.writeHead(413, { "content-type": "application/json" });
    // Destroy only after the response is flushed so the client sees the 413
    // instead of a connection reset.
    res.end(JSON.stringify({ error: "payload too large" }), () => req.destroy());
    return;
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const secret = secretOpt ?? process.env.GITHUB_APP_SECRET;
  if (!secret) {
    logError("http.secret_missing", "GITHUB_APP_SECRET is not configured");
    res.statusCode = 500;
    json(res, { error: "server misconfigured: no webhook secret" });
    return;
  }

  const sig = header(req, "x-hub-signature-256");
  if (sig === undefined || !verifySignature(rawBody, sig, secret)) {
    res.statusCode = 401;
    json(res, { error: "invalid signature" });
    return;
  }

  let payload: {
    action?: string;
    pull_request?: { html_url?: string; head?: { sha?: unknown } };
    issue?: { pull_request?: unknown; html_url?: string };
    comment?: { body?: unknown; user?: { login?: string } };
    sender?: { login?: string };
  };
  try {
    payload = (JSON.parse(rawBody) ?? {}) as typeof payload;
  } catch {
    res.statusCode = 400;
    json(res, { error: "malformed JSON body" });
    return;
  }

  const event = header(req, "x-github-event");
  const deliveryId = header(req, "x-github-delivery") ?? randomUUID();

  // SPEC-7 §5 — @rextor-audit chat on issue_comment (PRs only). The reply is
  // a deterministic template over the CACHED review: comment text never
  // enters any prompt or output (invariant 22 by construction). Replies go
  // through the same queue (delivery dedup) and are best-effort.
  if (event === "issue_comment") {
    const evt = parseCommentEvent(payload, process.env.REXTOR_BOT_LOGIN);
    if (!evt) {
      json(res, { ignored: true });
      return;
    }
    const ctx = chat.cache.get(evt.prUrl);
    let reply: string;
    if (!ctx) {
      reply = NO_REVIEW_YET_REPLY;
    } else if (!chat.limiter.allow(evt.prUrl)) {
      reply = chat.limiter.needsThrottleNotice(evt.prUrl) ? THROTTLED_REPLY : "";
    } else {
      reply = buildChatReply(ctx);
    }
    if (reply !== "") {
      void queue.enqueue(
        deliveryId,
        async () => {
          try {
            // Same hard deadline as every review GitHub stage: a hung
            // postComment must not pin the shared queue tail (the undici
            // connect-phase hang evades Octokit's request.timeout — the
            // exact failure class GITHUB_STAGE_BUDGET_MS exists for).
            await githubStage("chat postComment", deps.postComment(evt.prUrl, reply));
          } catch (err) {
            logWarn("github.chat_reply_failed", "chat reply failed:", err, { prUrl: evt.prUrl });
          }
        },
        `chat reply ${evt.prUrl}`,
      );
    }
    json(res, { queued: true });
    return;
  }

  const prUrl = payload.pull_request?.html_url;
  const actionable =
    event === "pull_request" &&
    (payload.action === "opened" || payload.action === "synchronize") &&
    typeof prUrl === "string";

  // 400 only when a review is needed but the payload has no PR URL; every
  // other non-actionable combination is ignored, not an error.
  const reviewNeeded = payload.action === "opened" || payload.action === "synchronize";
  if (event === "pull_request" && reviewNeeded && typeof prUrl !== "string") {
    res.statusCode = 400;
    json(res, { error: "pull_request event without pull_request.html_url" });
    return;
  }
  if (!actionable) {
    json(res, { ignored: true });
    return;
  }

  // C1 — persistent-index re-drive guard. GitHub does not auto-redeliver, so
  // a FAILED delivery is re-driven at boot (reconcile.ts) or manually; the
  // replay arrives here with its ORIGINAL payload — and the review it belongs
  // to may already sit in the index (ACKed-then-crashed). In-memory delivery
  // dedup is fresh every boot, so THIS guard is what prevents duplicate
  // reviews: (repo, pr, headSha) in the SQLite index → answered skipped with
  // 200, which marks the redelivery OK. On-chain reviewId idempotency is the
  // second net. Best-effort: a guard failure logs and proceeds to the normal
  // enqueue rather than erroring a deliverable webhook.
  if (store) {
    const headSha = payload.pull_request?.head?.sha;
    if (typeof headSha === "string" && typeof prUrl === "string") {
      try {
        const { repoFullName, prNumber } = prIdentity(prUrl);
        if (store.hasReview(repoFullName, prNumber, headSha)) {
          logInfo(
            "webhook.delivery_skipped",
            `delivery ${deliveryId} skipped: ${repoFullName}#${prNumber} @ ${headSha.slice(0, 12)} already reviewed`,
            { deliveryId, repo: repoFullName, pr: prNumber },
          );
          json(res, { skipped: "already reviewed" });
          return;
        }
      } catch (err) {
        logWarn("webhook.redrive_guard_failed", "re-drive guard failed — enqueuing anyway:", err, { deliveryId });
      }
    }
  }

  // Flood control: beyond the pending cap, refuse with 503 + Retry-After.
  // GitHub marks the delivery failed; boot reconciliation re-drives it once
  // the queue has room. Without this, a synchronize loop on ANY installed
  // repo occupies the serial tail for hours and starves every other repo.
  if (queue.pendingCount() >= maxPendingReviews) {
    logWarn(
      "webhook.delivery_refused",
      `delivery ${deliveryId} refused: ${queue.pendingCount()} reviews pending (cap ${maxPendingReviews})`,
      undefined,
      { deliveryId, pending: queue.pendingCount(), cap: maxPendingReviews },
    );
    res.writeHead(503, { "retry-after": "120", "content-type": "application/json" });
    res.end(JSON.stringify({ error: "review queue at capacity; retry later" }));
    return;
  }

  // Hardening: acknowledge BEFORE the review runs. The queue dedups by
  // delivery id (a re-driven or manually redelivered delivery keeps its id),
  // COALESCES pending deliveries for the same PR (a synchronize burst leaves
  // only the tip reviewed — runReview fetches the diff at execution time, so
  // the pending closure is always "review the current tip"), and contains
  // worker errors, so the enqueue promise is intentionally not awaited.
  // SPEC-7 §5 — the settled review becomes the chat answer source.
  void queue.enqueueCoalesced(
    prUrl as string,
    deliveryId,
    async () => {
      // C1 race net: the arrival-time guard ran before the wait in the tail;
      // a duplicate delivery for the same (repo, pr, headSha) could pass both
      // guards before either review settles. Re-check at run start.
      const headSha = (payload.pull_request?.head?.sha ?? "") as string;
      if (store && typeof headSha === "string" && headSha.length > 0) {
        try {
          const { repoFullName, prNumber } = prIdentity(prUrl as string);
          if (store.hasReview(repoFullName, prNumber, headSha)) {
            logInfo(
              "webhook.queued_review_skipped",
              `queued review skipped (already reviewed): ${repoFullName}#${prNumber} @ ${headSha.slice(0, 12)}`,
              { repo: repoFullName, pr: prNumber },
            );
            return;
          }
        } catch (err) {
          logWarn("webhook.redrive_guard_failed", "in-run re-drive guard failed — reviewing anyway:", err, { deliveryId });
        }
      }
      const result = await runReview(prUrl as string, deps);
      if (result.commented) chat.cache.record(prUrl as string, result);
      // R2 settle point — feedback fires after the review lands, once, and
      // never in the review's critical path (see settleFeedback).
      settleFeedback(deps.feedback, prUrl as string, result, store);
    },
    prUrl as string,
  );
  json(res, { queued: true });
}

// I1 — in-flight ERC-8004 feedback broadcasts. settleFeedback fires them
// fire-and-forget after a review settles; this set lets the drain hold the
// process exit until every broadcast settles. The reviews are already
// settled and ACKed, so waiting can never block or delay a review — only
// the exit — and the drain cap bounds the wait (on cap: log + exit 1).
const inFlightFeedback = new Set<Promise<void>>();

/** Resolves when every tracked feedback broadcast has settled. */
export function feedbackIdle(): Promise<void> {
  if (inFlightFeedback.size === 0) return Promise.resolve();
  return Promise.allSettled([...inFlightFeedback]).then(() => undefined);
}

// R2 — ERC-8004 reputation feedback, fired ONCE per settled review, strictly
// AFTER runReview returns and only when the artifact is ATTESTED (a skipped or
// failed attestation is recorded as a skip with its reason — never feedback
// without an attested artifact). Fire-and-forget from the review's
// perspective: the dep call is not awaited by the settle point, so it can
// never block, fail, or delay a review — but it is no longer invisible to the
// drain: installDrain holds the exit until tracked broadcasts settle (I1).
// Hard-incomplete reviews are withheld entirely (I2): their attestation is
// status=1 with the empty-findings payload, and a public 95/100 rating over
// that hash would be indistinguishable from a complete audit. A CONFIRMED
// broadcast also appends a feedback_receipts row (repo, pr, chain, tx) so the
// dashboard's ledger can show the feedback path next to the review rows —
// best-effort (a write failure degrades to a log line); skipped outcomes
// record nothing, on-chain receipts stay indexable by client address.
function settleFeedback(
  feedback: FeedbackDep | undefined,
  prUrl: string,
  result: ReviewResult,
  store: ReviewStore | undefined,
): void {
  if (!feedback) {
    logInfo("chain.feedback_skipped", `feedback skipped: ${feedbackDisabledReason(process.env)}`);
    return;
  }
  // I2 — hard-incomplete-but-attested: withhold by name, never broadcast a
  // full-quality rating over the empty-findings feedbackHash.
  if (result.incomplete) {
    logInfo("chain.feedback_skipped", "feedback skipped: review incomplete — feedback withheld");
    return;
  }
  const att = result.attestation;
  if (!att || "skipped" in att) {
    const reason = att && "skipped" in att ? att.skipped : "review never attested";
    logInfo("chain.feedback_skipped", `feedback skipped: no attested artifact (${reason})`);
    return;
  }
  // A successful attestation implies prIdentity already parsed this URL inside
  // runReview, so this cannot throw on the settle path.
  const { repoFullName, prNumber } = prIdentity(prUrl);
  // The receipt's chain label comes from the feedback config (the same config
  // the dep validates before broadcasting) — a parse failure is impossible for
  // a real broadcast, so the fallback is the index's absence idiom (""), never
  // a guessed chain name.
  let feedbackChain = "";
  try {
    feedbackChain = feedbackConfig(process.env).chain;
  } catch { /* unlabeled receipt beats a wrong chain name */ }
  // I1 — the tracked promise settles only after the outcome is logged.
  const tracked = feedback({ findingsURI: att.findingsURI, findingsHash: att.findingsHash }, repoFullName)
    .then((outcome) => {
      if ("skipped" in outcome) {
        logInfo("chain.feedback_skipped", `feedback skipped: ${outcome.skipped}`);
        return;
      }
      logInfo("chain.feedback_recorded", `feedback recorded: tx ${outcome.txHash}`, { txHash: outcome.txHash });
      if (!store) return;
      try {
        store.recordFeedbackReceipt({
          repo: repoFullName,
          pr: prNumber,
          chain: feedbackChain,
          tx_hash: outcome.txHash,
          explorer_url: outcome.explorerUrl,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        // The review is settled and the tx is on-chain — a failed receipt
        // write degrades to a log line; it never re-drives the broadcast.
        logError("chain.feedback_receipt_write_failed",
          "feedback receipt write failed:",
          err, { repo: repoFullName, pr: prNumber });
      }
    })
    .catch((err: unknown) => {
      logError("chain.feedback_failed", "feedback failed:", err, { repo: repoFullName, pr: prNumber });
    });
  inFlightFeedback.add(tracked);
  void tracked.then(() => inFlightFeedback.delete(tracked));
}

function header(req: IncomingMessage, name: string): undefined | string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(res: ServerResponse, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// Boot-path env sourcing for the documented knobs (SPEC-1 env-at-call-time;
// .env.example documents both — an operator setting a var must see it take
// effect, and an unset var falls to the code defaults).
function envServerOptions(): ReviewServerOptions {
  const opts: ReviewServerOptions = {};
  const pending = Number(process.env.REXTOR_MAX_PENDING_REVIEWS);
  if (Number.isInteger(pending) && pending > 0) opts.maxPendingReviews = pending;
  const chatLimit = Number(process.env.REXTOR_CHAT_RATE_LIMIT_PER_HOUR);
  if (Number.isInteger(chatLimit) && chatLimit > 0) opts.chatRateLimitPerHour = chatLimit;
  return opts;
}

// tsx src/server.ts → listen; importing server.ts from tests → no side effects.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const port = Number(process.env.PORT ?? 8080);
  // The one boot line: names the active log level once (service.* contract).
  logInfo("service.boot", "agent service starting", { level: logLevel(), port });
  // C1 — re-drive FAILED deliveries from the previous run at boot, alongside
  // listen: GitHub never auto-redelivers, so without this the mid-drain 503s
  // (and any delivery lost to a crash) would be silent loss. Fire-and-forget:
  // reconciliation is best-effort and can never block or crash boot.
  // Deliveries recorded as permanently unrecoverable (413 over the cap) are
  // filtered through the store's skip list — re-driving them would 413 again
  // at every boot. Own connection, closed when the re-drive settles (WAL
  // tolerates the overlap with the server's store).
  const bootStore = process.env.REXTOR_DB_PATH ? createReviewStore(process.env.REXTOR_DB_PATH) : undefined;
  void reconcileFailedDeliveries(bootStore ? { skipList: { has: (id) => bootStore.isDeliverySkipped(id) } } : {})
    .catch((err: unknown) => {
      logError("webhook.reconcile_crashed", "delivery reconciliation crashed:", err);
    })
    .finally(() => bootStore?.close());
  const server = createReviewServer(envServerOptions());
  // Loopback only: the public path is the same-host cloudflared tunnel; the
  // webhook (HMAC) and /reviews (token) endpoints have no business on LAN
  // interfaces. An all-interface bind exposed gated-but-reachable surfaces
  // to every peer on the network.
  server.listen(port, "127.0.0.1", () => {
    logInfo("service.listening", `webhook listening on 127.0.0.1:${port}`, { port });
  });
  installDrain(server);
}
