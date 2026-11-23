# Choosing and combining schedules

`Schedule` values in VibeLang work exactly as in Effect: pick a base timing rule, attach bounds or jitter, and combine schedules only when a job needs multiple constraints. The driver supplies each step's input—the latest success in `repeat`, or the latest expected error in `retry`.

## Choosing a starting rule

```vibe
// run: const rules: ReadonlyArray<Schedule.Schedule<unknown, unknown, Cron.CronParseError>> = [immediate, afterCompletion, cadence, backoff, calendar]; for (const rule of rules) { const step = try Schedule.toStep(rule); const outcome = try result(step(Date.parse("2026-11-02T00:00:00Z"), undefined)); if (Result.isSuccess(outcome)) try Console.log(Duration.toMillis(outcome.success[1])) }
const immediate = Schedule.recurs(4)
const afterCompletion = Schedule.spaced("20 seconds")
const cadence = Schedule.fixed("20 seconds")
const backoff = Schedule.exponential("300 millis")
const calendar = Schedule.cron("15 4 * * *", "UTC")
// Output: 0
// Output: 20000
// Output: 20000
// Output: 300
// Output: 15300000
```

These constructors return reusable, inert schedule values.

| Requirement | Constructor | Next step timing |
| --- | --- | --- |
| Fixed extra runs | `Schedule.recurs(n)` | Immediately, up to `n` recurrences |
| Pause after completion | `Schedule.spaced(d)` | Full delay `d` after each run finishes |
| Regular cadence | `Schedule.fixed(d)` | Next interval boundary on a fixed grid |
| Growing retry delay | `Schedule.exponential(d)` / `Schedule.fibonacci(d)` | Increasing waits (exponential doubles by default) |
| Calendar schedule | `Schedule.cron(expr, tz)` | Next matching wall-clock instant in `tz` |

Interval and backoff schedules run indefinitely until bounded.

## Understanding schedule steps

```vibe
// run: provide TestClock.layer() { const worker = fork runChecks(); try TestClock.adjust("18 seconds"); join worker }
effect function runChecks() {
  try repeat(effect {
    try Console.log("checking", try Clock.currentTimeMillis)
    try sleep("2 seconds")
  }, Schedule.spaced("6 seconds").pipe(Schedule.upTo({ times: 2 })))
}
// Output: checking 0
// Output: checking 8000
// Output: checking 16000
```

Under `repeat`, the first run happens before the schedule steps, so `spaced("6 seconds")` starts runs at 0 s, 8 s, and 16 s. With `fixed("6 seconds")`, runs start at 0 s, 8 s, and 14 s because `fixed` anchors its cadence on its first step (after the two-second initial run) and skips missed slots instead of replaying overruns.

Each step consumes the latest input and emits an output alongside timing metadata. Separate loops reusing the same `Schedule` value maintain independent state.

## Limiting duration and adjusting delays

```vibe
// run: try Random.withSeed(effect { const rules: ReadonlyArray<Schedule.Schedule<unknown>> = [bounded, firstThree]; for (const rule of rules) { const step = try Schedule.toStep(rule); let now = 0; const waits: number[] = []; for (let i = 0; i < 10; i++) { const outcome = try result(step(now, undefined)); if (Result.isFailure(outcome)) break; const ms = Duration.toMillis(outcome.success[1]); waits.push(ms); now += ms }; try Console.log(waits.length, waits.every((ms) => ms >= 0 && ms <= 9600)) } }, "docs-schedule")
const bounded = Schedule.exponential("300 millis").pipe(
  Schedule.modifyDelay(effect ({ duration }) => Duration.min(duration, Duration.seconds(8))),
  Schedule.jittered,
  Schedule.upTo({ times: 6, duration: "40 seconds" })
)

const firstThree = Schedule.while(
  Schedule.spaced("1 second"),
  ({ attempt }) => attempt <= 3
)
// Output: 6 true
// Output: 3 true
```

`Schedule.upTo` stops when either `times` or `duration` is reached, checking elapsed duration only at schedule steps—it never interrupts an in-flight attempt or wait (wrap the call in `timeout` for a hard deadline). `Schedule.modifyDelay` rewrites each proposed wait, and `Schedule.while` filters on step metadata. `Schedule.jittered` scales delays randomly between 0.8x and 1.2x; placing it after an 8-second cap allows waits up to 9.6 seconds, so cap after `jittered` when an upper bound is strict.

## Combining multiple schedules

| Combinator | Continues while | Selected delay |
| --- | --- | --- |
| `Schedule.max([...])` | Every input can continue | Longest proposed delay |
| `Schedule.min([...])` | Any input can continue | Shortest active delay |
| `Schedule.concat(next)` | Runs first to exhaustion, then `next` | Active phase's delay |

## Requiring every timing rule

```vibe
// run: const step = try Schedule.toStep(policy); let now = 0; const waits: number[] = []; for (let i = 0; i < 5; i++) { const outcome = try result(step(now, undefined)); if (Result.isFailure(outcome)) break; const ms = Duration.toMillis(outcome.success[1]); waits.push(ms); now += ms }; { const jsonValue = waits; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const policy = Schedule.max([
  Schedule.exponential("400 millis"),
  Schedule.spaced("2 seconds")
]).pipe(Schedule.upTo({ times: 4 }))
// Output: [2000,2000,2000,3200]
```

`Schedule.max` advances only while every member schedule agrees to continue, taking the longest proposed delay on each step. Piping `Schedule.upTo({ times: 4 })` caps the combined schedule at four recurrences.

## Accepting any timing rule

```vibe
// run: const step = try Schedule.toStep(startupAndSteady); let now = 0; const waits: number[] = []; for (let i = 0; i < 5; i++) { const outcome = try result(step(now, undefined)); if (Result.isFailure(outcome)) break; const ms = Duration.toMillis(outcome.success[1]); waits.push(ms); now += ms }; { const jsonValue = waits; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const startupAndSteady = Schedule.min([
  Schedule.spaced("500 millis").pipe(Schedule.upTo({ times: 2 })),
  Schedule.fixed("12 seconds")
])
// Output: [500,500,11000,12000,12000]
```

`Schedule.min` runs as long as at least one member remains active, picking the shortest active wait. Because both schedules step from the start, the two 500-millisecond probes do not shift the 12-second fixed cadence.

## Switching rules in phases

```vibe
// run: const step = try Schedule.toStep(reconnect); let now = 0; const waits: number[] = []; for (let i = 0; i < 8; i++) { const outcome = try result(step(now, undefined)); if (Result.isFailure(outcome)) break; const ms = Duration.toMillis(outcome.success[1]); waits.push(ms); now += ms }; { const jsonValue = waits; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const reconnect = Schedule.spaced("150 millis").pipe(
  Schedule.upTo({ times: 2 }),
  Schedule.concat(Schedule.spaced("3 seconds").pipe(Schedule.upTo({ times: 5 })))
)
// Output: [150,150,3000,3000,3000,3000,3000]
```

`Schedule.concat` runs the first schedule until exhaustion, then begins the second—under `retry`, giving one initial run, two fast retries, and five slow retries. Use `Schedule.concatResult` when callers must distinguish which phase produced a step's output.
