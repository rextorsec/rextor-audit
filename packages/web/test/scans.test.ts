// SPEC-6 §3 — deep-scan data-layer tests. All seams faked via the fetchImpl
// option (fetchScans) and plain values (isScanRow) — no live network, ever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchScans, isScanRow, type ScanRow } from "@/lib/scans";
import { MAX_RENDERED_ROWS } from "@/lib/reviews";

function row(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    repo: "rextorsec/demo",
    ref: "main",
    head_sha: "ce7f6a9d2b42abcd599537e4abffa33d8760496c",
    status: 0,
    risk_score: 34,
    finding_count: 4,
    created_at: "2026-10-10T19:45:22.000Z",
    ...overrides,
  };
}

function stubFetch(body: unknown | Response, status = 200): typeof fetch {
  return (async () =>
    body instanceof Response ? body : Response.json(body, { status })) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.REXTOR_AGENT_URL = "http://agent.local";
  process.env.REXTOR_AGENT_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isScanRow — trust boundary", () => {
  it("accepts a complete row with a numeric risk score", () => {
    expect(isScanRow(row())).toBe(true);
  });

  it("accepts an INCOMPLETE row whose risk_score is null", () => {
    // The reason risk_score is number | null: a validator demanding a number
    // would silently drop every INCOMPLETE row from the ledger.
    expect(isScanRow(row({ status: 1, risk_score: null, finding_count: 0 }))).toBe(true);
  });

  it("rejects a row whose risk_score is a numeric string", () => {
    expect(isScanRow({ ...row(), risk_score: "34" })).toBe(false);
  });

  it("rejects rows with missing or wrong-typed fields", () => {
    expect(isScanRow({ ...row(), ref: 42 })).toBe(false);
    expect(isScanRow({ ...row(), head_sha: undefined })).toBe(false);
    expect(isScanRow({ ...row(), status: "0" })).toBe(false);
    expect(isScanRow({ ...row(), finding_count: null })).toBe(false);
    expect(isScanRow({ ...row(), created_at: 12345 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isScanRow(null)).toBe(false);
    expect(isScanRow(undefined)).toBe(false);
    expect(isScanRow("ce7f6a9")).toBe(false);
    expect(isScanRow(34)).toBe(false);
  });
});

describe("fetchScans", () => {
  it("requests GET /scans?repo=owner/repo with the token header and a timeout signal", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await fetchScans("rextorsec", "demo", {
      baseUrl: "http://agent.local/",
      token: "tok",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Response.json({ scans: [] });
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, rows: [] });
    expect(calls).toHaveLength(1);
    // Trailing slash stripped from the base; the owner/repo separator stays
    // a literal slash for the service's owner/name parsing.
    expect(calls[0].url).toBe("http://agent.local/scans?repo=rextorsec/demo");
    expect((calls[0].init.headers as Record<string, string>)["X-API-Token"]).toBe("tok");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("URL-encodes hostile owner/repo segments", async () => {
    let url = "";
    await fetchScans("own er", "de:mo", {
      fetchImpl: (async (input: RequestInfo | URL) => {
        url = String(input);
        return Response.json({ scans: [] });
      }) as unknown as typeof fetch,
    });
    expect(url).toBe("http://agent.local/scans?repo=own%20er/de%3Amo");
  });

  it("reports a missing base URL honestly", async () => {
    delete process.env.REXTOR_AGENT_URL;
    const result = await fetchScans("rextorsec", "demo");
    expect(result).toEqual({ ok: false, reason: "REXTOR_AGENT_URL is not configured" });
  });

  it("reports a missing token honestly", async () => {
    delete process.env.REXTOR_AGENT_TOKEN;
    const result = await fetchScans("rextorsec", "demo");
    expect(result).toEqual({ ok: false, reason: "REXTOR_AGENT_TOKEN is not configured" });
  });

  it("reports the index unreachable when the request throws", async () => {
    const result = await fetchScans("rextorsec", "demo", {
      fetchImpl: (async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: "scan index unreachable" });
  });

  it("reports the status code on a non-2xx answer", async () => {
    const result = await fetchScans("rextorsec", "demo", {
      fetchImpl: stubFetch(new Response("nope", { status: 500 })),
    });
    expect(result).toEqual({ ok: false, reason: "scan index answered 500" });
  });

  it("reports invalid JSON", async () => {
    const result = await fetchScans("rextorsec", "demo", {
      fetchImpl: stubFetch(new Response("<html>not json</html>", { status: 200 })),
    });
    expect(result).toEqual({ ok: false, reason: "scan index returned invalid JSON" });
  });

  it("reports an unexpected shape when the payload has no scans array", async () => {
    for (const body of [{}, { scans: "nope" }, [1, 2]]) {
      const result = await fetchScans("rextorsec", "demo", { fetchImpl: stubFetch(body) });
      expect(result).toEqual({ ok: false, reason: "scan index returned an unexpected shape" });
    }
  });

  it("treats an unknown repo's 200 empty scans as a real empty state", async () => {
    const result = await fetchScans("rextorsec", "ghost", {
      fetchImpl: stubFetch({ scans: [] }),
    });
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it("filters malformed rows without failing the whole ledger", async () => {
    const result = await fetchScans("rextorsec", "demo", {
      fetchImpl: stubFetch({
        scans: [row(), { repo: "broken" }, row({ repo: "rextorsec/other" })],
      }),
    });
    if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
    expect(result.rows.map((r) => r.repo)).toEqual(["rextorsec/demo", "rextorsec/other"]);
  });

  it("caps rendered rows at MAX_RENDERED_ROWS", async () => {
    const scans = Array.from({ length: MAX_RENDERED_ROWS + 20 }, (_, i) =>
      row({ repo: `rextorsec/repo-${i}` }),
    );
    const result = await fetchScans("rextorsec", "demo", { fetchImpl: stubFetch({ scans }) });
    if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
    expect(result.rows).toHaveLength(MAX_RENDERED_ROWS);
  });
});
