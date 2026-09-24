// C1 — boot-time delivery reconciliation. GitHub does NOT auto-redeliver
// failed webhook deliveries, so a delivery answered 503 mid-drain (or lost to
// a crash) would otherwise be silent loss: marked failed upstream, never
// reviewed, no log. Instead of betting on retry behavior that does not exist,
// the service re-drives failures itself at boot: list the app webhook's
// recent deliveries with the App JWT (GET /app/hook/deliveries), then POST
// /app/hook/deliveries/{id}/attempts for each FAILED one — GitHub replays the
// delivery to the normal webhook path, where the persistent-index guard
// (server.ts) keeps an already-reviewed (repo, pr, headSha) from re-reviewing.
// Best-effort recovery, NOT fail-closed: every error logs a skip and boot
// continues (reconciliation can never block or crash startup). Bounded to the
// most recent page (≤100) — it runs once per boot, not as a backlog drain.
// REXTOR_RECONCILE_DELIVERIES=off disables it for operators who want zero
// startup API calls.
import { readFileSync } from "node:fs";
import { signAppJwt } from "./app-auth";

export const RECONCILE_PAGE_SIZE = 100;

export interface ReconcileOutcome {
  /** FAILED deliveries successfully re-driven (attempts POST answered 202). */
  redriven: number;
  /** FAILED deliveries seen but not re-driven (redeliver call failed). */
  failed: number;
  /** Why nothing was attempted at all; undefined = the list call happened. */
  skipped?: string;
}

/** Kill-switch + config gate. undefined = reconciliation should run. */
export function reconciliationDisabledReason(env: NodeJS.ProcessEnv): string | undefined {
  if ((env.REXTOR_RECONCILE_DELIVERIES ?? "").trim().toLowerCase() === "off") {
    return "disabled (REXTOR_RECONCILE_DELIVERIES=off)";
  }
  if (!env.REXTOR_GITHUB_APP_ID || !env.REXTOR_GITHUB_APP_PEM_PATH) {
    return "not configured (REXTOR_GITHUB_APP_ID / REXTOR_GITHUB_APP_PEM_PATH unset)";
  }
  return undefined;
}

/** The one delivery field that matters here; everything else is ignored. */
interface HookDelivery {
  id: number;
  /** The webhook's x-github-delivery UUID — the identifier OUR handler sees
   *  (the numeric id is GitHub-API-internal). The skip list is keyed by this. */
  guid?: string;
  status: string;
}

const API = "https://api.github.com";

const JSON_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "rextor-agent",
};

export interface ReconcileDeps {
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Epoch ms. */
  now?: () => number;
  /** PEM reader seam (tests); default readFileSync. */
  pemReader?: (path: string) => string;
  /** Permanently-unrecoverable deliveries (e.g. 413 over the body cap):
   *  recorded by the webhook, never re-driven here — re-driving them would
   *  loop 413 at every boot and crowd out recoverable failures. */
  skipList?: { has(deliveryId: string): boolean };
}

export async function reconcileFailedDeliveries(deps: ReconcileDeps = {}): Promise<ReconcileOutcome> {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const pemReader = deps.pemReader ?? ((p: string) => readFileSync(p, "utf8"));
  const disabled = reconciliationDisabledReason(env);
  if (disabled) {
    console.log(`[rextor] delivery reconciliation skipped: ${disabled}`);
    return { redriven: 0, failed: 0, skipped: disabled };
  }
  let jwt: string;
  try {
    jwt = signAppJwt(env.REXTOR_GITHUB_APP_ID!, pemReader(env.REXTOR_GITHUB_APP_PEM_PATH!), Math.floor((deps.now ?? Date.now)() / 1000));
  } catch (err) {
    const reason = `App JWT mint failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[rextor] delivery reconciliation skipped: ${reason}`);
    return { redriven: 0, failed: 0, skipped: reason };
  }
  const authHeaders = { ...JSON_HEADERS, Authorization: `Bearer ${jwt}` };
  try {
    const list = await fetchFn(`${API}/app/hook/deliveries?per_page=${RECONCILE_PAGE_SIZE}`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    if (!list.ok) {
      const reason = `delivery list failed: HTTP ${list.status}`;
      console.error(`[rextor] delivery reconciliation skipped: ${reason}`);
      return { redriven: 0, failed: 0, skipped: reason };
    }
    const deliveries = (await list.json()) as HookDelivery[];
    // Most recent page only — a boot re-drive, not a backlog drain.
    const failed = deliveries.filter((d) => d.status === "failed").slice(0, RECONCILE_PAGE_SIZE);
    let redriven = 0;
    let failedRedrives = 0;
    let skippedUnrecoverable = 0;
    for (const d of failed) {
      const skipKey = d.guid ?? String(d.id);
      if (deps.skipList?.has(skipKey)) {
        skippedUnrecoverable += 1;
        continue;
      }
      try {
        const res = await fetchFn(`${API}/app/hook/deliveries/${d.id}/attempts`, {
          method: "POST",
          headers: authHeaders,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 202) {
          redriven += 1;
          console.log(`[rextor] reconciliation re-driving failed delivery ${d.id}`);
        } else {
          failedRedrives += 1;
          console.error(`[rextor] reconciliation redeliver for delivery ${d.id}: HTTP ${res.status} — skipped`);
        }
      } catch (err) {
        failedRedrives += 1;
        console.error(`[rextor] reconciliation redeliver for delivery ${d.id} failed — skipped:`,
          err instanceof Error ? err.message : err);
      }
    }
    console.log(`[rextor] delivery reconciliation: ${redriven} re-driven, ${failedRedrives} failed, ${skippedUnrecoverable} skipped (unrecoverable) of ${deliveries.length} recent`);
    return { redriven, failed: failedRedrives };
  } catch (err) {
    const reason = `delivery list failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[rextor] delivery reconciliation skipped: ${reason}`);
    return { redriven: 0, failed: 0, skipped: reason };
  }
}
