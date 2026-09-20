// F5 — GitHub App installation-token auth for the check-run receipt.
// Fine-grained PATs cannot hold the Checks permission, so the merge-gating
// check-run must authenticate AS the App installation. Configuration is the
// REXTOR_GITHUB_APP_ID / REXTOR_GITHUB_INSTALLATION_ID /
// REXTOR_GITHUB_APP_PEM_PATH triple: all three set → the provider mints a
// short-lived installation token and caches it to expiry; any unset → null
// and the check-run falls back to the PAT (today's behavior — the receipt
// honestly degrades per invariant 24).
// Env is resolved at CALL time (never captured at import), matching the
// triage/attest discipline — a restart is not required to rotate the PEM.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/** Refresh headroom: stop trusting a cached token this long before expiry. */
export const INSTALLATION_TOKEN_TTL_SLACK_MS = 120_000;

export interface InstallationTokenProviderOptions {
  /** Explicit config wins over env (tests); defaults read process.env per call. */
  appId?: string;
  installationId?: string;
  pemPath?: string;
  fetchFn?: typeof fetch;
  /** Epoch ms. */
  now?: () => number;
  pemReader?: (path: string) => string;
}

export interface AppAuthConfig {
  appId: string;
  installationId: string;
  pemPath: string;
}

/** All three env keys present → config; otherwise null (feature off). */
export function installationTokenEnv(env: NodeJS.ProcessEnv = process.env): AppAuthConfig | null {
  const appId = env.REXTOR_GITHUB_APP_ID;
  const installationId = env.REXTOR_GITHUB_INSTALLATION_ID;
  const pemPath = env.REXTOR_GITHUB_APP_PEM_PATH;
  if (!appId || !installationId || !pemPath) return null;
  return { appId, installationId, pemPath };
}

/** GitHub App JWT: RS256, iss = App ID, ≤10-minute lifetime (9 here for skew). */
export function signAppJwt(appId: string, pem: string, nowSec: number): string {
  const b64u = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64u(signer.sign(pem))}`;
}

export function createInstallationTokenProvider(
  options: InstallationTokenProviderOptions = {},
): () => Promise<string | null> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? (() => Date.now());
  const pemReader = options.pemReader ?? ((path: string) => readFileSync(path, "utf8"));
  let cached: { token: string; expiresAtMs: number } | null = null;

  return async (): Promise<string | null> => {
    const cfg =
      options.appId && options.installationId && options.pemPath
        ? { appId: options.appId, installationId: options.installationId, pemPath: options.pemPath }
        : installationTokenEnv();
    if (!cfg) return null;
    if (cached && now() < cached.expiresAtMs - INSTALLATION_TOKEN_TTL_SLACK_MS) return cached.token;

    const jwt = signAppJwt(cfg.appId, pemReader(cfg.pemPath), Math.floor(now() / 1000));
    const res = await fetchFn(`https://api.github.com/app/installations/${cfg.installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rextor-agent",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`installation token request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    cached = { token: data.token, expiresAtMs: Date.parse(data.expires_at) };
    return cached.token;
  };
}
