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
});
