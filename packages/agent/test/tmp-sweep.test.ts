// tmp-sweep — leaked run-dir reclamation: shape matching (mkdtemp-exact, not
// prefix), age gate, multi-root sweep with dedup, and best-effort error
// collection. Both roots are fixture dirs: simTmpBase() is redirected via
// REXTOR_SIM_TMP_DIR and the legacy root is injected — these tests must never
// be able to touch the real home dir or the real sim base.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_AGE_MS, sweepRoots, sweepStaleTmpDirs, TMP_DIR_PATTERN } from "../src/tmp-sweep";

async function makeFixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rextor-tmp-sweep-test-"));
}

const bases: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(bases.splice(0).map((b) => rm(b, { recursive: true, force: true })));
});

async function staleDir(root: string, name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  // A killed run's dir carries its death time; any past mtime works.
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(dir, old, old);
  return dir;
}

describe("TMP_DIR_PATTERN", () => {
  it("matches the exact mkdtemp product shape", () => {
    expect(TMP_DIR_PATTERN.test("rextor-scan-Ab12Cd")).toBe(true);
    expect(TMP_DIR_PATTERN.test("rextor-review-ZZ9zZ9")).toBe(true);
    expect(TMP_DIR_PATTERN.test("rextor-sim-Qq1w2E")).toBe(true);
  });
  it("rejects prefix look-alikes so real content dirs are out of the blast radius", () => {
    expect(TMP_DIR_PATTERN.test("rextor-t1-venv")).toBe(false); // real tool env
    expect(TMP_DIR_PATTERN.test("rextor-ffi-probe")).toBe(false); // hand-named scratch
    expect(TMP_DIR_PATTERN.test("rextor-proto-poc-real")).toBe(false);
    expect(TMP_DIR_PATTERN.test("rextor-scan-abc12")).toBe(false); // 5-char suffix
    expect(TMP_DIR_PATTERN.test("rextor-scan-abc1234")).toBe(false); // 7-char suffix
    expect(TMP_DIR_PATTERN.test("rextor-scan-db-ab12cd")).toBe(false); // infix (test-store dirs)
    expect(TMP_DIR_PATTERN.test("rextor-scan-")).toBe(false);
  });
});

describe("sweepRoots", () => {
  it("dedups the sim base against the legacy root", async () => {
    const base = await makeFixture();
    bases.push(base);
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    expect(sweepRoots(base)).toEqual([base]);
  });
});

describe("sweepStaleTmpDirs", () => {
  it("removes stale shaped dirs and keeps fresh ones, wrong shapes, and files", async () => {
    const base = await makeFixture();
    bases.push(base);
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    const legacy = await makeFixture();
    bases.push(legacy);
    const gone = await staleDir(base, "rextor-scan-Aa1Bb2");
    const fresh = join(base, "rextor-review-Cc3Dd4");
    await mkdir(fresh);
    const wrongShape = await staleDir(base, "rextor-t1-venv");
    const wrongSuffix = await staleDir(base, "rextor-sim-abc1234");
    const asFile = join(base, "rextor-scan-Ee5Ff6");
    await writeFile(asFile, "not a dir");
    const legacyGone = await staleDir(legacy, "rextor-review-Gg7Hh8");

    const swept = await sweepStaleTmpDirs({ legacyRoot: legacy });

    expect(swept.removed.sort()).toEqual([gone, legacyGone].sort());
    expect(swept.errors).toEqual([]);
    // Survivors: stat rejects (ENOENT) if the sweep removed them.
    await expect(stat(fresh)).resolves.toBeTruthy();
    await expect(stat(wrongShape)).resolves.toBeTruthy();
    await expect(stat(wrongSuffix)).resolves.toBeTruthy();
  });

  it("scans both roots once when they coincide (no double-count)", async () => {
    const base = await makeFixture();
    bases.push(base);
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    await staleDir(base, "rextor-scan-Ii9Jj0");

    const swept = await sweepStaleTmpDirs({ legacyRoot: base });

    expect(swept.scanned).toBe(1);
    expect(swept.removed).toHaveLength(1);
  });

  it("respects the age gate exactly at the boundary and honors injected now", async () => {
    const base = await makeFixture();
    bases.push(base);
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    const dir = join(base, "rextor-sim-Kk1Ll2");
    await mkdir(dir);
    const mtime = new Date("2026-01-01T00:00:00Z");
    await utimes(dir, mtime, mtime);
    const mtimeMs = mtime.getTime();

    // Exactly maxAge old → kept (a live-ish dir is never collateral).
    const kept = await sweepStaleTmpDirs({ legacyRoot: base, maxAgeMs: DEFAULT_MAX_AGE_MS, now: mtimeMs + DEFAULT_MAX_AGE_MS });
    expect(kept.removed).toEqual([]);
    // One tick older → removed.
    const gone = await sweepStaleTmpDirs({ legacyRoot: base, maxAgeMs: DEFAULT_MAX_AGE_MS, now: mtimeMs + DEFAULT_MAX_AGE_MS + 1 });
    expect(gone.removed).toEqual([dir]);
  });

  it("never throws: missing roots are skipped and per-dir errors are collected", async () => {
    const base = await makeFixture();
    bases.push(base);
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    const missing = join(base, "does-not-exist");

    const swept = await sweepStaleTmpDirs({ legacyRoot: missing });

    expect(swept).toEqual({ scanned: 0, removed: [], errors: [] });
  });
});
