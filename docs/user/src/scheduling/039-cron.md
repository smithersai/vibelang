# Scheduling work with cron

`Cron` and `Schedule.cron` work in VibeLang exactly as in Effect. Use them for work tied to calendar dates, such as a weekday report; use interval schedules when only elapsed time matters.

## Defining calendar execution

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
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

The five fields are minute, hour, day of month, month, and weekday. This rule runs at 07:45 Monday through Friday; with the optional leading seconds field, `0 45 7 * * 1-5` is equivalent. Fields accept `*`, ranges, comma separated lists, and steps such as `*/10`.

When day of month and weekday both restrict dates, either field can match, so leave day of month as `*` in a weekday rule. `try schedule(action, rule)` waits for the first match, so the report doesn't run immediately at startup.

## Selecting a time zone

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: for (const date of ["2026-10-30T00:00:00Z", "2026-11-02T00:00:00Z"]) { const waits: number[] = []; for (const rule of [localMorning, fixedUtc]) { const step = try Schedule.toStep(rule); const outcome = try result(step(Date.parse(date), undefined)); if (Result.isSuccess(outcome)) waits.push(Duration.toMillis(outcome.success[1])) }; { const jsonValue = waits; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
const localMorning = Schedule.cron("45 7 * * 1-5", "America/Los_Angeles")
const fixedUtc = Schedule.cron("45 7 * * 1-5", "UTC")
// Output: [53100000,27900000]
// Output: [56700000,27900000]
```

A named zone follows its local calendar, daylight saving changes included; `UTC` keeps one offset all year. Test dates near clock changes, especially times that disappear or occur twice, and pass the zone explicitly instead of depending on the machine's location.

## Validating expressions

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(Result.isSuccess(try result(validateRule("45 7 * * 1-5", "UTC")))); for (const [expression, zone] of [["not cron", "UTC"], ["* * * * *", "invalid/zone"]]) { const outcome = try result(validateRule(expression, zone)); if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag) }
effect function validateRule(expression: string, timeZone: string) {
  return try fromResult(Cron.parse(expression, timeZone))
}
// Cron.Cron!Cron.CronParseError!
// Output: true
// Output: CronParseError
// Output: CronParseError
```

`Cron.parse` returns a `Result`, so parsing alone throws no typed failure; `try fromResult(Cron.parse(...))` puts invalid expressions and invalid zones in the error channel. Validate configuration before starting any work, and report the configuration error at the application boundary.

## Previewing future runs

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
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

`Cron.next` finds the next matching instant after the given date; explicit dates make a preview reproducible. Wrap calls that can throw with `Effect.try`, then run them with `try`. `Cron.sequence` iterates over future matches, and `Cron.match` tests an existing date against a rule.

## Starting and stopping a job

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
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

Keep the job's fiber alive for the part of the application that needs it. `try Fiber.interrupt(reports)` waits for cleanup, and parent-fiber ownership also interrupts this child when its parent ends. A failure stops the schedule unless the action handles it or retries internally.

These cron jobs exist only in memory. For a job that must survive restarts or recover missed dates, use an external scheduler or durable pending-work records.
