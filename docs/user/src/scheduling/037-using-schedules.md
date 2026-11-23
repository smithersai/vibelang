# Using schedules

A `Schedule` governs when an Effect runs again and when repetition ends. Pass an Effect value to `repeat`, `schedule`, or `retry` and run the result with `try`; schedules live in process memory and do not replay jobs missed during downtime.

![Retrying an Effect with a composable Schedule](/diagrams/retry-schedule-flow.svg)

| Driver | First run | Advances schedule on | Stops immediately on |
| --- | --- | --- | --- |
| `repeat` | Immediate | Success (`A`) | Typed failure, defect, or interruption |
| `schedule` | After first schedule delay | Success (`A`) | Typed failure, defect, or interruption |
| `retry` | Immediate | Expected failure (`E`) | Success, defect, or interruption |

## Repeating successful computations

```vibe
// run: provide TestClock.layer() { const worker = fork heartbeat(); try TestClock.adjust("46 seconds"); try Fiber.interrupt(worker) }
effect function heartbeat() {
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

`repeat` executes the Effect immediately and advances the schedule after each success—here waiting fifteen seconds after every completed log. Any failure ends the loop, and interruption cancels it.

## Stopping based on a result

```vibe
// run: { const jsonValue = try waitForBuild(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function waitForBuild() {
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

`times: 7` bounds repetitions beyond the initial execution, allowing at most eight checks. `until` stops once its predicate matches, while `while` keeps looping while its predicate holds; if `times` exhausts first, `repeat` returns the last result, so inspect it rather than assuming the predicate matched.

## Delaying the initial run

```vibe
// run: provide TestClock.layer() { const worker = fork delayedCleanup(); try Console.log("before first sweep"); try TestClock.adjust("60 minutes"); try Fiber.interrupt(worker) }
effect function delayedCleanup() {
  try schedule(
    Console.log("sweeping expired sessions"),
    Schedule.spaced("30 minutes")
  )
}
// Output: before first sweep
// Output: sweeping expired sessions
// Output: sweeping expired sessions
```

`schedule` waits for the first schedule delay before executing the action—here thirty minutes after startup, then thirty minutes after each completed sweep. Use it for calendar jobs and deferred maintenance where an immediate startup run is undesirable.

## Retrying failed computations

```vibe
// run: try Console.log(try reserveSlot())
error Busy

effect function reserveSlot() {
  let attempts = 0
  return try retry(effect {
    attempts++
    if (attempts < 3) throw new Busy()
    return "reserved"
  }, Schedule.recurs(3))
}
// string!Busy
// Output: reserved
```

`retry` advances the schedule only on expected failures and returns on the first success. `Schedule.recurs(3)` permits three retries after the initial run (four attempts total); defects and interruption bypass retry.

## Handling failures while repeating

```vibe
// run: let reads = 0; provide Layer.mergeAll(TestClock.layer(), Layer.succeed(Sensor, { read: effect () => { reads++; if (reads !== 2) throw new SensorOffline(); return 22 } })) { const worker = fork sampleContinuously(); try TestClock.adjust("11 seconds"); try Fiber.interrupt(worker) }
error SensorOffline

service Sensor {
  read(): number!SensorOffline
}

effect function sampleContinuously() {
  try repeat(effect {
    const sample = effect {
      const sensor = try Sensor
      return ["sample", try sensor.read()] as const
    } catch (error) => match (error) {
      when SensorOffline: ["sample unavailable", error._tag] as const;
    }
    try Console.log(...sample)
  }, Schedule.spaced("5 seconds"))
}
// Output: sample unavailable SensorOffline
// Output: sample 22
// Output: sample unavailable SensorOffline
```

Handle recoverable errors inside the repeated Effect so later iterations keep running; a `catch` outside `repeat` only runs after the loop terminates. `Effect.repeatOrElse` terminates on failure and invokes a fallback with the error and an `Option` of the latest schedule metadata (empty if no schedule step ran yet).

## Coming from Effect

Pass an unexecuted Effect value such as `sample()` to `repeat`, `schedule`, or `retry`. Schedule constructors and count semantics match Effect unchanged; wrap multi-statement bodies in `effect { }` and run inner Effects with `try`.
