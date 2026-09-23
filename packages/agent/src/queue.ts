// Week-2 hardening: sequential review queue with GitHub delivery dedup.
// GitHub never auto-redelivers, but a re-driven delivery (manual redeliver,
// boot-time reconciliation) replays with the SAME delivery id; without dedup
// it would double-post comments. Work runs strictly one-at-a-time in
// arrival order; worker errors are contained (the webhook has already
// acknowledged 200 and must never be rejected by the queue).
const DELIVERY_TTL_MS = 15 * 60 * 1000;

/** Body-size ceiling for webhook payloads (1 MiB), enforced pre-signature. */
export const MAX_BODY_BYTES = 1_048_576;

/** Warn threshold for one run. A hung run silently starves the whole tail
 *  chain — every later delivery queues behind it with no visible sign — so a
 *  still-running review must announce itself periodically (2026-09-22
 *  incident: one hung run swallowed every review for 3+ hours). */
export const RUN_STALL_WARN_MS = 10 * 60 * 1000;

export class ReviewQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  private readonly processedAt = new Map<string, number>();
  private readonly stallWarnMs: number;

  constructor(options: { stallWarnMs?: number } = {}) {
    this.stallWarnMs = options.stallWarnMs ?? RUN_STALL_WARN_MS;
  }

  async enqueue(deliveryId: string, run: () => Promise<void>, label = deliveryId): Promise<void> {
    const now = Date.now();
    for (const [id, at] of this.processedAt) {
      if (now - at > DELIVERY_TTL_MS) this.processedAt.delete(id);
    }
    if (this.inFlight.has(deliveryId) || this.processedAt.has(deliveryId)) return;
    // Registration is synchronous: a redelivery racing the queued item is
    // already dedupable before the run ever starts.
    this.inFlight.add(deliveryId);
    this.tail = this.tail.then(async () => {
      const startedAt = Date.now();
      console.log(`[rextor] review started: ${label}`);
      const stall = setInterval(() => {
        const secs = Math.round((Date.now() - startedAt) / 1000);
        console.error(`[rextor] review STILL RUNNING after ${secs}s (possible hang): ${label}`);
      }, this.stallWarnMs);
      try {
        await run();
        console.log(`[rextor] review finished: ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
      } catch (err) {
        console.error("[rextor] queued review failed:", err instanceof Error ? err.message : err);
      } finally {
        clearInterval(stall);
        this.processedAt.set(deliveryId, Date.now());
        this.inFlight.delete(deliveryId);
      }
    });
    await this.tail;
  }

  /** Resolves when no queued or in-flight work remains (drain affordance). */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}
