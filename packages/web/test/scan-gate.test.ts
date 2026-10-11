// checkScanAccess — demo-key bypass (timing-safe compare), per-IP sliding
// window with retryAfter math, client-IP bucketing, and reset isolation.
// Deterministic by construction: injected clock, reset state per test, no
// timers, no network, no env reads.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SCAN_RATE_MAX,
  SCAN_RATE_WINDOW_MS,
  checkScanAccess,
  resetScanRateLimit,
  resolveRateMax,
  type ScanGateConfig,
  type ScanGateResult,
} from "@/lib/scan-gate";

const DEMO_KEY = "demo-scan-key-0123456789abcdef";
const BASE = 1_700_000_000_000;

let clock: number;
// Injected clock seam — one shared closure so every call site reads the same
// mutable test time.
const nowFn = () => clock;

function gateConfig(overrides: Partial<ScanGateConfig> = {}): ScanGateConfig {
  return { enabled: true, rateMax: DEFAULT_SCAN_RATE_MAX, ...overrides };
}

function scanRequest(headers: Record<string, string> = {}, queryKey?: string): Request {
  const url = new URL("https://web.local/api/scan");
  if (queryKey !== undefined) url.searchParams.set("key", queryKey);
  return new Request(url, { method: "POST", headers });
}

function expectAdmitted(res: ScanGateResult): void {
  expect(res).toEqual({ ok: true });
}

function expectRejected(res: ScanGateResult): void {
  expect(res.ok).toBe(false);
  if (res.ok) return; // narrows for tsc strict
  expect(res.status).toBe(429);
  expect(res.error).toBe("too many scans from your address — try again later");
}

beforeEach(() => {
  clock = BASE;
  resetScanRateLimit();
});

afterEach(() => {
  resetScanRateLimit();
});

describe("frozen contract pins", () => {
  it("keeps the window and default-max constants", () => {
    expect(SCAN_RATE_WINDOW_MS).toBe(3_600_000);
    expect(DEFAULT_SCAN_RATE_MAX).toBe(3);
  });
});

