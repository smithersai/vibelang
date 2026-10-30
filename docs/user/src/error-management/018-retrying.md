# Retrying

Retry transient domain failures when a new attempt has a useful chance of succeeding. A retry reruns the supplied Effect from the start, side effects included.

[Upstream page](https://effect.website/docs/v4/error-management/retrying)

## Retrying failed computations

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
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

The first attempt always runs; `{ times: 3 }` allows three more, at most four executions. State declared outside the Effect block, such as `attempts`, persists across attempts; locals inside it start fresh.

A failure ends the current attempt before the retry begins. Defects and interruption don't trigger a retry. Retried writes need an application policy that makes repeated execution safe.

## Selecting retryable domain errors

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
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

`while` retries while its predicate holds; `until` stops once its predicate holds. Either can return a boolean or an Effect, so selection can consult a service. Unselected errors stay typed failures.

## Controlling timing and limits

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

A schedule controls delay and can add its own stopping condition; with `times`, predicates, and a schedule combined, retrying stops when the applicable policy says to. `Schedule.recurs(3)` permits three retries. `repeat` repeats after success.

## Recovering after retries end

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

`retryOrElse` runs recovery once its schedule is exhausted, passing the last error and the schedule's output (a retry count for `Schedule.recurs`). Recovery can add its own errors and requirements.

## Coming from Effect

Pass the Effect directly: `try retry(sendRequest(), policy)`. Calling `sendRequest()` constructs the Effect without running its body. Every retry runs it again. Use `effect { … }` for an attempt containing several statements.
