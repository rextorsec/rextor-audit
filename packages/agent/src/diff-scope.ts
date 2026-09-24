// SPEC-1 §2 — diff scope: reduce a GitHub PR unified diff to contract files.
// Ranges are NEW-file line numbers of added lines, one contiguous range per
// run of added lines.

export const CONTRACT_PATH_RE = /(\.sol$|(^|\/)contracts\/|(^|\/)programs\/)/;

export interface ScopedFile {
  path: string;
  changedLineRanges: Array<[number, number]>;
  isContract: true;
}

export interface DiffScopeResult {
  contractFiles: ScopedFile[];
  hasContractChanges: boolean;
}

/** Alias so later tasks/specs can say `Scope` (SPEC-2 §4 ReviewDeps). */
export type Scope = DiffScopeResult;

const DIFF_GIT_RE = /^diff --git /;
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const QUOTED_SIDES_RE = /^"a\/(.*)" "b\/(.*)"$/;

/**
 * Git C-escapes inside quoted paths (`\"`, `\\`, `\n`, `\t`). Octal UTF-8
 * escapes (`\303\251`) are passed through untouched — decoding them is out
 * of scope and path classification never needs the exact bytes.
 */
function unescapeGitPath(inner: string): string {
  return inner.replace(/\\([^0-7])/g, (_match, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c,
  );
}

/** New-side path from a `diff --git a/x b/x` header; quoted paths handled minimally. */
function newPathFromHeader(line: string): string | undefined {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const quoted = QUOTED_SIDES_RE.exec(rest);
    return quoted ? unescapeGitPath(quoted[2]) : undefined;
  }
  // Unquoted: git does NOT quote space paths, so BOTH sides may contain
  // " b/". Splitting at the last occurrence tail-parses adversarial names
  // ("a/contracts/evil b/x.md b/contracts/evil b/x.md" → "x.md"), silently
  // declassifying contract files. Walk candidate splits backwards; the right
  // one is where the a-side equals "a/" + the b-side. Fall back to the last
  // occurrence (rename: "a/old.sol b/new.sol" has no agreeing split).
  for (
    let idx = rest.lastIndexOf(" b/");
    idx !== -1;
    idx = rest.lastIndexOf(" b/", idx - 1)
  ) {
    const bSide = rest.slice(idx + " b/".length);
    if (rest.slice(0, idx) === "a/" + bSide) return bSide;
  }
  const fallback = rest.lastIndexOf(" b/");
  return fallback === -1 ? undefined : rest.slice(fallback + " b/".length);
}

/**
 * New-side path from the file's `+++ b/…` line — the AUTHORITATIVE new-side
 * name (exactly one path, git-quoted when it contains specials). The
 * `diff --git` header carries BOTH sides and is ambiguous for adversarial
 * names: "… b/x.md b/contracts/Evil.sol" has no agreeing split for a rename,
 * and tail-parsing a crafted rename can declassify a contract file into a
 * silent no-op review. This line cannot lie about the new side. The header
 * parse stays as the fallback for blocks with no `+++` line (binary diffs)
 * and for deletions (`+++ /dev/null` keeps the header's old-side path so a
 * deleted contract still lands in scope).
 */
function newPathFromPlusLine(line: string): string | undefined {
  const rest = line.slice("+++ ".length);
  if (rest === "/dev/null") return undefined;
  if (rest.startsWith('"')) {
    const inner = rest.slice(1, -1);
    return unescapeGitPath(inner.startsWith("b/") ? inner.slice(2) : inner);
  }
  return rest.startsWith("b/") ? rest.slice(2) : rest;
}

function mergeRuns(lines: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const n of lines) {
    const last = ranges[ranges.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

export function scopeDiff(diff: string): DiffScopeResult {
  const contractFiles: ScopedFile[] = [];
  let path: string | undefined;
  let added: number[] = [];
  let newLine = 0;
  let newRemaining = 0;
  let oldRemaining = 0;
  let inHunk = false;

  const flush = () => {
    if (path !== undefined && CONTRACT_PATH_RE.test(path)) {
      contractFiles.push({
        path,
        changedLineRanges: mergeRuns(added),
        isContract: true,
      });
    }
    path = undefined;
    added = [];
  };

  for (const line of diff.split("\n")) {
    if (DIFF_GIT_RE.test(line)) {
      flush();
      path = newPathFromHeader(line);
      inHunk = false;
      continue;
    }
    if (inHunk && newRemaining === 0 && oldRemaining === 0) inHunk = false;

    // The `+++ b/…` line precedes the first hunk: correct the header-derived
    // path with the authoritative new-side name (rename-declassify defense).
    if (!inHunk && line.startsWith("+++ ")) {
      const plusPath = newPathFromPlusLine(line);
      if (plusPath !== undefined) path = plusPath;
      continue;
    }

    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      newLine = Number(hunk[3]);
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue; // ---/+++/index/rename/binary header lines

    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+")) {
      added.push(newLine);
      newLine += 1;
      newRemaining -= 1;
    } else if (line.startsWith("-")) {
      oldRemaining -= 1;
    } else {
      // Context line (leading space, or a bare empty line whose trailing
      // space was stripped by a tool).
      newLine += 1;
      newRemaining -= 1;
      oldRemaining -= 1;
    }
  }
  flush();

  return { contractFiles, hasContractChanges: contractFiles.length > 0 };
}
