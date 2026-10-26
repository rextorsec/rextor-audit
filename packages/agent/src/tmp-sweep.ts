// Leaked run-dir reclamation. Every scan/review/sim run cleans its mkdtemp
// dir in a finally — but finally cannot run under SIGKILL, a hard crash, or a
// dev restart mid-run, so run dirs stranding in simTmpBase() is a structural
// leak, not a bug in any single call site (observed: ~250 residue dirs, Aug–
// Oct 2026). This module reclaims them by shape + age, never by prefix alone.
import { readdir, rm, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { simTmpBase } from "./sim";

/** mkdtemp's exact suffix shape: 6 chars from [A-Za-z0-9]. Matching the full
 *  shape — not just the prefix — is what keeps real content dirs (e.g. a
 *  `~/rextor-t1-venv` tool env, or hand-named `rextor-ffi-probe` scratch) out
 *  of the blast radius, including in the legacy home-root pass. */
export const TMP_DIR_PATTERN = /^rextor-(?:scan|review|sim)-[A-Za-z0-9]{6}$/;

/** Dirs younger than this are presumed live or recent enough to debug. An
 *  active run's dir is seconds old; a run cannot outlive its 240s sim
 *  timeout, so 7 days is comfortably past any live dir. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SweepOptions {
  maxAgeMs?: number;
  /** Overrides the secondary root (default: the home dir — the pre-relocation
   *  darwin sim base). Tests MUST override: the default sweeps the real home
   *  and would destroy real user state. */
  legacyRoot?: string;
  /** Injectable clock for deterministic age tests. */
  now?: number;
}

export interface SweepResult {
  /** Dirs matching the shape that were considered (pre-age-filter). */
  scanned: number;
  removed: string[];
  errors: { dir: string; message: string }[];
}

/** Root pairs: the current sim base + the legacy home root (deduped when they
 *  coincide, e.g. Linux where the base was never the home dir — the home-root
 *  pass is then a harmless no-op). */
export function sweepRoots(legacyRoot?: string): string[] {
  return [...new Set([simTmpBase(), legacyRoot ?? homedir()])];
}

/** Best-effort by contract: per-dir failures are collected, never thrown — a
 *  wedged dir must not stop the rest of the sweep, and boot callers treat the
 *  sweep as fire-and-forget. */
export async function sweepStaleTmpDirs(options: SweepOptions = {}): Promise<SweepResult> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const cutoff = (options.now ?? Date.now()) - maxAgeMs;
  const result: SweepResult = { scanned: 0, removed: [], errors: [] };
  for (const root of sweepRoots(options.legacyRoot)) {
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue; // root missing/unreadable — nothing to sweep there
    }
    for (const entry of entries) {
      if (!TMP_DIR_PATTERN.test(entry.name) || !entry.isDirectory()) continue;
      result.scanned += 1;
      const dir = join(root, entry.name);
      try {
        const st = await stat(dir);
        if (st.mtimeMs >= cutoff) continue; // fresh — presume live
        await rm(dir, { recursive: true, force: true });
        result.removed.push(dir);
      } catch (err) {
        result.errors.push({ dir, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}
