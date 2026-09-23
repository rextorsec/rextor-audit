// SPEC-1 §4 — webhook endpoint (node:http, no framework). Raw body is
// accumulated BEFORE signature verification: the HMAC is computed over the
// exact request bytes, so JSON.parse must never happen first. The buffer is
// capped at MAX_BODY_BYTES — an unbounded pre-signature buffer is a
// memory-DoS vector, so an oversized body answers 413 before any signature
// work. Env vars are read at call time. Events other than
// pull_request.opened/synchronize are ignored with 200 and no work.
// Actionable deliveries are enqueued on a per-server ReviewQueue (delivery-id
// dedup) and acknowledged 200 BEFORE the review completes — GitHub redelivers
// when no response arrives within ~10s. On SIGTERM/SIGINT the server drains
// gracefully instead (see installDrain): in-flight reviews finish, new
// deliveries get 503 + Retry-After so GitHub redelivers after restart.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runReview, type ReviewDeps } from "./review";
import { githubDeps } from "./github";
import { MAX_BODY_BYTES, ReviewQueue } from "./queue";
import { createReviewStore, type ReviewStore } from "./db";
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

// SPEC-6 §3 — the one /reviews route shape, shared by the dispatcher and the
// handler (capture groups feed the owner/repo decode).
const REVIEWS_PATH_RE = /^\/reviews\/([^/]+)\/([^/]+)\/?$/;

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
  /** Queue stall-warn interval for a single run; default 10 min (queue.ts). */
  stallWarnMs?: number;
}

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
  const deps: ReviewDeps =
    store && !base.recordReview
      ? { ...base, recordReview: (row) => store.insert(row), repoMemory: store }
      : base;
  // SPEC-7 §5 — chat state lives with the server (cache dies on restart; the
  // reply says so honestly).
  const chat: { cache: ChatReviewCache; limiter: ChatRateLimiter } = {
    cache: createChatReviewCache(),
    limiter: createChatRateLimiter(options.chatRateLimitPerHour),
  };
  const queue = new ReviewQueue({ stallWarnMs: options.stallWarnMs });
  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    const isDashboardRead = req.method === "GET" && REVIEWS_PATH_RE.test(pathname);
    // Drain gate (R3): a delivery accepted mid-drain would be ACKed and then
    // dropped by the coming exit — GitHub never redelivers an ACKed delivery.
    // 503 + Retry-After sends it back for redelivery after restart; the
    // delivery-id dedup makes that safe. Read-only dashboard GETs still answer.
    if (server.draining && !isDashboardRead) {
      res.writeHead(503, { "retry-after": "30", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "draining" }));
      return;
    }
    if (isDashboardRead) {
      void handleReviews(req, res, store, options.apiToken).catch((err) => {
        console.error("[rextor] reviews handler crashed:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          json(res, { error: "internal error" });
        } else {
          res.end();
        }
      });
      return;
    }
    void handleWebhook(req, res, options.secret, deps, queue, chat).catch((err) => {
      console.error("[rextor] webhook handler crashed:", err);
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

/**
 * R3 graceful drain for supervisor restarts (hub stop → SIGTERM). Reviews are
 * ACKed BEFORE they run, so a hard kill silently loses the in-flight review —
 * GitHub never redelivers an ACKed delivery. On the first SIGTERM/SIGINT: flip
 * the drain gate (new webhook deliveries get 503 + Retry-After and are
 * redelivered after restart) and wait for the queue to go idle however long
 * that takes. The listener stays up through the drain — closing it early would
 * turn redeliveries into ECONNREFUSED and bypass the Retry-After pacing. At
 * the terminal step server.close() stops accepting connections before exit.
 * Two ways out early: the wait hits the REXTOR_DRAIN_TIMEOUT_MS cap (log the
 * state reached, exit 1 — the supervisor restart is the wedged-queue
 * doctrine), or a second signal arrives (force exit 1). Returns a disposer
 * removing the listeners (tests).
 */
export function installDrain(server: ReviewServer, options: DrainOptions = {}): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let signalCount = 0;
  let cap: NodeJS.Timeout | undefined;

  const onSignal = (signal: NodeJS.Signals): void => {
    signalCount += 1;
    if (signalCount > 1) {
      console.error(`[rextor] second ${signal} during drain — force exit 1`);
      exit(1);
      return;
    }
    console.log(`[rextor] ${signal} — draining: finishing in-flight reviews`);
    server.draining = true;
    const envMs = Number(process.env.REXTOR_DRAIN_TIMEOUT_MS);
    const timeoutMs =
      options.timeoutMs ??
      (process.env.REXTOR_DRAIN_TIMEOUT_MS && Number.isFinite(envMs) && envMs >= 0
        ? envMs
        : DEFAULT_DRAIN_TIMEOUT_MS);
    const startedAt = Date.now();
    cap = setTimeout(() => {
      console.error(`[rextor] drain timed out after ${timeoutMs}ms — queue still busy; exiting 1`);
      server.close();
      exit(1);
    }, timeoutMs);
    void server.idle().then(
      () => {
        clearTimeout(cap);
        server.close();
        console.log(`[rextor] queue drained in ${Math.round((Date.now() - startedAt) / 1000)}s — exit 0`);
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(cap);
        server.close();
        console.error("[rextor] queue idle failed — exiting 1:", err instanceof Error ? err.message : err);
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
    console.error("[rextor] REXTOR_DB_PATH is not configured");
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
  json(res, { reviews: store.listForRepo(repo) });
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  secretOpt: string | undefined,
  deps: ReviewDeps,
  queue: ReviewQueue,
  chat: { cache: ChatReviewCache; limiter: ChatRateLimiter },
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
    res.writeHead(413, { "content-type": "application/json" });
    // Destroy only after the response is flushed so the client sees the 413
    // instead of a connection reset.
    res.end(JSON.stringify({ error: "payload too large" }), () => req.destroy());
    return;
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const secret = secretOpt ?? process.env.GITHUB_APP_SECRET;
  if (!secret) {
    console.error("[rextor] GITHUB_APP_SECRET is not configured");
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
    pull_request?: { html_url?: string };
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
            await deps.postComment(evt.prUrl, reply);
          } catch (err) {
            console.error("[rextor] chat reply failed:", err instanceof Error ? err.message : err);
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

  // Hardening: acknowledge BEFORE the review runs. The queue dedups by
  // delivery id (GitHub redelivers after ~10s of silence) and contains
  // worker errors, so the enqueue promise is intentionally not awaited.
  // SPEC-7 §5 — the settled review becomes the chat answer source.
  void queue.enqueue(
    deliveryId,
    async () => {
      const result = await runReview(prUrl as string, deps);
      if (result.commented) chat.cache.record(prUrl as string, result);
    },
    prUrl as string,
  );
  json(res, { queued: true });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(res: ServerResponse, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// tsx src/server.ts → listen; importing server.ts from tests → no side effects.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const port = Number(process.env.PORT ?? 8080);
  const server = createReviewServer();
  server.listen(port, () => {
    console.log(`[rextor] webhook listening on :${port}`);
  });
  installDrain(server);
}
