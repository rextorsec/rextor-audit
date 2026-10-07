// SPEC-6 §3 (dashboard v2 config live-preview pane) — the repo's rextor.yaml
// read from GitHub's public Contents API (default branch — the trusted source
// the review pipeline itself reads; NEVER PR content). Unauthenticated: the
// dashboard reads public repos' public config only. Every failure degrades to
// the documented sample knobs, clearly labelled — never fabricated repo state.
export type RepoConfigResult =
  | { ok: true; yaml: string }
  | { ok: false; state: "missing" | "unavailable"; reason: string };

/** The D2 install-flow snippet — the documented default knobs, shown when the
 *  repo has no rextor.yaml (or the read fails) so the pane always teaches the
 *  real config format. Same content as the install page's copy-paste block. */
export const SAMPLE_REXTOR_YAML = `paths:
  include: ["contracts/**", "src/**"]
  ignore: ["**/test/**", "**/*.t.sol"]
severity_gate:
  minimum: high        # critical | high | medium | low
dismiss:
  - rule_id: ADERYN-L01
    path: "src/peripheral.sol"`;

export interface FetchRepoConfigOptions {
  /** Test seam; default global fetch (next/cache revalidate applies only there). */
  fetchImpl?: typeof fetch;
}

export async function fetchRepoConfig(
  owner: string,
  repo: string,
  opts: FetchRepoConfigOptions = {},
): Promise<RepoConfigResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/rextor.yaml`,
      {
        // raw+json accept → body IS the file text (no base64 dance).
        headers: { Accept: "application/vnd.github.raw+json" },
        signal: AbortSignal.timeout(10_000),
        // Server-component fetch cache: a demo dashboard must not burn the
        // 60 req/hr unauthenticated quota per visitor render.
        next: { revalidate: 300 },
      } as RequestInit,
    );
  } catch {
    return { ok: false, state: "unavailable", reason: "config read unreachable" };
  }
  if (res.status === 404) {
    return { ok: false, state: "missing", reason: "no rextor.yaml on the default branch" };
  }
  if (!res.ok) {
    return { ok: false, state: "unavailable", reason: `config read answered ${res.status}` };
  }
  const yaml = await res.text();
  // A public repo's default-branch file: inert text the pane renders escaped.
  // An absurdly large body is truncated — the pane is a preview, not storage.
  return { ok: true, yaml: yaml.length > 8192 ? `${yaml.slice(0, 8192)}\n… truncated` : yaml };
}
