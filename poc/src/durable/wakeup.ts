const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * In-process wakeup notifier for durable suspensions, keyed by execution id.
 *
 * This is strictly a latency optimization, never a correctness dependency: a
 * waiting coordinator always re-reads committed SQLite state at its next wake
 * boundary — the earliest of its persisted wake time, its execution deadline,
 * and a fallback sweep interval — so a missed, dropped, or cross-process
 * notification delays a wakeup by at most one sweep interval and can never
 * change a durable outcome. Notifications do not cross process or SQLite
 * connection boundaries; each `DurableStore` instance owns one notifier, and
 * deliveries or cancellations that commit through another connection are
 * observed at the sweep boundary at the latest.
 */
export class WakeupService {
  private readonly waiters = new Map<string, Set<() => void>>()

  /**
   * Wakes every waiter currently parked on the execution id. Best-effort and
   * in-process only; callers must invoke it strictly after the durable commit
   * it announces, so a woken waiter re-reading the store observes that commit.
   */
  notify(executionId: string): void {
    const parked = this.waiters.get(executionId)
    if (parked === undefined) return
    this.waiters.delete(executionId)
    for (const wake of [...parked]) wake()
  }

  /**
   * Parks until `notify(executionId)` fires or the absolute `until` timestamp
   * elapses, whichever comes first. The caller owns re-reading durable state
   * after every wake; this promise carries no state of its own.
   */
  wait(executionId: string, until: number): Promise<"notified" | "elapsed"> {
    if (typeof executionId !== "string" || executionId.trim() === "") {
      throw new TypeError("Durable wakeup wait execution id must be non-empty")
    }
    if (!Number.isSafeInteger(until) || until < 0) {
      throw new TypeError("Durable wakeup wait deadline must be a non-negative safe integer")
    }
    return new Promise((resolve) => {
      let parked = this.waiters.get(executionId)
      if (parked === undefined) {
        parked = new Set()
        this.waiters.set(executionId, parked)
      }
      const waiterSet = parked
      let settled = false
      const finish = (outcome: "notified" | "elapsed"): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        waiterSet.delete(wake)
        if (waiterSet.size === 0 && this.waiters.get(executionId) === waiterSet) {
          this.waiters.delete(executionId)
        }
        resolve(outcome)
      }
      const wake = (): void => finish("notified")
      const timer = setTimeout(
        () => finish("elapsed"),
        Math.min(MAX_TIMER_DELAY_MS, Math.max(1, until - Date.now()))
      )
      waiterSet.add(wake)
    })
  }
}
