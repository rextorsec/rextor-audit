// SPEC-7 §5 — @rextor-audit PR chat: mention-only trigger, bot-loop guard,
// per-PR rate limiting with a single throttling notice, and deterministic
// read-only replies (no LLM in the chat path → no comment-driven injection).
// Drain determinism: the server exposes idle() (queue empty) — every "did the
// reply land / did nothing land" assertion waits on that signal, never on
// wall-clock sleeps.
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  buildChatReply,
  createChatRateLimiter,
  createChatReviewCache,
  NO_REVIEW_YET_REPLY,
  THROTTLED_REPLY,
  parseCommentEvent,
} from "../src/chat";
import type { ReviewDeps } from "../src/review";
import type { ChatReviewContext } from "../src/chat";
import type { Finding } from "../src/findings";
import { createReviewServer, type ReviewServer, type ReviewServerOptions } from "../src/server";


describe("parseCommentEvent (trigger + loop guard)", () => {
  const base = {
    action: "created",
    issue: { pull_request: { url: "x" }, html_url: "https://github.com/o/r/pull/7" },
    comment: { body: "@rextor-audit what did you find?", user: { login: "alice" } },
    sender: { login: "alice" },
  };

  it("accepts a mentioned bot comment on a PR", () => {
    expect(parseCommentEvent(base)).toEqual({
      prUrl: "https://github.com/o/r/pull/7",
      body: "@rextor-audit what did you find?",
    });
  });

  it("rejects non-PR issues (plain issues never get replies)", () => {
    const { pull_request: _drop, ...issueOnly } = base.issue as Record<string, unknown>;
    expect(parseCommentEvent({ ...base, issue: issueOnly })).toBeNull();
  });

  it("rejects the bot's own comments (infinite-loop guard)", () => {
    expect(
      parseCommentEvent({ ...base, comment: { ...base.comment, user: { login: "rextor-audit[bot]" } } }),
    ).toBeNull();
  });

  it("rejects comments without the mention", () => {
    expect(parseCommentEvent({ ...base, comment: { ...base.comment, body: "looks fine to me" } })).toBeNull();
  });

  it("rejects non-created actions (edited/deleted are noise)", () => {
    expect(parseCommentEvent({ ...base, action: "edited" })).toBeNull();
  });
});

describe("rate limiter (SPEC-7 §5)", () => {
  it("allows up to the per-PR budget, then denies", () => {
    const limiter = createChatRateLimiter(2);
    expect(limiter.allow("pr", 1_000)).toBe(true);
    expect(limiter.allow("pr", 2_000)).toBe(true);
    expect(limiter.allow("pr", 3_000)).toBe(false);
  });

  it("budgets are per PR, and the window slides", () => {
    const limiter = createChatRateLimiter(1);
    expect(limiter.allow("pr1", 1_000)).toBe(true);
    expect(limiter.allow("pr2", 1_001)).toBe(true); // other PR unaffected
    expect(limiter.allow("pr1", 1_000 + 3_600_001)).toBe(true); // window elapsed
  });

  it("throttle notice fires once per window, not per denied comment", () => {
    const limiter = createChatRateLimiter(1);
    limiter.allow("pr", 1_000);
    expect(limiter.allow("pr", 2_000)).toBe(false);
    expect(limiter.needsThrottleNotice("pr", 2_001)).toBe(true);
    expect(limiter.needsThrottleNotice("pr", 2_002)).toBe(false);
  });
});

