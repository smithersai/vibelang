# Schedule cookbook

These recipes use Effect values as repeatable programs. Each bounds its attempts or checks, and a successful request stops retrying immediately. `Schedule` values and duration calculations work exactly as in Effect.

## Honoring server retry hints

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-17
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
// string!Throttled!
// Output: archive ready
```

Parse the response's retry hint into a duration at the HTTP boundary. The policy waits the longer of that duration and the backoff for the same failure, so the first two waits are two seconds each. Three permitted retries mean at most four requests; exhausting them propagates the last `Throttled` failure.

## Polling with response-dependent delays

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-17
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
// string!PollLimit!
// Output: /archives/week.csv
```

A pending response is a success, so it feeds `repeat`, not `retry`. This simulation waits 300 then 600 milliseconds and returns the path on its third check. The count limit permits at most six checks; reaching it with another pending result becomes `PollLimit`.

## Bounding the whole retry operation

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-17
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

The outer timeout covers the first attempt, every wait, and every retry; a timeout inside the retried program gives each attempt its own budget. A schedule checks its elapsed-duration limit only at its steps and can't interrupt an attempt in progress; a timeout interrupts the work and waits for its cleanup.

## Switching from rapid to slower retries

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-17
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

The first two retries wait briefly; later ones wait four seconds. This simulation succeeds on attempt four, in the slow phase. If every attempt fails, the two phases allow five retries plus the initial attempt.

## Recording retry decisions

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-17
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

Put `tap` after the limit so it records accepted retries only. The retry number starts at one and describes the next planned attempt, before its wait begins. A telemetry failure also fails the schedule; when an export failure must not stop the request, handle it inside the callback.
