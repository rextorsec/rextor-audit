// SPEC-1 §4 — webhook endpoint (node:http, no framework). Raw body is
// accumulated BEFORE signature verification: the HMAC is computed over the
// exact request bytes, so JSON.parse must never happen first. Env vars are
// read at call time. Events other than pull_request.opened/synchronize are
// ignored with 200 and no work.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runReview, type ReviewDeps, type ReviewResult } from "./review";
import { githubDeps } from "./github";

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
}

export function createReviewServer(options: ReviewServerOptions = {}): Server {
  const deps = options.deps ?? githubDeps();
  return createServer((req, res) => {
    void handleWebhook(req, res, options.secret, deps).catch((err) => {
      console.error("[rextor] webhook handler crashed:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        json(res, { error: "internal error" });
      } else {
        res.end();
      }
    });
  });
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  secretOpt: string | undefined,
  deps: ReviewDeps,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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

  const result: ReviewResult = await runReview(prUrl as string, deps);
  json(res, result);
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
