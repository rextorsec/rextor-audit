// R2 — ERC-8004 automated reputation ingestion. Every settled, attested review
// can produce an ERC-8004 feedback entry carrying the REAL evidence (the
// attestation's findingsURI + findingsHash), so the reputation ledger is
// receipts-backed rather than operator-seeded. The broadcast is a MAINNET
// spend, so it is double-gated: the dep exists only with
// REXTOR_AUTO_FEEDBACK=on AND the wallet/registry env set (default OFF — the
// RECTOR flip is the point-of-risk gate), and the settle wiring fires it
// fire-and-forget AFTER the review settles (it can never block, fail, or
// delay a review; the drain HOLDS THE EXIT until in-flight broadcasts settle
// — I1 — and hard-incomplete reviews are withheld entirely — I2).
//
// Wiring mirrors attest.ts's makeAttestDep: wallet client from
// REXTOR_AGENT_PRIVATE_KEY (re-read at call time — a long-lived server must
// not pin a rotated key), every failure path degrades to a skip with reason.
// Registry addresses are env-only — never hardcoded (canonical deployments:
// docs/deployments/erc8004.md; identity registry on record
// eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, agentId 50891).
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, zeroHash } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// Live registries run version 2.0.0 (docs/deployments/erc8004.md): value is
// int128 — the older uint8 draft selector is NOT on-chain.
export const ERC8004_FEEDBACK_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

// The two C2 preflight reads (GiveFeedback8004.s.sol's asserted invariants).
export const ERC8004_IDENTITY_VIEW_ABI = parseAbi([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

/** The settled attestation's evidence, verbatim. */
export interface FeedbackRecord {
  /** IPFS findings URI from the attestation; "" = degraded (pin unavailable). */
  findingsURI: string;
  /** sha256 findings hash from the attestation; absent → zero bytes32. */
  findingsHash?: `0x${string}`;
}

export type FeedbackOutcome = { txHash: string; explorerUrl: string } | { skipped: string };

export type FeedbackDep = (record: FeedbackRecord, repo: string) => Promise<FeedbackOutcome>;

export interface FeedbackPayloadConfig {
  agentId: bigint;
  /** viem maps int128 contract args to bigint (uint64+ widths). */
  value: bigint;
  valueDecimals: number;
  endpoint: string;
}

export interface FeedbackConfig extends FeedbackPayloadConfig {
  account: `0x${string}`;
}

/** Minimal wallet/public-client seam — fakes in tests, viem in production. */
export interface FeedbackIo {
  readIdentity(functionName: "ownerOf" | "getAgentWallet", agentId: bigint): Promise<`0x${string}`>;
  giveFeedback(payload: {
    agentId: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    feedbackURI: string;
    feedbackHash: `0x${string}`;
  }): Promise<`0x${string}`>;
  /** Resolves only on a success receipt; a revert throws. */
  waitFor(hash: `0x${string}`): Promise<void>;
}

/** Why there is no feedback dep under this env; undefined = dep wires. */
export function feedbackDisabledReason(env: NodeJS.ProcessEnv): string | undefined {
  if (env.REXTOR_AUTO_FEEDBACK !== "on") return "auto-feedback disabled (REXTOR_AUTO_FEEDBACK off)";
  if (!env.REXTOR_AGENT_PRIVATE_KEY || !env.ERC8004_REPUTATION_REGISTRY) {
    return "feedback not configured (REXTOR_AGENT_PRIVATE_KEY / ERC8004_REPUTATION_REGISTRY unset)";
  }
  return undefined;
}

function uintFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): bigint {
  const raw = env[key] ?? fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} is not an integer: ${raw}`);
  return BigInt(raw);
}

function numberFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): number {
  const raw = env[key] ?? fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} is not an integer: ${raw}`);
  return Number(raw);
}

