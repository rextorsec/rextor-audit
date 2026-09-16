import { describe, it, expect } from "vitest";
import { githubDeps } from "../src/github";

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
          return;
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
    // Fetch failed → checkout must never have run.
    expect(gitCalls).toHaveLength(2);
  });
});

describe("github adapter default deps", () => {
  it("constructs with the SPEC-2 triage dep wired (env-driven, per-call)", () => {
    const deps = githubDeps({ token: () => "t" });
    expect(typeof deps.triage).toBe("function");
  });
});