describe("checkScanAccess — demo key bypass", () => {
  it("admits a matching x-scan-key header", () => {
    const res = checkScanAccess(
      scanRequest({ "x-scan-key": DEMO_KEY }),
      gateConfig({ demoKey: DEMO_KEY }),
      nowFn,
    );
    expectAdmitted(res);
  });

  it("admits a matching ?key= query param", () => {
    const res = checkScanAccess(scanRequest({}, DEMO_KEY), gateConfig({ demoKey: DEMO_KEY }), nowFn);
    expectAdmitted(res);
  });

  it("bypasses an already-exhausted bucket via header match", () => {
    const cfg = gateConfig({ demoKey: DEMO_KEY });
    for (let i = 0; i < cfg.rateMax; i++) {
      checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.7" }), cfg, nowFn);
    }
    expectRejected(checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.7" }), cfg, nowFn));

    expectAdmitted(
      checkScanAccess(
        scanRequest({ "x-forwarded-for": "203.0.113.7", "x-scan-key": DEMO_KEY }),
        cfg,
        nowFn,
      ),
    );
  });

  it("bypasses an already-exhausted bucket via ?key= match", () => {
    const cfg = gateConfig({ demoKey: DEMO_KEY });
    for (let i = 0; i < cfg.rateMax; i++) {
      checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.7" }), cfg, nowFn);
    }
    expectRejected(checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.7" }), cfg, nowFn));

    expectAdmitted(checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.7" }, DEMO_KEY), cfg, nowFn));
  });

  it("rate-limits the identical request when no demo key is configured", () => {
    const cfg = gateConfig({ rateMax: 1 });
    const req = scanRequest({ "x-forwarded-for": "203.0.113.9", "x-scan-key": DEMO_KEY });
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectRejected(checkScanAccess(req, cfg, nowFn));
  });
});

describe("checkScanAccess — timing-safe comparison", () => {
  it("does not throw on a wrong-length key", () => {
    const cfg = gateConfig({ demoKey: DEMO_KEY, rateMax: 1 });
    const wrongLength = scanRequest({ "x-scan-key": "x" });
    expect(() => checkScanAccess(wrongLength, cfg, nowFn)).not.toThrow();
  });

  it("does not bypass on a wrong key — the guess spends rate budget instead", () => {
    const cfg = gateConfig({ demoKey: DEMO_KEY, rateMax: 2 });
    const wrongKey = scanRequest({ "x-scan-key": "demo-scan-key-ffffffffffffffff" });
    expectAdmitted(checkScanAccess(wrongKey, cfg, nowFn));
    expectAdmitted(checkScanAccess(wrongKey, cfg, nowFn));
    expectRejected(checkScanAccess(wrongKey, cfg, nowFn));
  });
});

describe("checkScanAccess — sliding-window rate limit", () => {
  it("admits exactly rateMax requests, then rejects with 429 and a ≥1s retry hint", () => {
    const cfg = gateConfig({ rateMax: 3 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.4" });
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectAdmitted(checkScanAccess(req, cfg, nowFn));

    clock += 1000;
    const res = checkScanAccess(req, cfg, nowFn);
    expectRejected(res);
    if (!res.ok) {
      expect(Number.isInteger(res.retryAfterSeconds)).toBe(true);
      expect(res.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("computes retryAfterSeconds from the oldest unexpired hit", () => {
    const cfg = gateConfig({ rateMax: 3 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.5" });
    for (let i = 0; i < cfg.rateMax; i++) checkScanAccess(req, cfg, nowFn);

    clock += 1000;
    const res = checkScanAccess(req, cfg, nowFn);
    if (!res.ok) expect(res.retryAfterSeconds).toBe((SCAN_RATE_WINDOW_MS - 1000) / 1000);
  });

  it("readmits once the window expires", () => {
    const cfg = gateConfig({ rateMax: 1 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.6" });
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectRejected(checkScanAccess(req, cfg, nowFn));

    clock += SCAN_RATE_WINDOW_MS;
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
  });

  it("counts only unexpired hits toward the limit (pruning via public API)", () => {
    const cfg = gateConfig({ rateMax: 2 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.8" });
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectAdmitted(checkScanAccess(req, cfg, nowFn));

    clock += SCAN_RATE_WINDOW_MS + 1;
    expectAdmitted(checkScanAccess(req, cfg, nowFn)); // old pair pruned
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectRejected(checkScanAccess(req, cfg, nowFn)); // only the fresh pair blocks
  });

  it("never re-blocks on pruned timestamps across many windows", () => {
    const cfg = gateConfig({ rateMax: 2 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.10" });
    for (let i = 0; i < 6; i++) {
      expectAdmitted(checkScanAccess(req, cfg, nowFn));
      clock += SCAN_RATE_WINDOW_MS + 1; // each next request sees a fully pruned bucket
    }
  });
});

describe("checkScanAccess — client identity", () => {
  it("shares one bucket across header-less requests (unknown IP)", () => {
    const cfg = gateConfig({ rateMax: 2 });
    expectAdmitted(checkScanAccess(scanRequest(), cfg, nowFn));
    expectAdmitted(checkScanAccess(scanRequest({ "content-type": "application/json" }), cfg, nowFn));
    expectRejected(checkScanAccess(scanRequest(), cfg, nowFn));
  });

  it("buckets unknown separately from identified IPs", () => {
    const cfg = gateConfig({ rateMax: 1 });
    expectAdmitted(checkScanAccess(scanRequest(), cfg, nowFn));
    expectAdmitted(checkScanAccess(scanRequest({ "x-real-ip": "203.0.113.30" }), cfg, nowFn));
  });

  it("uses the first x-forwarded-for hop", () => {
    const cfg = gateConfig({ rateMax: 1 });
    expectAdmitted(
      checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }), cfg, nowFn),
    );
    expectRejected(checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.10" }), cfg, nowFn));
    expectAdmitted(
      checkScanAccess(scanRequest({ "x-forwarded-for": "203.0.113.11, 10.0.0.1" }), cfg, nowFn),
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const cfg = gateConfig({ rateMax: 1 });
    expectAdmitted(checkScanAccess(scanRequest({ "x-real-ip": "203.0.113.20" }), cfg, nowFn));
    expectRejected(checkScanAccess(scanRequest({ "x-real-ip": "203.0.113.20" }), cfg, nowFn));
    expectAdmitted(checkScanAccess(scanRequest({ "x-real-ip": "203.0.113.21" }), cfg, nowFn));
  });
});

describe("resetScanRateLimit", () => {
  it("clears window state so an exhausted bucket is admitted again", () => {
    const cfg = gateConfig({ rateMax: 1 });
    const req = scanRequest({ "x-forwarded-for": "198.51.100.40" });
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
    expectRejected(checkScanAccess(req, cfg, nowFn));

    resetScanRateLimit();
    expectAdmitted(checkScanAccess(req, cfg, nowFn));
  });
});

describe("resolveRateMax", () => {
  it.each([
    ["unset", undefined],
    ["non-numeric", "not-a-number"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("falls back to the default for a %s REXTOR_SCAN_RATE_MAX", (_label, raw) => {
    expect(resolveRateMax(raw)).toBe(DEFAULT_SCAN_RATE_MAX);
  });

  it("parses a positive integer", () => {
    expect(resolveRateMax("5")).toBe(5);
  });
});
