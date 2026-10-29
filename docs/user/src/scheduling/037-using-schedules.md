# Using schedules

A schedule decides when work runs again and when it stops. `Schedule` values work in VibeLang exactly as in Effect; to run one, pass an Effect value to `repeat`, `schedule`, or `retry` and run the result with `try`. Schedules live in the running process and don't recover jobs missed during downtime.

## Repeating successful computations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
// run: provide TestClock.layer() { const worker = fork heartbeat(); try TestClock.adjust("46 seconds"); try Fiber.interrupt(worker) }
effect heartbeat() {
  try repeat(
    Console.log("worker available"),
    Schedule.spaced("15 seconds")
  )
}
// Output: worker available
// Output: worker available
// Output: worker available
// Output: worker available
```

`repeat` runs the Effect immediately, then steps the schedule after each success: here, a fifteen second wait after each completed log. A failure stops the loop; interruption cancels it.

## Stopping based on a result

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try waitForBuild(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect waitForBuild() {
  let checks = 0
  const status = try repeat(effect {
    checks++
    return checks >= 4 ? "ready" : "building"
  }, {
    schedule: Schedule.spaced("200 millis"),
    until: (status) => status === "ready",
    times: 7
  })
  return { status, checks }
}
// { status: string; checks: number }!!
// Output: {"status":"ready","checks":4}
```

The initial check is separate from the seven permitted repetitions, so the loop makes at most eight checks. `until` stops on a matching result; `while` continues while its predicate holds. If the count limit wins, `repeat` returns the last result, so check it before assuming the work is ready.

## Delaying the initial run

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
// run: provide TestClock.layer() { const worker = fork delayedCleanup(); try Console.log("before first sweep"); try TestClock.adjust("60 minutes"); try Fiber.interrupt(worker) }
effect delayedCleanup() {
  try schedule(
    Console.log("sweeping expired sessions"),
    Schedule.spaced("30 minutes")
  )
}
// Output: before first sweep
// Output: sweeping expired sessions
// Output: sweeping expired sessions
```

`schedule` also waits for the schedule before the first run: this job waits thirty minutes at startup, then thirty minutes after each completed sweep. Use it for calendar jobs and startup delays where an immediate run is wrong.

## Retrying failed computations

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try reserveSlot())
error Busy

effect reserveSlot() {
  let attempts = 0
  return try retry(effect {
    attempts++
    if (attempts < 3) throw new Busy()
    return "reserved"
  }, Schedule.recurs(3))
}
// string!Busy!
// Output: reserved
```

`retry` steps its schedule after an expected failure and stops immediately on success. `recurs(3)` permits three retries after the first attempt: four attempts at most. Retry doesn't turn defects or interruption into expected failures.

## Handling failures while repeating

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-6, VIP-7, VIP-9, VIP-12, VIP-13, VIP-14, VIP-17
// run: let reads = 0; provide Layer.mergeAll(TestClock.layer(), Layer.succeed(Sensor, { read: effect () => { reads++; if (reads !== 2) throw new SensorOffline(); return 22 } })) { const worker = fork sampleContinuously(); try TestClock.adjust("11 seconds"); try Fiber.interrupt(worker) }
error SensorOffline

service Sensor {
  read(): number!SensorOffline
}

effect sampleContinuously() {
  try repeat(effect {
    const sample = effect {
      const sensor = try Sensor
      return ["sample", try sensor.read()] as const
    } catch (error) => match (error) {
      when SensorOffline: ["sample unavailable", error._tag] as const
    }
    try Console.log(...sample)
  }, Schedule.spaced("5 seconds"))
}
// Output: sample unavailable SensorOffline
// Output: sample 22
// Output: sample unavailable SensorOffline
```

When later samples should still run, handle a recoverable failure inside the repeated Effect; a `catch` outside `repeat` recovers after the loop has stopped. `Effect.repeatOrElse` instead stops repetition and calls a fallback with the failure and an `Option` of the latest schedule metadata, empty before any schedule step.

## Coming from Effect

Pass `sample()` where Effect expects the computation. Schedule constructors and count semantics are unchanged; use `effect { }` for the generator body and `try` to run its Effects.
