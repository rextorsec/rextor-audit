// Analyzer stage (SPEC-1 §1): runs the analyzer container over the cloned PR
// repo and returns its NDJSON stdout, or throws AnalyzerFailedError.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

export class AnalyzerFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerFailedError";
  }
}

const execFileP = promisify(execFile);
const ANALYZER_IMAGE = "rextor/analyzer";
// Analyzer wall-clock budget; a hang must surface as INCOMPLETE, not block the
// sync webhook handler forever (a SIGKILLed docker run cannot outlive this).
const ANALYZER_TIMEOUT_MS = 150_000;

/**
 * Real analyzer runner: the PR repo is mounted READ-ONLY and analyzed inside a
 * no-network, capability-less, resource-limited container (SPEC-1 invariant 3:
 * PR content is untrusted input — its build config executes, so the walls must
 * hold). A container exit is final and judged strictly (exit 3 → stdout is the
 * incomplete report, normalization owns the reason); only status-less CLI
 * failures (shared-daemon churn, cf. analyzer.contract.test.ts) are retried.
 */
export async function runAnalyzerContainer(repoDir: string): Promise<string> {
  const mount = `${resolve(repoDir)}:/repo:ro`;
  let lastMessage = "docker CLI never completed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP(
        "docker",
        [
          "run", "--rm",
          "--network", "none",
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          "--memory", "2g",
          "--cpus", "2",
          "-v", mount,
          ANALYZER_IMAGE,
        ],
        { maxBuffer: 32 * 1024 * 1024, timeout: ANALYZER_TIMEOUT_MS, killSignal: "SIGKILL" },
      );
      return stdout;
    } catch (err) {
      const e = err as {
        killed?: boolean; signal?: string | null;
        code?: number | string | null; status?: number | null;
        stdout?: unknown; stderr?: unknown; message?: string;
      };
      if (e?.killed) {
        // Timeout kill: fatal immediately — retrying a hung container just
        // burns 3× the budget before the same INCOMPLETE.
        throw new AnalyzerFailedError(`analyzer timed out after ${ANALYZER_TIMEOUT_MS}ms (SIGKILLed)`);
      }
      // promisified execFile reports the child's exit code as `code` (execSync
      // callsites would see `status`); accept both.
      const exitCode = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
      if (exitCode !== undefined) {
        if (exitCode === 3) {
          // Contract: exit 3 → stdout is the incomplete report; normalization
          // owns the reason. Empty stdout here would masquerade as a clean
          // pass downstream — never return it (SPEC-1 integrity).
          const stdout = String(e.stdout ?? "");
          if (stdout.trim() === "") {
            throw new AnalyzerFailedError("analyzer exited 3 with no incomplete report on stdout");
          }
          return stdout;
        }
        if (exitCode === 125) {
          // docker CLI could not run the container (daemon churn) — transient,
          // retry; a real container exit is never 125.
          lastMessage = e?.message ?? String(err);
          continue;
        }
        // Bounded: unbounded stderr detail can 422 the INCOMPLETE comment
        // into silence (never-silent beats completeness of detail).
        const detail = String(e.stderr ?? e.message ?? "").trim().slice(0, 300);
        throw new AnalyzerFailedError(`analyzer exited ${exitCode}: ${detail}`);
      }
      lastMessage = e?.message ?? String(err);
    }
  }
  throw new AnalyzerFailedError(
    `docker run never produced a container exit (transient daemon failure): ${lastMessage}`,
  );
}
