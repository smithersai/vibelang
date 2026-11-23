# Schedule cookbook

These recipes pair repeatable Effect values with bounded `Schedule` policies for common production patterns. Every recipe caps its retries or polls, and `Schedule` and `Duration` behave identically to Effect.

| Pattern | Key combinators |
| --- | --- |
| Server `Retry-After` floor | `Schedule.setInputType`, `Schedule.modifyDelay`, `Duration.max` |
| Response-driven polling | `repeat`, `until`, `Schedule.modifyDelay` |
| Hard total deadline | Outer `timeout(retry(...), d)` |
| Fast-then-slow retries | `Schedule.concat` |
| Retry telemetry | `Schedule.tap` placed after `Schedule.upTo` |

## Honoring server retry hints

```vibe
// run: provide TestClock.layer() { const worker = fork download(); try TestClock.adjust("5 seconds"); try Console.log(join worker) }
error Throttled {
  retryAfter: Duration.Duration
}

effect function download() {
  let calls = 0
  const policy = pipe(
    Schedule.exponential("500 millis"),
    Schedule.setInputType<Throttled>(),
    Schedule.modifyDelay(effect ({ duration, input }) =>
      Duration.max(duration, input.retryAfter)),
    Schedule.upTo({ times: 3 })
  )
  return try retry(effect {
    calls++
    if (calls < 3) {
      throw new Throttled({ retryAfter: Duration.seconds(2) })
    }
    return "archive ready"
  }, policy)
}
// string!Throttled
// Output: archive ready
```

Parse the HTTP `Retry-After` header into a `Duration` at the client boundary. `Duration.max` enforces the server hint as a floor over exponential backoff (two seconds on both retries here), and exhausting all three retries propagates the final `Throttled` error.

## Polling with response-dependent delays

```vibe
// run: provide TestClock.layer() { const worker = fork waitForArchive(); try TestClock.adjust("1 second"); try Console.log(join worker) }
type Status =
  | { _tag: "Pending"; pollAfter: Duration.Duration }
  | { _tag: "Ready"; path: string }

error PollLimit

effect function waitForArchive() {
  let checks = 0
  effect function check(): Status!! {
    checks++
    return checks < 3
      ? { _tag: "Pending", pollAfter: Duration.millis(checks * 300) }
      : { _tag: "Ready", path: "/archives/week.csv" }
  }
  const delay = pipe(
    Schedule.recurs(5),
    Schedule.setInputType<Status>(),
    Schedule.modifyDelay(effect ({ input }) =>
      input._tag === "Pending" ? input.pollAfter : Duration.zero)
  )
  const status = try repeat(check(), {
    schedule: delay,
    until: (status) => status._tag === "Ready"
  })
  if (status._tag === "Pending") throw new PollLimit()
  return status.path
}
// string!PollLimit
// Output: /archives/week.csv
```

Because a `Pending` status is a valid response rather than a failure, drive polling with `repeat` instead of `retry`. The schedule waits 300 ms, then 600 ms, and returns on the third check; if all six checks return `Pending`, the trailing check turns exhaustion into `PollLimit`.

## Bounding the whole retry operation

```vibe
// run: provide TestClock.layer() { const worker = fork result(readWithDeadline()); try TestClock.adjust("1 second"); const outcome = join worker; if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag) }
error Offline

effect function readWithDeadline() {
  return try timeout(
    retry(effect { throw new Offline() }, Schedule.exponential("80 millis").pipe(Schedule.upTo({ times: 5 }))),
    "350 millis"
  )
}
// Output: TimeoutError
```

Wrapping `retry` inside `timeout` bounds the initial attempt, all delays, and every retry together; placing `timeout` inside the retried Effect instead gives each attempt its own budget. Unlike `Schedule.upTo({ duration })`, which only checks elapsed time between steps, `timeout` interrupts an active attempt and waits for its cleanup.

## Switching from rapid to slower retries

```vibe
// run: provide TestClock.layer() { const worker = fork reconnect(); try TestClock.adjust("5 seconds"); try Console.log(join worker) }
error Disconnected

effect function reconnect() {
  let attempts = 0
  const phases = Schedule.spaced("200 millis").pipe(
    Schedule.upTo({ times: 2 }),
    Schedule.concat(Schedule.spaced("4 seconds").pipe(Schedule.upTo({ times: 3 })))
  )
  return try retry(effect {
    attempts++
    if (attempts < 4) throw new Disconnected()
    return "connected"
  }, phases)
}
// Output: connected
```

Two fast retries handle brief blips before falling back to four-second intervals. This example succeeds on attempt four (inside the slow phase); total capacity is six attempts—one initial run plus five retries.

## Recording retry decisions

```vibe
// run: provide TestClock.layer() { const worker = fork observedRequest(); try TestClock.adjust("1 second"); try Console.log(join worker) }
error Unavailable {
  status: number
}

effect function observedRequest() {
  let attempts = 0
  const policy = pipe(
    Schedule.exponential("250 millis"),
    Schedule.setInputType<Unavailable>(),
    Schedule.upTo({ times: 3 }),
    Schedule.tap(effect ({ attempt, duration, input }) => {
      try Console.log("retry planned", {
        retry: attempt,
        status: input.status,
        delayMs: Duration.toMillis(duration)
      })
    })
  )
  return try retry(effect {
    attempts++
    if (attempts < 3) throw new Unavailable({ status: 503 })
    return "accepted"
  }, policy)
}
// Output: retry planned { retry: 1, status: 503, delayMs: 250 }
// Output: retry planned { retry: 2, status: 503, delayMs: 500 }
// Output: accepted
```

Place `Schedule.tap` after `Schedule.upTo` so it logs only retries that will actually execute; `attempt` starts at 1 and fires before the delay begins. Because a failing `tap` callback aborts the schedule, catch telemetry errors inside the callback when export failures must not cancel retries.
