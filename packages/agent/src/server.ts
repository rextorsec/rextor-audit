// SPEC-1 §4 — webhook endpoint (node:http, no framework). Raw body is
// accumulated BEFORE signature verification: the HMAC is computed over the
// exact request bytes, so JSON.parse must never happen first. The buffer is
// capped at MAX_BODY_BYTES — an unbounded pre-signature buffer is a
// memory-DoS vector, so an oversized body answers 413 before any signature
// work. Env vars are read at call time. Events other than
// pull_request.opened/synchronize are ignored with 200 and no work.
// Actionable deliveries are enqueued on a per-server ReviewQueue (delivery-id
// dedup) and acknowledged 200 BEFORE the review completes — GitHub redelivers
// when no response arrives within ~10s.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runReview, type ReviewDeps } from "./review";
import { githubDeps } from "./github";
import { MAX_BODY_BYTES, ReviewQueue } from "./queue";
import { createReviewStore, type ReviewStore } from "./db";

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
}

/** HTTP server exposing the review queue drain as a test/ops affordance. */
export interface ReviewServer extends Server {
  /** Resolves when the server's review queue has no queued or in-flight work. */
  idle(): Promise<void>;
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
  const deps: ReviewDeps =
    store && !base.recordReview ? { ...base, recordReview: (row) => store.insert(row) } : base;
  const queue = new ReviewQueue();
  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && /^\/reviews\/[^/]+\/[^/]+\/?$/.test(pathname)) {
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
    void handleWebhook(req, res, options.secret, deps, queue).catch((err) => {
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
  return server;
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
  const match = (req.url ?? "/").split("?")[0].match(/^\/reviews\/([^/]+)\/([^/]+)\/?$/);
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

  let payload: { action?: string; pull_request?: { html_url?: string } };
  try {
    payload = (JSON.parse(rawBody) ?? {}) as typeof payload;
  } catch {
    res.statusCode = 400;
    json(res, { error: "malformed JSON body" });
    return;
  }

  const event = header(req, "x-github-event");
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
  const deliveryId = header(req, "x-github-delivery") ?? randomUUID();
  void queue.enqueue(deliveryId, async () => {
    await runReview(prUrl as string, deps);
  });
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
  createReviewServer().listen(port, () => {
    console.log(`[rextor] webhook listening on :${port}`);
  });
}
