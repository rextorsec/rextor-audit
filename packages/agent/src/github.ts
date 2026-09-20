// Real GitHub + clone adapter producing ReviewDeps. Tests never exercise the
// DEFAULT dependency set (network/filesystem/Docker) — they inject `runGit`,
// `token`, `rmDir`. GITHUB_TOKEN is read at call time (never captured at
// import).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Octokit } from "octokit";
import { createInstallationTokenProvider } from "./app-auth";
import { runAnalyzerContainer, type ReviewDeps } from "./review";
import { generatePocFromEnv, runSimContainer, simTmpBase } from "./sim";
import { makeAttestDep } from "./attest";
import { makeSolanaVerdictDep } from "./solana";
import { makePinDep } from "./ipfs";
import { triageFromEnv } from "./triage";

const execFileP = promisify(execFile);

// A hung git transport must not block the sync webhook handler forever.
const GIT_OPTS = { timeout: 120_000, killSignal: "SIGKILL" as const };

// Week-2 hardening: reviews now run on a background queue, so a hung GitHub
// API call would pin a queue slot forever. Constant of the real adapter —
// the DI seams stay untouched.
const OCTOKIT_TIMEOUT_MS = 15_000;

export interface GithubDepsOptions {
  /** Git runner seam (test injection); default: real `git` with a 120s timeout.
   *  Returns raw stdout (the clone trims it for rev-parse). */
  runGit?: (args: string[]) => Promise<string>;
  /** Token source seam; default: env GITHUB_TOKEN, required. */
  token?: () => string;
  /** F5 — App installation-token source for the check-run receipt (checks:
   *  write). Default provider reads the REXTOR_GITHUB_APP_* env triple per
   *  call; unset → resolves null → postCheckRun falls back to `token()`. */
  installationToken?: () => Promise<string | null>;
  /** Directory-removal seam (test injection); default: rm -rf. */
  rmDir?: (dir: string) => Promise<void>;
}

const PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return token;
}

