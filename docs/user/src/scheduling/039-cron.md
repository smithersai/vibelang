# Scheduling work with cron

`Cron` and `Schedule.cron` align work with calendar dates and wall-clock times, matching Effect's behavior unchanged. Reach for cron on calendar jobs such as weekday reports; use interval schedules (`spaced`, `fixed`) when only elapsed duration matters.

| API | Purpose |
| --- | --- |
| `Schedule.cron(expr, tz)` / `Schedule.cron(rule)` | Builds a `Schedule` firing on each matching instant |
| `Cron.parse(expr, tz)` | Validates an expression and time zone, returning a `Result<Cron, CronParseError>` |
| `Cron.next(rule, date)` | Computes the next matching `Date` after `date` |
| `Cron.sequence(rule, date)` | Iterates lazily over future matching instants |
| `Cron.match(rule, date)` | Tests whether a `Date` satisfies `rule` |

## Defining calendar execution

```vibe
// run: provide TestClock.layer() { try TestClock.setTime(Date.parse("2026-11-02T00:00:00Z")); const worker = fork reportJob(); try Console.log("waiting for Monday morning"); try TestClock.adjust("3 days"); try Fiber.interrupt(worker) }
const weekdayReport = Schedule.cron("45 7 * * 1-5", "UTC")

effect function reportJob() {
  try schedule(Console.log("generating daily report"), weekdayReport)
}
// Output: waiting for Monday morning
// Output: generating daily report
// Output: generating daily report
// Output: generating daily report
```

The five fields are minute, hour, day-of-month, month, and weekday, accepting `*`, ranges, comma lists, and steps like `*/10`; an optional leading seconds field (`0 45 7 * * 1-5`) is also accepted.

When both day-of-month and weekday are restricted, matching *either* triggers the job—keep day-of-month as `*` for weekday-only rules. Run cron jobs with `try schedule(action, rule)` so the first execution waits for the next matching instant rather than firing at startup.

## Selecting a time zone

```vibe
// run: for (const date of ["2026-10-30T00:00:00Z", "2026-11-02T00:00:00Z"]) { const waits: number[] = []; for (const rule of [localMorning, fixedUtc]) { const step = try Schedule.toStep(rule); const outcome = try result(step(Date.parse(date), undefined)); if (Result.isSuccess(outcome)) waits.push(Duration.toMillis(outcome.success[1])) }; { const jsonValue = waits; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
const localMorning = Schedule.cron("45 7 * * 1-5", "America/Los_Angeles")
const fixedUtc = Schedule.cron("45 7 * * 1-5", "UTC")
// Output: [53100000,27900000]
// Output: [56700000,27900000]
```

Always pass an explicit time zone instead of relying on the host's locale. Named IANA zones track daylight saving transitions while `"UTC"` keeps a fixed offset year-round; test around spring-forward and fall-back boundaries when scheduling local wall-clock times.

## Validating expressions

```vibe
// run: try Console.log(Result.isSuccess(try result(validateRule("45 7 * * 1-5", "UTC")))); for (const [expression, zone] of [["not cron", "UTC"], ["* * * * *", "invalid/zone"]]) { const outcome = try result(validateRule(expression, zone)); if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag) }
effect function validateRule(expression: string, timeZone: string) {
  return try fromResult(Cron.parse(expression, timeZone))
}
// Cron.Cron!Cron.CronParseError
// Output: true
// Output: CronParseError
// Output: CronParseError
```

`Cron.parse` returns a `Result` without failing the Effect; convert it with `try fromResult(...)` so bad expressions or unknown time zones surface as `Cron.CronParseError` in `E`. Validate user- or config-supplied rules at startup before launching background fibers.

## Previewing future runs

```vibe
// run: { const jsonValue = try preview(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function preview() {
  const rule = try fromResult(Cron.parse("45 7 * * 1-5", "UTC"))
  let after = new Date("2026-11-02T00:00:00Z")
  const dates: string[] = []
  for (let i = 0; i < 3; i++) {
    after = try Effect.try(() => Cron.next(rule, after))
    dates.push(try Effect.try(() => after.toISOString()))
  }
  return dates
}
// Output: ["2026-11-02T07:45:00.000Z","2026-11-03T07:45:00.000Z","2026-11-04T07:45:00.000Z"]
```

Pass explicit anchor dates to `Cron.next` for reproducible previews, wrapping throwing helpers in `Effect.try`. Reach for `Cron.sequence` to stream upcoming matches and `Cron.match` to check an existing timestamp.

## Starting and stopping a job

```vibe
// run: provide TestClock.layer() { try TestClock.setTime(Date.parse("2026-11-02T00:09:45Z")); const app = fork runApplication(); try TestClock.adjust("31 seconds"); join app; try Console.log("application stopped"); try TestClock.adjust("10 minutes") }
effect function runApplication() {
  const rule = try fromResult(Cron.parse("*/10 * * * *", "UTC"))
  const reports = fork schedule(
    Console.log("report tick"),
    Schedule.cron(rule)
  )

  try sleep("30 seconds") // Stand-in for the application's active lifetime.
  try Fiber.interrupt(reports)
}
// Output: report tick
// Output: application stopped
```

Tie the forked job fiber to the application scope that owns it: `try Fiber.interrupt(reports)` waits for active cleanup, and structured concurrency interrupts child fibers automatically when the parent exits. Unhandled failures stop the schedule, so catch or retry recoverable errors inside the job body.

In-memory cron jobs do not survive restarts or recover missed ticks. Use an external scheduler or durable work records when missed runs must execute after downtime.
