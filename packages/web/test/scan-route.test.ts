// POST /api/scan — flag gate, env discipline, per-IP rate limiting with the
// demo-key bypass, status-verbatim proxying, timeout semantics, and the
// no-token-leak guarantee. No live network, ever: global fetch is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST, maxDuration } from "@/app/api/scan/route";
import { resetScanRateLimit } from "@/lib/scan-gate";

const SERVICE_URL = "https://agent.local";
const TOKEN = "rx-test-token-0123456789abcdef";

const SCAN_REPORT = {
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

let savedEnv: Record<string, string | undefined>;

function postRequest(body: unknown): Request {
  return new Request("https://web.local/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubFetchUpstream(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  savedEnv = {
    REXTOR_SCAN_TRIGGER_ENABLED: process.env.REXTOR_SCAN_TRIGGER_ENABLED,
    REXTOR_AGENT_URL: process.env.REXTOR_AGENT_URL,
    REXTOR_AGENT_TOKEN: process.env.REXTOR_AGENT_TOKEN,
    REXTOR_SCAN_DEMO_KEY: process.env.REXTOR_SCAN_DEMO_KEY,
    REXTOR_SCAN_RATE_MAX: process.env.REXTOR_SCAN_RATE_MAX,
  };
  process.env.REXTOR_SCAN_TRIGGER_ENABLED = "1";
  process.env.REXTOR_AGENT_URL = SERVICE_URL;
  process.env.REXTOR_AGENT_TOKEN = TOKEN;
  // Access-control defaults for every test: no demo key, default window max —
  // a test opts in by setting these explicitly. The limiter is in-memory and
  // module-scoped, so it MUST be reset between tests for isolation.
  delete process.env.REXTOR_SCAN_DEMO_KEY;
  delete process.env.REXTOR_SCAN_RATE_MAX;
  resetScanRateLimit();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("POST /api/scan — trigger flag gate", () => {
  it.each([
    ["unset", undefined],
    ["\"0\"", "0"],
    ["\"true\"", "true"],
    ["empty", ""],
  ])("503s without contacting the service when the flag is %s", async (_label, flag) => {
    if (flag === undefined) delete process.env.REXTOR_SCAN_TRIGGER_ENABLED;
    else process.env.REXTOR_SCAN_TRIGGER_ENABLED = flag;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "scan trigger is disabled on this deployment" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/scan — env discipline", () => {
  it("500s honestly when REXTOR_AGENT_URL is missing (never reaching fetch)", async () => {
    delete process.env.REXTOR_AGENT_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "REXTOR_AGENT_URL is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("500s honestly when REXTOR_AGENT_TOKEN is missing (never reaching fetch)", async () => {
    delete process.env.REXTOR_AGENT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "REXTOR_AGENT_TOKEN is not configured" });
    expect(text).not.toContain(TOKEN);
  });
});

describe("POST /api/scan — access control (per-IP rate limit + demo key)", () => {
  const DEMO_KEY = "demo-secret";

  function keyedRequest(url: string, headers: Record<string, string>): Request {
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ repo: "owner/repo" }),
    });
  }

  it("keeps the flag gate FIRST: 503 even when the demo key matches", async () => {
    process.env.REXTOR_SCAN_DEMO_KEY = DEMO_KEY;
    process.env.REXTOR_SCAN_TRIGGER_ENABLED = "0";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      keyedRequest(`https://web.local/api/scan?key=${DEMO_KEY}`, { "x-scan-key": DEMO_KEY }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "scan trigger is disabled on this deployment" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards when enabled with no key while under the per-IP limit", async () => {
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("429s once the per-IP window is exhausted — Retry-After set, service never contacted", async () => {
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    // Default window max is 3 per hour (resolveRateMax fallback): three
    // forwards, then the route answers locally.
    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(200);
    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(200);
    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "too many scans from your address — try again later",
    });
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(3); // the 429 never reached the service
  });

  it("REXTOR_SCAN_RATE_MAX tunes the per-IP window max", async () => {
    process.env.REXTOR_SCAN_RATE_MAX = "1";
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(200);
    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("a valid x-scan-key header bypasses the exhausted limit", async () => {
    process.env.REXTOR_SCAN_DEMO_KEY = DEMO_KEY;
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    for (let i = 0; i < 3; i += 1) {
      expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(200);
    }
    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(429);

    const res = await POST(keyedRequest("https://web.local/api/scan", { "x-scan-key": DEMO_KEY }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 + the keyed forward; the 429 never fetched
  });

  it("a valid ?key= query param bypasses the exhausted limit", async () => {
    process.env.REXTOR_SCAN_DEMO_KEY = DEMO_KEY;
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    for (let i = 0; i < 3; i += 1) {
      await POST(postRequest({ repo: "owner/repo" }));
    }
    expect((await POST(postRequest({ repo: "owner/repo" }))).status).toBe(429);

    const res = await POST(keyedRequest(`https://web.local/api/scan?key=${DEMO_KEY}`, {}));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("a WRONG key is rate limited like everyone else", async () => {
    process.env.REXTOR_SCAN_DEMO_KEY = DEMO_KEY;
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    for (let i = 0; i < 3; i += 1) {
      await POST(keyedRequest("https://web.local/api/scan", { "x-scan-key": "not-the-key" }));
    }
    const res = await POST(
      keyedRequest("https://web.local/api/scan", { "x-scan-key": "not-the-key" }),
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "too many scans from your address — try again later",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("POST /api/scan — status-verbatim proxy (flag on)", () => {
  it("forwards repo/ref to {base}/scan with the token on the upstream request only", async () => {
    const fetchMock = stubFetchUpstream(200, SCAN_REPORT);

    const res = await POST(postRequest({ repo: "owner/repo", ref: "develop" }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SERVICE_URL}/scan`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "X-API-Token": TOKEN,
      "Content-Type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify({ repo: "owner/repo", ref: "develop" }));
    // The token rides upstream only — it never comes back.
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("passes a 200 ScanReport body through untouched", async () => {
    stubFetchUpstream(200, SCAN_REPORT);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(SCAN_REPORT);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(text).not.toContain(TOKEN);
  });

  it.each([
    [400, { error: "unsafe ref — not a valid git ref" }],
    [401, { error: "unauthorized" }],
    [409, { error: "scan already in progress" }],
    [413, { error: "payload too large" }],
    [500, { error: "misconfigured" }],
  ])("passes service %i through with its body verbatim", async (status, body) => {
    stubFetchUpstream(status, body);

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(body);
    expect(text).not.toContain(TOKEN);
  });
});

describe("POST /api/scan — degradation honesty", () => {
  it("maps an upstream timeout to a 504 pointing at the ledger, not a fake failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: "scan still running server-side — check the scans ledger",
    });
  });

  it("maps a generic upstream network failure to an honest 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const res = await POST(postRequest({ repo: "owner/repo" }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "scan service unreachable" });
  });
});

describe("POST /api/scan — function-cap contract", () => {
  it("declares a 300s max duration (290s upstream timeout + response headroom)", () => {
    expect(maxDuration).toBe(300);
  });
});
