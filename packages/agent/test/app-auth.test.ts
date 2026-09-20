import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  createInstallationTokenProvider,
  INSTALLATION_TOKEN_TTL_SLACK_MS,
  installationTokenEnv,
  signAppJwt,
} from "../src/app-auth";

// Real throwaway RSA key — createSign rejects fake fixture text, and the
// signature path IS the unit under test (GitHub only accepts real RS256).
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

function okFetch(token = "ghs_app_token", expiresInMs = 3_600_000): Mock {
  return vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ token, expires_at: new Date(Date.now() + expiresInMs).toISOString() }),
    text: async () => "",
  }));
}

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("installationTokenEnv", () => {
  it("returns config only when all three keys are present", () => {
    expect(installationTokenEnv({})).toBeNull();
    expect(installationTokenEnv({ REXTOR_GITHUB_APP_ID: "1" })).toBeNull();
    expect(
      installationTokenEnv({
        REXTOR_GITHUB_APP_ID: "4972800",
        REXTOR_GITHUB_INSTALLATION_ID: "162357123",
        REXTOR_GITHUB_APP_PEM_PATH: "/secrets/app.pem",
      }),
    ).toEqual({ appId: "4972800", installationId: "162357123", pemPath: "/secrets/app.pem" });
  });
});

describe("signAppJwt", () => {
  it("signs an RS256 JWT whose iss is the App ID with a 9-minute window", () => {
    const jwt = signAppJwt("4972800", PEM, 1_000_000);
    const { header, payload } = decodeJwt(jwt);
    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("4972800");
    expect(payload.iat).toBe(1_000_000 - 60);
    expect((payload.exp as number) - (payload.iat as number)).toBe(600);
  });
});

describe("createInstallationTokenProvider", () => {
  it("returns null with no network call when the env triple is unset", async () => {
    const fetchFn: Mock = vi.fn();
    const provider = createInstallationTokenProvider({ fetchFn: fetchFn as unknown as typeof fetch });
    vi.stubEnv("REXTOR_GITHUB_APP_ID", "");
    expect(await provider()).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("mints an installation token: correct endpoint, Bearer app JWT, parsed token", async () => {
    const fetchFn: Mock = okFetch("ghs_live_token");
    const provider = createInstallationTokenProvider({
      appId: "4972800",
      installationId: "162357123",
      pemPath: "/secrets/app.pem",
      pemReader: () => PEM,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const token = await provider();
    expect(token).toBe("ghs_live_token");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/app/installations/162357123/access_tokens");
    expect(init.method).toBe("POST");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Bearer /);
    const { payload } = decodeJwt(auth.slice("Bearer ".length));
    expect(payload.iss).toBe("4972800");
  });

  it("explicit options win over a stale env", async () => {
    vi.stubEnv("REXTOR_GITHUB_APP_ID", "999999");
    vi.stubEnv("REXTOR_GITHUB_INSTALLATION_ID", "1");
    vi.stubEnv("REXTOR_GITHUB_APP_PEM_PATH", "/stale.pem");
    const fetchFn: Mock = okFetch();
    const provider = createInstallationTokenProvider({
      appId: "4972800",
      installationId: "162357123",
      pemPath: "/secrets/app.pem",
      pemReader: () => PEM,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(await provider()).toBe("ghs_app_token");
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain("/app/installations/162357123/access_tokens");
  });

  it("caches within the TTL slack: two calls, one fetch", async () => {
    let nowMs = 1_000_000;
    const fetchFn: Mock = okFetch("ghs_app_token", 3_600_000);
    // Derive the fake expiry from the INJECTED clock — real wall-clock would
    // make the cache un-expirable against a 1970-based now().
    fetchFn.mockImplementation(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ token: "ghs_app_token", expires_at: new Date(nowMs + 3_600_000).toISOString() }),
      text: async () => "",
    }));
    const provider = createInstallationTokenProvider({
      appId: "4972800",
      installationId: "162357123",
      pemPath: "/secrets/app.pem",
      pemReader: () => PEM,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => nowMs,
    });
    await provider();
    await provider();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // Jump past expiry (3.6M) minus the refresh slack.
    nowMs += 4_000_000;
    await provider();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws with the HTTP status on failure (infrastructure error, not a silent skip)", async () => {
    const fetchFn: Mock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "Bad credentials",
    }));
    const provider = createInstallationTokenProvider({
      appId: "4972800",
      installationId: "162357123",
      pemPath: "/secrets/app.pem",
      pemReader: () => PEM,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(provider()).rejects.toThrow("installation token request failed: HTTP 401");
  });
});