/** Documented defaults: agentId 50891, rating 95/100, decimals 0. */
export function feedbackConfig(env: NodeJS.ProcessEnv): FeedbackPayloadConfig {
  return {
    agentId: uintFromEnv(env, "ERC8004_AGENT_ID", "50891"),
    value: uintFromEnv(env, "ERC8004_FEEDBACK_VALUE", "95"),
    valueDecimals: numberFromEnv(env, "ERC8004_FEEDBACK_DECIMALS", "0"),
    endpoint: env.REXTOR_FEEDBACK_ENDPOINT ?? "https://www.rextoraudit.com",
  };
}

// The registry caps tags at 32 bytes.
const MAX_TAG_BYTES = 32;

/** Repo name → tag2: truncated to ≤32 bytes without splitting a codepoint. */
export function tagFromRepo(repo: string): string {
  let bytes = 0;
  let out = "";
  for (const ch of repo) {
    // UTF-8 width by codepoint range: 1/2/3/4 bytes — dropping the char whole
    // keeps the truncated tag valid UTF-8.
    const width = (() => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80) return 1;
      if (cp < 0x800) return 2;
      if (cp < 0x10000) return 3;
      return 4;
    })();
    if (bytes + width > MAX_TAG_BYTES) break;
    out += ch;
    bytes += width;
  }
  return out;
}

// The broadcast is a mainnet spend behind a fire-and-forget settle point: an
// unbounded RPC wait would stretch shutdown to the drain cap (and abandon a
// signed tx with no operator-visible reason). Consistent with attest.ts's
// 30s guard — the underlying call is abandoned, NOT cancelled: it may still
// land, and the skip reason says so.
const FEEDBACK_BUDGET_MS = 30_000;

