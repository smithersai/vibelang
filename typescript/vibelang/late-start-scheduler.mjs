// Test-only scheduler: timer callbacks can resume a parent before queued forks
// run. This makes sleep-as-readiness races reproducible without host contention.
// Pass Effect's Scheduler module so this helper uses the case's pinned Effect.
export function lateStartScheduler(Scheduler, delay = 100) {
  const scheduler = new Scheduler.MixedScheduler()
  return {
    executionMode: "async",
    shouldYield: (fiber) => scheduler.shouldYield(fiber),
    makeDispatcher() {
      const dispatcher = scheduler.makeDispatcher()
      const pending = new Map()
      return {
        scheduleTask(task, priority) {
          // Begin the delay after the caller suspends. Even a long pause
          // between its fork and sleep cannot let this delay expire early.
          const initial = setTimeout(() => {
            pending.delete(initial)
            const timer = setTimeout(() => {
              pending.delete(timer)
              dispatcher.scheduleTask(task, priority)
            }, delay)
            pending.set(timer, { task, priority })
          }, 0)
          pending.set(initial, { task, priority })
        },
        flush() {
          for (const [timer, { task, priority }] of pending) {
            clearTimeout(timer)
            dispatcher.scheduleTask(task, priority)
          }
          pending.clear()
          dispatcher.flush()
        }
      }
    }
  }
}