export function prParts(prUrl: string): { owner: string; repo: string; number: number } {
  const match = prUrl.match(PR_URL_RE);
  if (!match) throw new Error(`not a GitHub PR URL: ${prUrl}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function githubDeps(options: GithubDepsOptions = {}): ReviewDeps {
  const runGit =
    options.runGit ??
    (async (args: string[]) => {
      const { stdout } = await execFileP("git", args, GIT_OPTS);
      return stdout;
    });
  const token = options.token ?? requireToken;
  const installationToken = options.installationToken ?? createInstallationTokenProvider();
  const rmDir =
    options.rmDir ?? ((dir: string) => rm(dir, { recursive: true, force: true }));

  return {
    async clone(prUrl: string): Promise<{ dir: string; headSha: string }> {
      const { owner, repo, number } = prParts(prUrl);
      // Same base as the sim overlay (simTmpBase): BOTH containers bind-mount
      // repoDir, and colima (macOS) shares only $HOME — a /tmp clone mounts
      // as an EMPTY /repo inside them, silently turning every live review on
      // macOS into a false INCOMPLETE. REXTOR_SIM_TMP_DIR overrides the base
      // for the clone and the sim overlay alike.
      const dir = await mkdtemp(join(simTmpBase(), "rextor-review-"));
      const t = token();
      try {
        // Fetch by URL without registering a remote: the token is a CLI
        // argument only and never lands in the clone's .git/config.
        const url = `https://x-access-token:${t}@github.com/${owner}/${repo}.git`;
        await runGit(["init", dir]);
        await runGit(["-C", dir, "fetch", "--depth", "1", url, `refs/pull/${number}/head`]);
        await runGit(["-C", dir, "checkout", "--force", "FETCH_HEAD"]);
        // SPEC-4 §3: the attestation record needs the PR head sha — the clone
        // has it locally, so resolve it here (inside the redacting try).
        const headSha = (await runGit(["-C", dir, "rev-parse", "HEAD"])).trim();
        return { dir, headSha };
      } catch (err) {
        // A mid-clone failure must not strand the temp dir, and the thrown
        // message (which the webhook handler logs) must never carry the
        // tokenized URL — redact before surfacing.
        await rmDir(dir).catch(() => {});
        const detail =
          err instanceof Error ? err.message.split(t).join("***") : String(err).split(t).join("***");
        throw new Error(`git clone failed for ${owner}/${repo}#${number}: ${detail}`);
      }
    },

    async fetchDiff(prUrl: string): Promise<string> {
      const { owner, repo, number } = prParts(prUrl);
      const octokit = new Octokit({ auth: token(), request: { timeout: OCTOKIT_TIMEOUT_MS } });
      const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: number,
        mediaType: { format: "diff" },
      });
      return String(res.data);
    },

    runAnalyzer: runAnalyzerContainer,

    // SPEC-2 default triage: env resolved per call; unset env degrades the
    // review to raw findings under the soft-incomplete banner.
    triage: triageFromEnv(),

    // SPEC-3 fork-sim defaults: PoC generation via the frontier LLM when env
    // is configured (undefined → the stage skips cleanly); the container
    // harness is always wired — without REXTOR_FORK_RPC_URL the stage skips
    // before any docker call is made.
    generatePoc: generatePocFromEnv(),
    runSim: runSimContainer,

    // SPEC-4 attestation default: env-driven at wiring AND call time; env
    // unset → undefined → the review renders "attestation not configured".
    attest: makeAttestDep(),

    // SPEC-8 §5 native Solana verdict default: same env-driven discipline —
    // both keys set at wiring AND call time, else the footer shows the skip.
    attestSolana: makeSolanaVerdictDep(),

    // SPEC-4 v2 (B3): IPFS pin default. JWT unset → undefined → the review
    // attests with findingsURI "" (degraded mode).
    pin: makePinDep(),

    async postComment(prUrl: string, body: string): Promise<string | undefined> {
      const { owner, repo, number } = prParts(prUrl);
      const octokit = new Octokit({ auth: token(), request: { timeout: OCTOKIT_TIMEOUT_MS } });
      const res = await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
      // SPEC-6 §3 — the comment html_url is the review index's comment_url.
      return res.data.html_url ?? undefined;
    },

    // SPEC-7 §1 — rextor.yaml from the PR's BASE branch (the trusted
    // silencing channel, invariant 21). The clone only fetched the PR head,
    // so the base head is fetched shallow here; a missing file is the NORMAL
    // no-config case (null), any other git failure throws (infrastructure —
    // runReview degrades to defaults and logs, never silently half-configures).
    async readBaseConfig(repoDir: string, prUrl: string): Promise<string | null> {
      const { owner, repo, number } = prParts(prUrl);
      const octokit = new Octokit({ auth: token(), request: { timeout: OCTOKIT_TIMEOUT_MS } });
      const pr = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner, repo, pull_number: number,
      });
      const baseRef = pr.data.base.ref;
      const t = token();
      try {
        const url = `https://x-access-token:${t}@github.com/${owner}/${repo}.git`;
        await runGit(["-C", repoDir, "fetch", "--depth", "1", url, `refs/heads/${baseRef}`]);
        const sha = (await runGit(["-C", repoDir, "rev-parse", "FETCH_HEAD"])).trim();
        return await runGit(["-C", repoDir, "show", `${sha}:rextor.yaml`]);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // git's missing-path phrasing ("path ... does not exist in 'sha'" /
        // "exists on disk, but not in") = the base branch has no config yet.
        if (/does not exist in|exists on disk, but not in/.test(detail)) return null;
        throw new Error(detail.split(t).join("***"));
      }
    },

    // SPEC-7 §1 — the merge-gate story: conclusion failure blocks merges
    // under branch protection; neutral marks INCOMPLETE (invariant 24).
    // F5 — auth is the App installation token (checks: write) whenever the
    // REXTOR_GITHUB_APP_* triple is configured; fine-grained PATs cannot hold
    // Checks, so the PAT is only the unconfigured fallback (receipt then
    // fails and the review honestly degrades — never a fake pass).
    async postCheckRun(prUrl, headSha, conclusion, summary) {
      const { owner, repo } = prParts(prUrl);
      const appAuth = await installationToken();
      const octokit = new Octokit({ auth: appAuth ?? token(), request: { timeout: OCTOKIT_TIMEOUT_MS } });
      await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
        owner,
        repo,
        name: "rextor-audit",
        head_sha: headSha,
        conclusion,
        output: { title: "rextor audit", summary },
      });
    },

    async dispose(repoDir: string): Promise<void> {
      await rmDir(repoDir);
    },
  };
}