function withBudget<T>(label: string, attempt: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${FEEDBACK_BUDGET_MS}ms (may still have landed)`)),
      FEEDBACK_BUDGET_MS,
    );
  });
  return Promise.race([attempt, deadline]).finally(() => clearTimeout(timer));
}

export async function submitFeedback(
  record: FeedbackRecord,
  repo: string,
  io: FeedbackIo,
  cfg: FeedbackConfig,
): Promise<FeedbackOutcome> {
  // Preflight the two C2 ordering invariants (GiveFeedback8004.s.sol):
  // giveFeedback rejects the NFT owner / approved operators on-chain, and the
  // spec's aggregation guidance wants client feedback from the bound
  // agentWallet. Pre-check for a clean skip instead of a reverted tx.
  let owner: string;
  let agentWallet: string;
  try {
    owner = (await withBudget("identity ownerOf", io.readIdentity("ownerOf", cfg.agentId))).toLowerCase();
    agentWallet = (await withBudget("identity getAgentWallet", io.readIdentity("getAgentWallet", cfg.agentId))).toLowerCase();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { skipped: `identity registry read failed: ${msg}` };
  }
  const account = cfg.account.toLowerCase();
  if (owner === account) {
    return { skipped: "submitter is the agent NFT owner (self-feedback rule)" };
  }
  if (agentWallet !== account) {
    return { skipped: "submitter is not the bound agentWallet (SetAgentWallet8004 first)" };
  }
  try {
    const hash = await withBudget("giveFeedback broadcast", io.giveFeedback({
      agentId: cfg.agentId,
      value: cfg.value,
      valueDecimals: cfg.valueDecimals,
      tag1: "audit",
      tag2: tagFromRepo(repo),
      endpoint: cfg.endpoint,
      feedbackURI: record.findingsURI,
      feedbackHash: record.findingsHash ?? zeroHash,
    }));
    // Only a success receipt is feedback worth citing (attest.ts receipt guard).
    await withBudget("feedback receipt wait", io.waitFor(hash));
    return { txHash: hash, explorerUrl: "" };
  } catch (err) {
    // Log the MESSAGE only — never stack traces/env that could echo secrets.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rextor] feedback submit failed:", msg);
    return { skipped: `feedback submit failed: ${msg}` };
  }
}

// ERC-8004 canonical registries live on Ethereum mainnet (chain 1) — the
// chain-neutral identity ruling (docs/deployments/erc8004.md). A Base flip
// would be a RECTOR chain choice, not a code default.
const ETHEREUM_MAINNET_ID = 1;

export function feedbackIo(options: {
  rpcUrl: string;
  identity: `0x${string}`;
  reputation: `0x${string}`;
  account: PrivateKeyAccount;
}): FeedbackIo {
  const chain = defineChain({
    id: ETHEREUM_MAINNET_ID,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [options.rpcUrl] } },
  });
  const wallet = createWalletClient({ account: options.account, chain, transport: http(options.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
  return {
    readIdentity: async (functionName, agentId) => {
      if (functionName === "getAgentWallet") {
        return publicClient.readContract({
          address: options.identity,
          abi: ERC8004_IDENTITY_VIEW_ABI,
          functionName: "getAgentWallet",
          args: [agentId],
        });
      }
      return publicClient.readContract({
        address: options.identity,
        abi: ERC8004_IDENTITY_VIEW_ABI,
        functionName: "ownerOf",
        args: [agentId],
      });
    },
    giveFeedback: (payload) =>
      wallet.writeContract({
        address: options.reputation,
        abi: ERC8004_FEEDBACK_ABI,
        functionName: "giveFeedback",
        args: [
          payload.agentId,
          payload.value,
          payload.valueDecimals,
          payload.tag1,
          payload.tag2,
          payload.endpoint,
          payload.feedbackURI,
          payload.feedbackHash,
        ],
        chain,
        account: options.account,
      }),
    waitFor: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
    },
  };
}

/**
 * Default `feedback` dep. Undefined unless `REXTOR_AUTO_FEEDBACK=on` AND both
 * `REXTOR_AGENT_PRIVATE_KEY` and `ERC8004_REPUTATION_REGISTRY` are set at
 * wiring time — fail closed, never guess addresses. EVERY call-time failure
 * (env rotated away, registry/RPC unset, invalid config, preflight mismatch,
 * revert) resolves as `{ skipped: <reason> }`; it never throws.
 */
export function createFeedbackDep(readEnv: () => NodeJS.ProcessEnv = () => process.env): FeedbackDep | undefined {
  const boot = readEnv();
  if (feedbackDisabledReason(boot) !== undefined) return undefined;
  return (record, repo) => {
    // Re-read at call time (a long-lived server must not pin a rotated key).
    const env = readEnv();
    if (!env.REXTOR_AGENT_PRIVATE_KEY || !env.ERC8004_REPUTATION_REGISTRY) {
      return Promise.resolve({
        skipped: "feedback env unset at call time (REXTOR_AGENT_PRIVATE_KEY / ERC8004_REPUTATION_REGISTRY)",
      });
    }
    const identity = env.ERC8004_IDENTITY_REGISTRY as `0x${string}` | undefined;
    if (!identity) {
      return Promise.resolve({
        skipped: "identity registry unset (ERC8004_IDENTITY_REGISTRY) — preflight reads impossible",
      });
    }
    const rpcUrl = env.REXTOR_FEEDBACK_RPC_URL;
    if (!rpcUrl) {
      return Promise.resolve({ skipped: "feedback RPC unset (REXTOR_FEEDBACK_RPC_URL) — fail closed, never guess infra" });
    }
    let payload: FeedbackPayloadConfig;
    let account: PrivateKeyAccount;
    try {
      payload = feedbackConfig(env);
      account = privateKeyToAccount(env.REXTOR_AGENT_PRIVATE_KEY as `0x${string}`);
    } catch (err) {
      return Promise.resolve({
        skipped: `feedback env invalid: ${err instanceof Error ? err.message : err}`,
      });
    }
    return submitFeedback(record, repo, feedbackIo({ rpcUrl, identity, reputation: env.ERC8004_REPUTATION_REGISTRY as `0x${string}`, account }), {
      ...payload,
      account: account.address,
    });
  };
}
