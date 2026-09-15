import { describe, it, expect } from "vitest";
import { scopeDiff } from "../src/diff-scope";

const SOL_DIFF = `diff --git a/contracts/Vault.sol b/contracts/Vault.sol
index 111..222 100644
--- a/contracts/Vault.sol
+++ b/contracts/Vault.sol
@@ -10,4 +10,9 @@ contract Vault {
     function deposit() external payable {}
+    function withdraw() external {}
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+world`;

describe("scopeDiff", () => {
  it("scopes to contract files and records added-line ranges", () => {
    const { contractFiles, hasContractChanges } = scopeDiff(SOL_DIFF);
    expect(hasContractChanges).toBe(true);
    expect(contractFiles.map((f) => f.path)).toEqual(["contracts/Vault.sol"]);
    // Hunk `@@ -10,4 +10,9 @@` starts the new side at line 10; the context line
    // consumes 10, so the single added line lands on line 11 (SPEC-1 §2:
    // ranges are NEW-file line numbers of added lines). The brief's [[14, 14]]
    // predates this fixture's hunk header.
    expect(contractFiles[0].changedLineRanges).toEqual([[11, 11]]);
  });
  it("returns hasContractChanges=false for docs-only diffs", () => {
    // Controller Ruling 4: the brief's dead `.prepend` ternary is dropped;
    // the README-only literal it always evaluated to is used directly.
    const { hasContractChanges, contractFiles } = scopeDiff(
      "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-h\n+w",
    );
    expect(hasContractChanges).toBe(false);
    expect(contractFiles).toEqual([]);
  });
  it("merges contiguous added lines into one range", () => {
    const { contractFiles } = scopeDiff(
      [
        "diff --git a/contracts/A.sol b/contracts/A.sol",
        "--- a/contracts/A.sol",
        "+++ b/contracts/A.sol",
        "@@ -1,3 +1,7 @@",
        " ctx",
        "+a",
        "+b",
        "+c",
        " ctx2",
      ].join("\n"),
    );
    expect(contractFiles[0].changedLineRanges).toEqual([[2, 4]]);
  });
  it("keeps separated added runs as distinct ranges", () => {
    const { contractFiles } = scopeDiff(
      [
        "diff --git a/contracts/A.sol b/contracts/A.sol",
        "--- a/contracts/A.sol",
        "+++ b/contracts/A.sol",
        "@@ -1,5 +1,7 @@",
        " ctx",
        "+a",
        " ctx",
        " ctx",
        "+b",
      ].join("\n"),
    );
    expect(contractFiles[0].changedLineRanges).toEqual([[2, 2], [5, 5]]);
  });
  it("flags deletion-only contract hunks with empty ranges", () => {
    const { contractFiles, hasContractChanges } = scopeDiff(
      [
        "diff --git a/contracts/A.sol b/contracts/A.sol",
        "--- a/contracts/A.sol",
        "+++ b/contracts/A.sol",
        "@@ -1,3 +1,2 @@",
        " ctx",
        "-gone",
      ].join("\n"),
    );
    expect(hasContractChanges).toBe(true);
    expect(contractFiles).toEqual([
      { path: "contracts/A.sol", changedLineRanges: [], isContract: true },
    ]);
  });
  it("does not shift numbering across \\ No newline markers", () => {
    const { contractFiles } = scopeDiff(
      [
        "diff --git a/programs/x.rs b/programs/x.rs",
        "--- a/programs/x.rs",
        "+++ b/programs/x.rs",
        "@@ -1,2 +1,3 @@",
        " ctx",
        "+added",
        "\\ No newline at end of file",
      ].join("\n"),
    );
    expect(contractFiles[0].changedLineRanges).toEqual([[2, 2]]);
  });
  it("numbers added lines in /dev/null new files from the hunk start", () => {
    const { contractFiles, hasContractChanges } = scopeDiff(
      [
        "diff --git a/contracts/New.sol b/contracts/New.sol",
        "--- /dev/null",
        "+++ b/contracts/New.sol",
        "@@ -0,0 +1,2 @@",
        "+a",
        "+b",
      ].join("\n"),
    );
    expect(hasContractChanges).toBe(true);
    expect(contractFiles[0].changedLineRanges).toEqual([[1, 2]]);
  });
  it("unquotes quoted diff headers with escaped characters", () => {
    const { contractFiles } = scopeDiff(
      [
        'diff --git "a/contracts/my \\"vault\\" file.sol" "b/contracts/my \\"vault\\" file.sol"',
        '--- a/contracts/my \\"vault\\" file.sol',
        '+++ b/contracts/my \\"vault\\" file.sol',
        "@@ -1 +1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(contractFiles.map((f) => f.path)).toEqual(['contracts/my "vault" file.sol']);
  });
  it("leaves octal escapes in quoted paths untouched", () => {
    const { contractFiles } = scopeDiff(
      [
        'diff --git "a/contracts/\\303\\251.sol" "b/contracts/\\303\\251.sol"',
        "@@ -1 +1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(contractFiles.map((f) => f.path)).toEqual(["contracts/\\303\\251.sol"]);
  });

  it("preserves unquoted paths containing ' b/' (both-sides-agree split)", () => {
    // git does NOT quote space paths — both sides can contain " b/".
    const diff = [
      "diff --git a/contracts/has b/slash.sol b/contracts/has b/slash.sol",
      "--- a/contracts/has b/slash.sol",
      "+++ b/contracts/has b/slash.sol",
      "@@ -1,2 +1,3 @@",
      " x",
      "+y",
    ].join("\n");
    const { contractFiles, hasContractChanges } = scopeDiff(diff);
    expect(hasContractChanges).toBe(true);
    expect(contractFiles[0].path).toBe("contracts/has b/slash.sol");
  });

  it("adversarial ' b/' path must not vanish into a silent audit skip", () => {
    // Splitting at the LAST " b/" tail-parses the b-side to "readme.md",
    // declassifying a contracts/ file: the author dodges the bot entirely.
    const diff = [
      "diff --git a/contracts/evil b/readme.md b/contracts/evil b/readme.md",
      "--- a/contracts/evil b/readme.md",
      "+++ b/contracts/evil b/readme.md",
      "@@ -1,2 +1,3 @@",
      " x",
      "+y",
    ].join("\n");
    const { contractFiles, hasContractChanges } = scopeDiff(diff);
    expect(hasContractChanges).toBe(true);
    expect(contractFiles[0].path).toBe("contracts/evil b/readme.md");
  });

  it("resets added-line numbering at each hunk within one file", () => {
    const diff = [
      "diff --git a/src/A.sol b/src/A.sol",
      "--- a/src/A.sol",
      "+++ b/src/A.sol",
      "@@ -1,4 +1,4 @@",
      " one",
      "+two",
      " three",
      " four",
      "@@ -21,4 +21,4 @@",
      " twentyone",
      "+twentytwo",
      " twentythree",
      " twentyfour",
    ].join("\n");
    const { contractFiles } = scopeDiff(diff);
    expect(contractFiles[0].changedLineRanges).toEqual([[2, 2], [22, 22]]);
  });
});
