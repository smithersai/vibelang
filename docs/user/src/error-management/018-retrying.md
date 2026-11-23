# Retrying

`retry` reruns a failed Effect from the start until it succeeds or its policy stops. Reach for it on transient domain failures where a fresh attempt has a real chance of succeeding.

[Upstream page](https://effect.website/docs/v4/error-management/retrying)

![Retrying an Effect with a composable Schedule](/diagrams/retry-schedule-flow.svg)

| Form | Controls | Stopping rule |
| --- | --- | --- |
| `retry(eff, { times })` | Fixed retry budget | Stops after `times` retries (`times + 1` total runs) |
| `retry(eff, { while / until })` | Error-based filtering | Stops when predicate fails (`while`) or holds (`until`) |
| `retry(eff, schedule)` | Delay and recurrence policy | Stops when the `Schedule` ends |
| `retryOrElse(eff, schedule, fallback)` | Retries plus final recovery | Runs `fallback(error, scheduleOutput)` after exhaustion |

## Retrying failed computations

![Retry with an exponential schedule](/videos/retry.mp4)

```vibe
// run: try Console.log(try loadWithRetries())
error Busy { attempt: number }

effect function loadWithRetries() {
  let attempts = 0
  return try retry(effect {
    attempts += 1
    try Console.log(`Attempt ${attempts}`)
    if (attempts < 3) throw new Busy({ attempt: attempts })
    return "Snapshot ready"
  }, { times: 3 })
}
```

```output
Attempt 1
Attempt 2
Attempt 3
Snapshot ready
```

The initial attempt always runs; `{ times: 3 }` adds at most three retries, for four total executions. Bindings declared outside the `effect { ... }` block persist across attempts, while locals inside start fresh on every retry.

Each failure completes its attempt before the next begins, and every retry reruns side effects from the top—ensure retried writes are idempotent. Defects and interruption never trigger a retry.

## Selecting retryable domain errors

```vibe
// run: try Console.log((try flip(sendTransient())).transient)
error RequestRejected {
  transient: boolean
}

effect function sendRequest(): string!RequestRejected {
  throw new RequestRejected({ transient: false })
}

effect function sendTransient() {
  return try retry(sendRequest(), {
    times: 4,
    while: (error) => error.transient
  })
}
```

```output
false
```

`while` retries as long as its predicate holds; `until` stops as soon as its predicate holds. Either predicate may return a boolean or an Effect, allowing checks against services. Errors excluded by the predicate propagate immediately as typed failures.

## Controlling timing and limits

```vibe
// run: try Console.log((try flip(sendWithBackoff()))._tag); try Console.log((try flip(sendThreeMoreTimes()))._tag)
effect function sendWithBackoff() {
  return try retry(sendRequest(), {
    times: 4,
    while: (error) => error.transient,
    schedule: Schedule.exponential("150 millis")
  })
}

effect function sendThreeMoreTimes() {
  return try retry(sendRequest(), Schedule.recurs(3))
}
```

```output
RequestRejected
RequestRejected
```

A `Schedule` sets inter-attempt delays and can supply its own stopping condition. When `times`, predicates, and `schedule` are combined, retrying ends as soon as any configured limit stops it. `Schedule.recurs(3)` permits three retries; use `repeat` instead when looping after success.

## Recovering after retries end

```vibe
// run: try Console.log(try sendOrQueue())
effect function sendOrQueue() {
  return try retryOrElse(
    sendRequest(),
    Schedule.recurs(2),
    effect (error, retries) => {
      try Console.log(`Queued after ${retries} retries; transient=${error.transient}`)
      return "Queued for later"
    }
  )
}
```

```output
Queued after 2 retries; transient=false
Queued for later
```

`retryOrElse` invokes its fallback once the schedule is exhausted, receiving the last typed error and the schedule's output (the retry count for `Schedule.recurs`). The fallback's own errors and service requirements join the returned Effect's type.

## Coming from Effect

Pass the Effect value directly: `try retry(sendRequest(), policy)`. Calling `sendRequest()` builds the Effect description without executing it, so each retry runs its body again; wrap multi-statement attempts in `effect { … }`.
