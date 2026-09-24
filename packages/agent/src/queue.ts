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
  /** Pending (queued-not-started) slots keyed by coalesce key — a new
   *  enqueue for the same key REPLACES the pending run instead of appending
   *  (synchronize bursts: only the tip deserves a full review). */
  private readonly pendingByKey = new Map<string, PendingSlot>();

  constructor(options: { stallWarnMs?: number } = {}) {
    this.stallWarnMs = options.stallWarnMs ?? RUN_STALL_WARN_MS;
  }

  /** Queued-not-started work items (coalesced slots count once). Drain-cap
   *  signal for the webhook: beyond the cap it answers 503 + Retry-After and
   *  boot reconciliation re-drives the failed delivery later. */
  pendingCount(): number {
    return this.pendingByKey.size;
  }

  async enqueue(deliveryId: string, run: () => Promise<void>, label = deliveryId): Promise<void> {
    await this.enqueueCoalesced(deliveryId, deliveryId, run, label);
  }

  /** Coalescing enqueue: same key while still pending → the pending slot's
   *  run/label/deliveryId are REPLACED (the superseded delivery id is marked
   *  processed so its own redelivery cannot resurrect it). A started run is
   *  never replaced — the new delivery appends a fresh slot. Safe for reviews
   *  because runReview re-fetches the diff at execution time: the pending
   *  closure is always "review this PR's current tip". */
  async enqueueCoalesced(coalesceKey: string, deliveryId: string, run: () => Promise<void>, label = deliveryId): Promise<void> {
    const now = Date.now();
    for (const [id, at] of this.processedAt) {
      if (now - at > DELIVERY_TTL_MS) this.processedAt.delete(id);
    }
    if (this.inFlight.has(deliveryId) || this.processedAt.has(deliveryId)) return;
    const pending = this.pendingByKey.get(coalesceKey);
    if (pending) {
      this.processedAt.set(pending.deliveryId, now);
      pending.deliveryId = deliveryId;
      pending.run = run;
      pending.label = label;
      this.inFlight.add(deliveryId);
      return;
    }
    const slot: PendingSlot = { deliveryId, run, label };
    this.pendingByKey.set(coalesceKey, slot);
    // Registration is synchronous: a redelivery racing the queued item is
    // already dedupable before the run ever starts.
    this.inFlight.add(deliveryId);
    this.tail = this.tail.then(async () => {
      this.pendingByKey.delete(coalesceKey);
      const currentDeliveryId = slot.deliveryId;
      const currentLabel = slot.label;
      const currentRun = slot.run;
      const startedAt = Date.now();
      console.log(`[rextor] review started: ${currentLabel}`);
      const stall = setInterval(() => {
        const secs = Math.round((Date.now() - startedAt) / 1000);
        console.error(`[rextor] review STILL RUNNING after ${secs}s (possible hang): ${currentLabel}`);
      }, this.stallWarnMs);
      try {
        await currentRun();
        console.log(`[rextor] review finished: ${currentLabel} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
      } catch (err) {
        console.error("[rextor] queued review failed:", err instanceof Error ? err.message : err);
      } finally {
        clearInterval(stall);
        this.processedAt.set(currentDeliveryId, Date.now());
        this.inFlight.delete(currentDeliveryId);
      }
    });
    await this.tail;
  }

  /** Resolves when no queued or in-flight work remains (drain affordance). */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

interface PendingSlot {
  deliveryId: string;
  run: () => Promise<void>;
  label: string;
}
