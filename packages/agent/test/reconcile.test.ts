// C1 — boot-time delivery reconciliation. GitHub does NOT auto-redeliver
// failed webhook deliveries, so any delivery answered 503 mid-drain (or lost
// to a crash after the ACK) would be silent loss. At boot the service lists
// its app webhook's recent deliveries with the App JWT and re-drives the
// FAILED ones via POST /app/hook/deliveries/{id}/attempts — the redelivery
// replays through the normal webhook path, where the persistent-index guard
// (server.ts) prevents duplicate reviews. Best-effort by doctrine: every
// failure logs a skip and boot continues; bounded to the most recent page
// (≤100). All I/O faked — no live GitHub calls.
import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  reconcileFailedDeliveries,
  reconciliationDisabledReason,
  RECONCILE_PAGE_SIZE,
} from "../src/reconcile";

// signAppJwt really signs (RS256), so the tests mint a throwaway RSA key.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const APP_ENV = { REXTOR_GITHUB_APP_ID: "1234", REXTOR_GITHUB_APP_PEM_PATH: "/tmp/app.pem" };

const delivery = (id: number, status: string) => ({
  id,
  guid: `guid-${id}`,
  delivered_at: "2026-09-23T00:00:00Z",
  redelivery: false,
  duration_ms: 3,
  status,
  status_code: status === "ok" ? 200 : 503,
  event: "pull_request",
  action: "opened",
  installation_id: 1,
  repository_id: 9,
  throttled_at: null,
});

function fakeFetch(deliveries: unknown[], redeliverStatus: Map<number, number> = new Map(), failIds: Set<number> = new Set()) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/hook/deliveries?")) {
      if (failIds.has(0)) throw new Error("list blew up");
      return new Response(JSON.stringify(deliveries), { status: 200 });
    }
    const m = u.match(/\/hook\/deliveries\/(\d+)\/attempts$/);
    if (m) {
      const id = Number(m[1]);
      if (failIds.has(id)) throw new Error(`redeliver ${id} blew up`);
      const status = redeliverStatus.get(id) ?? 202;
      return new Response(status === 202 ? "{}" : "nope", { status });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("reconciliationDisabledReason", () => {
  it("off kills the feature by name", () => {
    expect(reconciliationDisabledReason({ REXTOR_RECONCILE_DELIVERIES: "off" })).toMatch(/REXTOR_RECONCILE_DELIVERIES=off/);
  });
  it("unset App JWT env is a named skip", () => {
    expect(reconciliationDisabledReason({})).toMatch(/REXTOR_GITHUB_APP_ID/);
  });
  it("App id + PEM path set → enabled", () => {
    expect(reconciliationDisabledReason(APP_ENV)).toBeUndefined();
  });
});

describe("reconcileFailedDeliveries", () => {
  it("re-drives only FAILED deliveries through the attempts endpoint", async () => {
    const { calls, fetchFn } = fakeFetch([delivery(1, "ok"), delivery(2, "failed"), delivery(3, "failed")]);
    const outcome = await reconcileFailedDeliveries({ fetchFn, env: APP_ENV, pemReader: () => PEM });
    expect(outcome).toEqual({ redriven: 2, failed: 0 });
    const list = calls.filter((c) => c.url.includes("/hook/deliveries?"));
    expect(list).toHaveLength(1);
    expect(list[0].url).toContain("per_page=100");
    expect((list[0].init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    const posts = calls.filter((c) => /attempts$/.test(c.url));
    expect(posts.map((p) => p.url)).toEqual([
      "https://api.github.com/app/hook/deliveries/2/attempts",
      "https://api.github.com/app/hook/deliveries/3/attempts",
    ]);
    expect(posts.every((p) => p.init?.method === "POST")).toBe(true);
  });

  it("is bounded to the most recent page: one GET, at most 100 re-drives", async () => {
    const many = Array.from({ length: 140 }, (_, i) => delivery(i + 1, "failed"));
    const { calls, fetchFn } = fakeFetch(many);
    const outcome = await reconcileFailedDeliveries({ fetchFn, env: APP_ENV, pemReader: () => PEM });
    expect(calls.filter((c) => c.url.includes("/hook/deliveries?"))).toHaveLength(1);
    expect(outcome.redriven).toBe(RECONCILE_PAGE_SIZE);
  });

  it("REXTOR_RECONCILE_DELIVERIES=off → zero API calls, named skip", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { calls, fetchFn } = fakeFetch([delivery(1, "failed")]);
    const outcome = await reconcileFailedDeliveries({
      fetchFn,
      env: { ...APP_ENV, REXTOR_RECONCILE_DELIVERIES: "off" },
      pemReader: () => PEM,
    });
    expect(calls).toEqual([]);
    expect(outcome.skipped).toMatch(/REXTOR_RECONCILE_DELIVERIES=off/);
    log.mockRestore();
  });

  it("a failed list call is a logged skip that resolves (boot never blocks or crashes)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchFn } = fakeFetch([], new Map(), new Set([0])); // id 0 = fail the LIST
    const outcome = await reconcileFailedDeliveries({ fetchFn, env: APP_ENV, pemReader: () => PEM });
    expect(outcome.redriven).toBe(0);
    expect(outcome.skipped).toBeDefined();
    errSpy.mockRestore();
  });

  it("a failed redeliver is a logged skip; the remaining deliveries still re-drive", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, fetchFn } = fakeFetch(
      [delivery(1, "failed"), delivery(2, "failed")],
      new Map([[1, 422]]),
    );
    const outcome = await reconcileFailedDeliveries({ fetchFn, env: APP_ENV, pemReader: () => PEM });
    expect(outcome).toEqual({ redriven: 1, failed: 1 });
    expect(calls.filter((c) => /attempts$/.test(c.url))).toHaveLength(2); // both attempted
    errSpy.mockRestore();
  });

  it("a thrown redeliver is a logged skip; the remaining deliveries still re-drive", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchFn } = fakeFetch(
      [delivery(1, "failed"), delivery(2, "failed")],
      new Map(),
      new Set([1]),
    );
    const outcome = await reconcileFailedDeliveries({ fetchFn, env: APP_ENV, pemReader: () => PEM });
    expect(outcome).toEqual({ redriven: 1, failed: 1 });
    errSpy.mockRestore();
  });

  it("a bad PEM path is a logged skip, not a crash", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, fetchFn } = fakeFetch([delivery(1, "failed")]);
    const outcome = await reconcileFailedDeliveries({
      fetchFn,
      env: APP_ENV,
      pemReader: () => {
        throw new Error("no such file");
      },
    });
    expect(calls).toEqual([]);
    expect(outcome.skipped).toBeDefined();
    errSpy.mockRestore();
  });
});

describe("reconcile × skip list (permanently unrecoverable deliveries)", () => {
  it("skipped delivery ids are never re-driven", async () => {
    const deliveries = [
      { id: 1, guid: "uuid-a", status: "failed" },
      { id: 2, guid: "uuid-b", status: "failed" },
      { id: 3, guid: "uuid-c", status: "ok" },
    ];
    const attempts: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      const u = String(url);
      if (u.includes("/app/hook/deliveries?")) {
        return new Response(JSON.stringify(deliveries), { status: 200 });
      }
      attempts.push(u);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const outcome = await reconcileFailedDeliveries({
      fetchFn,
      env: APP_ENV,
      pemReader: () => PEM,
      skipList: { has: (id) => id === "uuid-a" },
    });
    expect(outcome.redriven).toBe(1); // only uuid-b
    expect(attempts.every((u) => u.includes("/2/attempts"))).toBe(true);
  });
});
