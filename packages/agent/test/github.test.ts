import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { githubDeps } from "../src/github";
import { simTmpBase } from "../src/sim";

const HEAD_SHA = "971a6ca000000000000000000000000000000000";

// The adapter's DI seams (runGit / token / rmDir) let us pin the failure
// hygiene without touching the network: a mid-clone git failure must remove
// the stranded temp dir and must NEVER surface the tokenized URL in the
// thrown message (the webhook handler logs that message verbatim).
describe("github adapter clone hygiene", () => {
  it("on git failure: removes the clone dir and throws a token-safe error", async () => {
    const TOKEN = "ghs_supersecret123";
    const gitCalls: string[][] = [];
    const removed: string[] = [];
    let cloneDir = "";
    const deps = githubDeps({
      token: () => TOKEN,
      runGit: async (args) => {
        gitCalls.push(args);
        if (args[0] === "init") {
          cloneDir = args[1];
          return "";
        }
        // Fails the way execFile does on the fetch step: the message embeds
        // the tokenized URL.
        throw new Error(
          `Command failed: git -C ${cloneDir} fetch --depth 1 ` +
            `https://x-access-token:${TOKEN}@github.com/rextor/demo.git refs/pull/42/head`,
        );
      },
      rmDir: async (dir) => {
        removed.push(dir);
      },
    });

    let caught: Error | undefined;
    try {
      await deps.clone("https://github.com/rextor/demo/pull/42");
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toContain("git clone failed for rextor/demo#42");
    expect(caught?.message).not.toContain(TOKEN);
    expect(removed).toEqual([cloneDir]);
    // Fetch failed → checkout and rev-parse must never have run.
    expect(gitCalls).toHaveLength(2);
  });

  it("clone resolves the PR head sha via `git -C <dir> rev-parse HEAD` and returns { dir, headSha }", async () => {
    const gitCalls: string[][] = [];
    const deps = githubDeps({
      token: () => "t",
      runGit: async (args) => {
        gitCalls.push(args);
        // The default seam returns raw stdout; the clone trims it.
        return args.includes("rev-parse") ? ` ${HEAD_SHA}\n` : "";
      },
    });
    const res = await deps.clone("https://github.com/rextor/demo/pull/42");
    expect(res.headSha).toBe(HEAD_SHA);
    expect(res.dir).toContain("rextor-review-");
    const revParse = gitCalls.find((a) => a.includes("rev-parse"));
    expect(revParse).toEqual(["-C", res.dir, "rev-parse", "HEAD"]);
    // Full sequence: init → fetch → checkout → submodule init → rev-parse.
    expect(gitCalls.map((a) => (a[0] === "-C" ? a[2] : a[0]))).toEqual([
      "init", "fetch", "checkout", "submodule", "rev-parse",
    ]);
    // Foundry lib/ deps are submodules: the init must be recursive and shallow.
    const sub = gitCalls.find((a) => a.includes("submodule"));
    expect(sub).toEqual([
      "-C", res.dir, "submodule", "update", "--init", "--recursive", "--depth", "1",
    ]);
  });

  it("submodule init failure is best-effort: logged, clone still succeeds", async () => {
    const gitCalls: string[][] = [];
    const deps = githubDeps({
      token: () => "t",
      runGit: async (args) => {
        gitCalls.push(args);
        if (args.includes("submodule")) {
          throw new Error("fatal: remote error: no access to secrets-repo");
        }
        return args.includes("rev-parse") ? HEAD_SHA : "";
      },
    });
    const res = await deps.clone("https://github.com/rextor/demo/pull/42");
    expect(res.headSha).toBe(HEAD_SHA);
    expect(gitCalls.map((a) => (a[0] === "-C" ? a[2] : a[0]))).toEqual([
      "init", "fetch", "checkout", "submodule", "rev-parse",
    ]);
  });
});

describe("github adapter default deps", () => {
  it("constructs with the SPEC-2 triage dep wired (env-driven, per-call)", () => {
    const deps = githubDeps({ token: () => "t" });
    expect(typeof deps.triage).toBe("function");
  });
});

describe("github adapter clone location", () => {
  it("clones under the daemon-bindable base (simTmpBase) so containers see the repo", async () => {
    const deps = githubDeps({
      token: () => "t",
      runGit: async (args) => (args.includes("rev-parse") ? HEAD_SHA : ""),
    });
    const res = await deps.clone("https://github.com/rextor/demo/pull/42");
    try {
      expect(res.dir).toContain("rextor-review-");
      // The clone base must equal the sim overlay base: both containers bind
      // the same repoDir, and a base the daemon cannot share (e.g. /tmp under
      // colima) mounts as an EMPTY /repo — a silent false INCOMPLETE.
      expect(res.dir.startsWith(simTmpBase() + sep)).toBe(true);
    } finally {
      await deps.dispose(res.dir);
    }
  });

  it("REXTOR_SIM_TMP_DIR moves the clone base too (one knob, both mounts)", async () => {
    const base = await mkdtemp(join(tmpdir(), "rextor-clone-base-"));
    vi.stubEnv("REXTOR_SIM_TMP_DIR", base);
    try {
      const deps = githubDeps({
        token: () => "t",
        runGit: async (args) => (args.includes("rev-parse") ? HEAD_SHA : ""),
      });
      const res = await deps.clone("https://github.com/rextor/demo/pull/42");
      try {
        expect(res.dir.startsWith(base + sep)).toBe(true);
      } finally {
        await deps.dispose(res.dir);
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(base, { recursive: true, force: true });
    }
  });
});

// F5 — postComment must decide auth EXACTLY like postCheckRun: App
// installation token when it resolves (the comment posts as
// rextor-audit[bot], not the PAT user), PAT otherwise. The provider seam
// keeps token minting out of the network; a global fetch stub intercepts
// only Octokit's comment call and records its Authorization header.
// (@octokit/auth-token@6 prefixes dotless tokens with `token `, only
// 3-dot JWT-shaped strings get `bearer` — same wire format postCheckRun
// already sends.)
describe("github adapter postComment auth (F5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const COMMENT_URL = "https://github.com/rextor/demo/pull/42#issuecomment-1";

  function stubFetch(calls: Array<{ url: string; init?: RequestInit }>): void {
    const stub = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ html_url: COMMENT_URL }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", stub);
  }

  function authorizationHeader(call: { init?: RequestInit }): string | undefined {
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    return Object.entries(headers).find(([k]) => k.toLowerCase() === "authorization")?.[1];
  }

  it("App token resolves → the comment request authenticates as the installation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    stubFetch(calls);
    const deps = githubDeps({
      token: () => "ghp_pat_token",
      installationToken: async () => "ghs_app_token",
    });

    const url = await deps.postComment("https://github.com/rextor/demo/pull/42", "audit body");

    expect(url).toBe(COMMENT_URL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.url).toContain("/repos/rextor/demo/issues/42/comments");
    expect(authorizationHeader(calls[0]!)).toBe("token ghs_app_token");
    // The PAT must not leak into the request at all.
    expect(JSON.stringify(calls[0]!.init?.headers)).not.toContain("ghp_pat_token");
  });

  it("App unconfigured (provider resolves null) → PAT fallback", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    stubFetch(calls);
    const deps = githubDeps({
      token: () => "ghp_pat_token",
      installationToken: async () => null,
    });

    const url = await deps.postComment("https://github.com/rextor/demo/pull/42", "audit body");

    expect(url).toBe(COMMENT_URL);
    expect(authorizationHeader(calls[0]!)).toBe("token ghp_pat_token");
  });

  it("default provider wiring: env triple unset → no mint request, PAT used", async () => {
    vi.stubEnv("REXTOR_GITHUB_APP_ID", "");
    vi.stubEnv("REXTOR_GITHUB_INSTALLATION_ID", "");
    vi.stubEnv("REXTOR_GITHUB_APP_PEM_PATH", "");
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      stubFetch(calls);
      const deps = githubDeps({ token: () => "ghp_pat_token" });

      const url = await deps.postComment("https://github.com/rextor/demo/pull/42", "audit body");

      expect(url).toBe(COMMENT_URL);
      // Exactly one HTTP call: the comment. The default provider minted nothing.
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/repos/rextor/demo/issues/42/comments");
      expect(authorizationHeader(calls[0]!)).toBe("token ghp_pat_token");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
