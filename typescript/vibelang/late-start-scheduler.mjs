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
          const timer = setTimeout(() => {
            pending.delete(timer)
            dispatcher.scheduleTask(task, priority)
          }, delay)
          pending.set(timer, { task, priority })
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
