import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  createReviewServer,
  verifySignature,
  type ReviewServerOptions,
} from "../src/server";
import type { ReviewDeps } from "../src/review";

// Fixed HMAC-SHA256 vector (SPEC-1 §4) — body + secret signed with
// `node -e "console.log('sha256=' + require('node:crypto').createHmac('sha256','rextor-test-secret').update(BODY,'utf8').digest('hex'))"`.
const SECRET = "rextor-test-secret";
const BODY =
  '{"action":"opened","number":42,"pull_request":{"html_url":"https://github.com/rextor/demo/pull/42"}}';
const SIGNATURE =
  "sha256=e4045342a62304e2e5bc28904e8924e943ade7b032219c0a9b0e36dbd86d2ebe";

describe("verifySignature", () => {
  it("accepts the fixed HMAC-SHA256 vector", () => {
    expect(verifySignature(BODY, SIGNATURE, SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySignature(`${BODY} `, SIGNATURE, SECRET)).toBe(false);
  });
  it("rejects a wrong prefix", () => {
    expect(verifySignature(BODY, `sha1=${SIGNATURE.slice("sha256=".length)}`, SECRET)).toBe(false);
  });
  it("rejects a signature computed with a different secret", () => {
    expect(verifySignature(BODY, SIGNATURE, "other-secret")).toBe(false);
  });
  it("rejects a malformed signature hex", () => {
    expect(verifySignature(BODY, "sha256=zzzz", SECRET)).toBe(false);
  });
});

// Fully-faked deps — the server tests pin routing/auth, not the analyzer.
const makeFakeDeps = () => {
  const comments: string[] = [];
  const cloned: string[] = [];
  const deps: ReviewDeps = {
    clone: async (prUrl) => {
      cloned.push(prUrl);
      return { dir: "/tmp/fake-repo", headSha: "a".repeat(40) };
    },
    fetchDiff: async () =>
      "diff --git a/src/Vault.sol b/src/Vault.sol\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n pragma solidity ^0.8.24;\n+contract Vault {}",
    runAnalyzer: async () =>
      '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
    postComment: async (_prUrl, body) => {
      comments.push(body);
    },
    dispose: async () => {},
  };
  return { deps, comments, cloned };
};

const post = (
  port: number,
  rawBody: string,
  headers: Record<string, string>,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers, body: rawBody });

const signed = (rawBody: string, secret: string): Record<string, string> => ({
  "content-type": "application/json",
  "x-github-event": "pull_request",
  "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`,
});

async function withServer<T>(
  opts: ReviewServerOptions,
  fn: (port: number) => Promise<T>,
): Promise<T> {
  const server = createReviewServer(opts);
  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
  });
  try {
    return await fn(port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((closeDone) => server.close(() => closeDone()));
  }
}

describe("webhook endpoint", () => {
  it("accepts a signed pull_request.opened and runs exactly one review + comment", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, BODY, signed(BODY, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        commented: true,
        score: 25,
        attestation: { skipped: "attestation not configured" },
      });
    });
    expect(comments).toHaveLength(1);
    expect(cloned).toEqual(["https://github.com/rextor/demo/pull/42"]);
  });

  it("accepts pull_request.synchronize", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const body = BODY.replace('"opened"', '"synchronize"');
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        commented: true,
        score: 25,
        attestation: { skipped: "attestation not configured" },
      });
    });
    expect(comments).toHaveLength(1);
  });

  it("ignores pull_request actions outside opened/synchronize (200, no work)", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const body = BODY.replace('"opened"', '"closed"');
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  it("ignores non-pull_request events (200, no work)", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, BODY, { ...signed(BODY, SECRET), "x-github-event": "push" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  it("rejects a missing signature header with 401 and does no work", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, BODY, {
        "content-type": "application/json",
        "x-github-event": "pull_request",
      });
      expect(res.status).toBe(401);
    });
    expect(comments).toEqual([]);
  });

  it("rejects an invalid signature with 401 and does no work", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, `${BODY} `, signed(BODY, SECRET));
      expect(res.status).toBe(401);
    });
    expect(comments).toEqual([]);
  });

  it("rejects a malformed JSON body with 400 even under a valid signature", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, "not-json", signed("not-json", SECRET));
      expect(res.status).toBe(400);
    });
    expect(comments).toEqual([]);
  });

  it("rejects a pull_request event missing the pull_request object with 400", async () => {
    const { deps } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const body = '{"action":"opened"}';
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(400);
    });
  });

  it("fails closed with 500 when no secret is configured (no 401 masquerade)", async () => {
    const prev = process.env.GITHUB_APP_SECRET;
    delete process.env.GITHUB_APP_SECRET;
    try {
      const { deps, comments } = makeFakeDeps();
      await withServer({ deps }, async (port) => {
        const res = await post(port, BODY, signed(BODY, SECRET));
        expect(res.status).toBe(500);
      });
      expect(comments).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.GITHUB_APP_SECRET = prev;
    }
  });

  it("treats a correctly signed null body as ignorable, not a crash", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, "null", signed("null", SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
  });
});
