// Logger contract: one JSON line per event to stdout, ordered
// ts/level/event/msg/…fields/err; err serialization policy (Error →
// {name, message}, stack strictly opt-in, pre-extracted message strings stay
// message-only — the feedback discipline); threshold filtering via
// REXTOR_LOG_LEVEL read at emit time.
import { afterEach, describe, expect, it, vi } from "vitest";
import { logDebug, logError, logInfo, logLevel, logWarn } from "../src/logger";

// Shape the logger itself writes; unknown extras are the flattened fields.
interface LogLine {
  [key: string]: unknown;
  ts: string;
  level: string;
  event: string;
  msg: string;
}

// Shared test seam: captures the logger's stdout writes, exposing both the
// raw lines (write count, key order) and their parsed JSON.
function capture() {
  const raw: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    raw.push(String(chunk));
    return true;
  });
  function lines(): LogLine[] {
    const parsed: LogLine[] = [];
    for (const s of raw) {
      try {
        // Only the logger writes during a capture window; a non-JSON line is
        // foreign stdout noise, not a log event.
        parsed.push(JSON.parse(s) as LogLine);
      } catch {
        // ignore foreign output
      }
    }
    return parsed;
  }
  return { spy, raw, lines };
}

describe("JSON line shape", () => {
  it("emits one newline-terminated JSON line with ts/level/event/msg first, fields flattened", () => {
    const { raw, lines } = capture();
    logInfo("webhook.review_started", "review started: https://github.com/o/r/pull/9", {
      label: "https://github.com/o/r/pull/9",
      deliveryId: "d-1",
    });
    expect(raw).toHaveLength(1);
    expect(raw[0].endsWith("\n")).toBe(true);
    const [line] = lines();
    expect(Object.keys(line).slice(0, 4)).toEqual(["ts", "level", "event", "msg"]);
    expect(line.level).toBe("info");
    expect(line.event).toBe("webhook.review_started");
    expect(line.msg).toBe("review started: https://github.com/o/r/pull/9");
    expect(line.label).toBe("https://github.com/o/r/pull/9");
    expect(line.deliveryId).toBe("d-1");
    // ts is ISO-8601 (recomputable wall clock).
    expect(Number.isNaN(Date.parse(line.ts))).toBe(false);
  });

  it("fields come before err", () => {
    const { lines } = capture();
    logError("webhook.review_failed", "queued review failed:", new Error("boom"), { deliveryId: "d-2" });
    const [line] = lines();
    const keys = Object.keys(line);
    expect(keys.indexOf("deliveryId")).toBeLessThan(keys.indexOf("err"));
    expect(keys[keys.length - 1]).toBe("err");
  });
});

describe("err serialization policy", () => {
  it("an Error serializes to {name, message} — never a stack by default", () => {
    const { lines } = capture();
    logError("review.triage_failed", "triage failed:", new TypeError("no JSON array"));
    const [line] = lines();
    expect(line.err).toEqual({ name: "TypeError", message: "no JSON array" });
  });

  it("stack rides only behind the explicit flag (sites that always logged the full error)", () => {
    const err = new Error("ebusy");
    const { lines } = capture();
    logError("review.clone_cleanup_failed", "clone cleanup failed:", err, undefined, { stack: true });
    const [line] = lines();
    expect(line.err).toEqual({ name: "Error", message: "ebusy", stack: err.stack });
  });

  it("a string err is an already-extracted message: message-only, no name, no stack", () => {
    const { lines } = capture();
    logError("chain.feedback_submit_failed", "feedback submit failed:", "gas spike");
    const [line] = lines();
    expect(line.err).toEqual({ message: "gas spike" });
  });

  it("a non-Error throwable serializes message-only", () => {
    const { lines } = capture();
    logError("review.setup_failed", "github setup failed:", 42);
    const [line] = lines();
    expect(line.err).toEqual({ message: "42" });
  });

  it("no err argument → no err key at all", () => {
    const { lines } = capture();
    logError("http.store_missing", "REXTOR_DB_PATH is not configured");
    const [line] = lines();
    expect(line.err).toBeUndefined();
    expect("err" in line).toBe(false);
  });

  it("logWarn serializes an err like logError; a fields-only warn uses the explicit undefined hole", () => {
    const { lines } = capture();
    logWarn("github.check_run_failed", "check-run post failed:", new Error("422"));
    const [failed] = lines();
    expect(failed.err).toEqual({ name: "Error", message: "422" });
    logWarn("service.watchdog_stall", "review STILL RUNNING", undefined, { label: "u1" });
    const [stalled] = lines().slice(1);
    expect(stalled.label).toBe("u1");
    expect("err" in stalled).toBe(false);
  });
});

describe("REXTOR_LOG_LEVEL threshold filter", () => {
  const prev = process.env.REXTOR_LOG_LEVEL;
  afterEach(() => {
    if (prev === undefined) delete process.env.REXTOR_LOG_LEVEL;
    else process.env.REXTOR_LOG_LEVEL = prev;
    vi.restoreAllMocks();
  });

  it("default (unset) is info: debug suppressed, everything else passes", () => {
    delete process.env.REXTOR_LOG_LEVEL;
    const { raw, lines } = capture();
    logDebug("review.sim_poc_failed", "d");
    logInfo("webhook.review_started", "i");
    logWarn("service.watchdog_stall", "w");
    logError("http.store_missing", "e");
    expect(lines().map((l) => l.level)).toEqual(["info", "warn", "error"]);
    expect(raw).toHaveLength(3); // the suppressed debug line writes NOTHING
  });

  it('"debug" admits debug lines', () => {
    process.env.REXTOR_LOG_LEVEL = "debug";
    const { lines } = capture();
    logDebug("review.sim_poc_failed", "d");
    expect(lines().map((l) => l.level)).toEqual(["debug"]);
  });

  it('"error" filters info and warn', () => {
    process.env.REXTOR_LOG_LEVEL = "error";
    const { raw, lines } = capture();
    logInfo("webhook.review_started", "i");
    logWarn("service.watchdog_stall", "w");
    logError("http.store_missing", "e");
    expect(lines().map((l) => l.level)).toEqual(["error"]);
    expect(raw).toHaveLength(1);
  });

  it("an unrecognized value falls back to info (debug suppressed)", () => {
    process.env.REXTOR_LOG_LEVEL = "LOUD";
    expect(logLevel()).toBe("info");
    const { lines } = capture();
    logDebug("review.sim_poc_failed", "d");
    logInfo("webhook.review_started", "i");
    expect(lines().map((l) => l.level)).toEqual(["info"]);
  });

  it("logLevel() trims and case-folds the env value", () => {
    process.env.REXTOR_LOG_LEVEL = "  WARN ";
    expect(logLevel()).toBe("warn");
  });

  it("the threshold is read at emit time — an env change needs no reimport", () => {
    const { lines } = capture();
    process.env.REXTOR_LOG_LEVEL = "error";
    logInfo("webhook.review_started", "i");
    process.env.REXTOR_LOG_LEVEL = "debug";
    logInfo("webhook.review_started", "i2");
    expect(lines().map((l) => l.msg)).toEqual(["i2"]);
  });
});
