import { describe, it, expect } from "vitest";
import { githubDeps } from "../src/github";

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
    // Full sequence: init → fetch → checkout → rev-parse.
    expect(gitCalls.map((a) => (a[0] === "-C" ? a[2] : a[0]))).toEqual([
      "init", "fetch", "checkout", "rev-parse",
    ]);
  });
});

describe("github adapter default deps", () => {
  it("constructs with the SPEC-2 triage dep wired (env-driven, per-call)", () => {
    const deps = githubDeps({ token: () => "t" });
    expect(typeof deps.triage).toBe("function");
  });
});