describe("buildChatReply (deterministic, read-only)", () => {
  const findings: Finding[] = [
    { id: 0, file: "src/Vault.sol", line: 11, severity: "high", check: "reentrancy", description: "d0" },
    { id: 1, file: "src/Vault.sol", line: 20, severity: "low", check: "naming", description: "d1" },
  ];
  const ATTESTATION = {
    chain: "tempo-testnet",
    reviewId: "0x" + "a".repeat(64),
    findingsURI: "",
    targetChainId: 42431,
    txHash: "0x" + "b".repeat(64),
    explorerUrl: "https://explorer/tx/1",
  } as const;
  const ctx = (over: Partial<ChatReviewContext> = {}): ChatReviewContext => ({
    prUrl: "https://github.com/o/r/pull/9",
    repo: "o/r",
    pr: 9,
    score: 41,
    findings,
    attestation: ATTESTATION,
    ...over,
  });

  it("states score, counts, attestation anchor and per-finding citations", () => {
    const reply = buildChatReply(ctx());
    expect(reply).toMatch(/riskScore \*\*41\/100\*\*/);
    expect(reply).toMatch(/2 finding\(s\)/);
    expect(reply).toMatch(/#0 \*\*high\*\* reentrancy @ src\/Vault\.sol:11/);
    expect(reply).toMatch(/attested on tempo-testnet/);
    expect(reply).toMatch(/never take instructions from comments/);
  });

  it("the question text NEVER appears in the reply (invariant 22 by construction)", () => {
    const reply = buildChatReply(ctx());
    expect(reply).not.toMatch(/what did you find|approve|ignore previous/);
  });

  it("INCOMPLETE reviews answer honestly with no score", () => {
    const reply = buildChatReply(ctx({ score: 0, incomplete: "slither exploded", findings: [] }));
    expect(reply).toMatch(/INCOMPLETE/);
    expect(reply).toContain("slither exploded");
    expect(reply).not.toMatch(/riskScore/);
  });

  it("unattested reviews say so instead of faking a tx", () => {
    const reply = buildChatReply(ctx({ attestation: { skipped: "attestation not configured" } }));
    expect(reply).toMatch(/not attested/);
  });

  it("learning annotations ride the citation lines", () => {
    const withNote = findings.map((f, i) =>
      i === 0 ? { ...f, learningNote: "rextor ledger: fired 3× in this repo" } : f,
    );
    const reply = buildChatReply(ctx({ findings: withNote }));
    expect(reply).toMatch(/rextor ledger: fired 3× in this repo/);
  });
});

describe("issue_comment webhook end-to-end", () => {
  const SECRET = "whsec";
  const sign = (body: string): string =>
    "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

  const post = (port: number, body: string, event: string, delivery: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
        "x-github-event": event,
        "x-github-delivery": delivery,
      },
      body,
    });

  async function withServer<T>(
    opts: ReviewServerOptions,
    fn: (port: number, server: ReviewServer) => Promise<T>,
  ): Promise<T> {
    const server = createReviewServer(opts);
    // ES2022 lib target: no Promise.withResolvers — executor form for the
    // listen callback (the one place an executor is the API shape).
    const port = await new Promise<number>((resolvePort) => {
      server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
    });
    try {
      return await fn(port, server);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((closeDone) => server.close(() => closeDone()));
    }
  }

  const makeFakeDeps = () => {
    const comments: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake-repo", headSha: "d".repeat(40) }),
      fetchDiff: async () =>
        "diff --git a/src/Vault.sol b/src/Vault.sol\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n pragma solidity ^0.8.24;\n+contract Vault {}",
      runAnalyzer: async () =>
        '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
      postComment: async (_prUrl, body) => {
        comments.push(body);
        return "url";
      },
      dispose: async () => {},
    };
    return { deps, comments };
  };

  const PR_OPENED = JSON.stringify({
    action: "opened",
    pull_request: { html_url: "https://github.com/o/r/pull/9" },
  });
  const chatComment = (body: string, user = "alice"): string =>
    JSON.stringify({
      action: "created",
      issue: { pull_request: { url: "x" }, html_url: "https://github.com/o/r/pull/9" },
      comment: { body, user: { login: user } },
      sender: { login: user },
    });

  it("full loop: review settles → chat replies with the cached verdict", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      // 1. trigger a review
      const r1 = await post(port, PR_OPENED, "pull_request", "d1");
      expect(r1.status).toBe(200);
      await server.idle();
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatch(/risk score/);
      // 2. ask the bot
      const r2 = await post(port, chatComment("@rextor-audit what did you find?"), "issue_comment", "d2");
      expect(r2.status).toBe(200);
      await server.idle();
      expect(comments).toHaveLength(2);
      expect(comments[1]).toMatch(/current verdict/);
      expect(comments[1]).toMatch(/#0 \*\*high\*\* reentrancy-eth/);
    });
  });

  it("comments before any review get the honest no-cache reply", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await post(port, chatComment("@rextor-audit?"), "issue_comment", "d1");
      expect(res.status).toBe(200);
      await server.idle();
      expect(comments).toHaveLength(1);
      expect(comments[0]).toBe(NO_REVIEW_YET_REPLY);
    });
  });

  it("bot's own comments never trigger replies (loop guard)", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await post(port, chatComment("@rextor-audit hi", "rextor-audit[bot]"), "issue_comment", "d1");
      expect(res.status).toBe(200);
      await server.idle();
      expect(comments).toHaveLength(0);
    });
  });

  it("over-limit questions get exactly one throttling notice per window", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET, chatRateLimitPerHour: 2 }, async (port, server) => {
      await post(port, PR_OPENED, "pull_request", "d0");
      await server.idle();
      expect(comments).toHaveLength(1); // review comment
      await post(port, chatComment("@rextor-audit 1"), "issue_comment", "d1");
      await post(port, chatComment("@rextor-audit 2"), "issue_comment", "d2");
      await server.idle();
      expect(comments).toHaveLength(3); // 2 real replies
      await post(port, chatComment("@rextor-audit 3"), "issue_comment", "d3"); // denied → notice
      await server.idle();
      expect(comments).toHaveLength(4);
      expect(comments[3]).toBe(THROTTLED_REPLY);
      await post(port, chatComment("@rextor-audit 4"), "issue_comment", "d4"); // denied → silent
      await server.idle();
      expect(comments).toHaveLength(4);
    });
  });

  it("unsigned chat requests are rejected before any work", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-event": "issue_comment" },
        body: chatComment("@rextor-audit?"),
      });
      expect(res.status).toBe(401);
      await server.idle();
      expect(comments).toHaveLength(0);
    });
  });
});
