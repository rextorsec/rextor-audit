// Week-2 hardening: sequential review queue with GitHub delivery dedup.
// GitHub redelivers after ~10s of no response; without dedup the same
// delivery double-posts comments. Work runs strictly one-at-a-time in
// arrival order; worker errors are contained (the webhook has already
// acknowledged 200 and must never be rejected by the queue).
const DELIVERY_TTL_MS = 15 * 60 * 1000;

/** Body-size ceiling for webhook payloads (1 MiB), enforced pre-signature. */
export const MAX_BODY_BYTES = 1_048_576;

export class ReviewQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  private readonly processedAt = new Map<string, number>();

  async enqueue(deliveryId: string, run: () => Promise<void>): Promise<void> {
    const now = Date.now();
    for (const [id, at] of this.processedAt) {
      if (now - at > DELIVERY_TTL_MS) this.processedAt.delete(id);
    }
    if (this.inFlight.has(deliveryId) || this.processedAt.has(deliveryId)) return;
    // Registration is synchronous: a redelivery racing the queued item is
    // already dedupable before the run ever starts.
    this.inFlight.add(deliveryId);
    this.tail = this.tail.then(async () => {
      try {
        await run();
      } catch (err) {
        console.error("[rextor] queued review failed:", err instanceof Error ? err.message : err);
      } finally {
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
