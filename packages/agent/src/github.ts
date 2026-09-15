// Real GitHub + clone adapter producing ReviewDeps. Tests never import this
// module — everything here hits the network, the filesystem, or Docker.
// GITHUB_TOKEN is read at call time (never captured at import).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import { runAnalyzerContainer, type ReviewDeps } from "./review";

const execFileP = promisify(execFile);

// A hung git transport must not block the sync webhook handler forever.
const GIT_OPTS = { timeout: 120_000, killSignal: "SIGKILL" as const };

const PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return token;
}

function prParts(prUrl: string): { owner: string; repo: string; number: number } {
  const match = prUrl.match(PR_URL_RE);
  if (!match) throw new Error(`not a GitHub PR URL: ${prUrl}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function githubDeps(): ReviewDeps {
  return {
    async clone(prUrl: string): Promise<string> {
      const { owner, repo, number } = prParts(prUrl);
      const dir = await mkdtemp(join(tmpdir(), "rextor-review-"));
      // Fetch by URL without registering a remote: the token is a CLI argument
      // only and never lands in the clone's .git/config.
      const url = `https://x-access-token:${requireToken()}@github.com/${owner}/${repo}.git`;
      await execFileP("git", ["init", dir], GIT_OPTS);
      await execFileP("git", ["-C", dir, "fetch", "--depth", "1", url, `refs/pull/${number}/head`], GIT_OPTS);
      await execFileP("git", ["-C", dir, "checkout", "--force", "FETCH_HEAD"], GIT_OPTS);
      return dir;
    },

    async fetchDiff(prUrl: string): Promise<string> {
      const { owner, repo, number } = prParts(prUrl);
      const octokit = new Octokit({ auth: requireToken() });
      const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: number,
        mediaType: { format: "diff" },
      });
      return String(res.data);
    },

    runAnalyzer: runAnalyzerContainer,

    async postComment(prUrl: string, body: string): Promise<void> {
      const { owner, repo, number } = prParts(prUrl);
      const octokit = new Octokit({ auth: requireToken() });
      await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
    },

    async dispose(repoDir: string): Promise<void> {
      await rm(repoDir, { recursive: true, force: true });
    },
  };
}
