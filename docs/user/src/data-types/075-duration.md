# Duration

`Duration` works in VibeLang exactly as in Effect. Use it for elapsed time, delays, and timeout budgets with explicit units; Effect 4.0.6 also supports negative durations and infinities.

## Constructing finite and infinite durations

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify([String(try Effect.try(() => Duration.toNanosUnsafe(small))), String(try Effect.try(() => Duration.toNanosUnsafe(micro))), Duration.toMillis(polling), Duration.toSeconds(budget), Duration.toMinutes(session), Duration.toHours(shift), Duration.toDays(retention), Duration.toWeeks(fortnight), String(unbounded), Duration.toSeconds(negative)]))
const small = Duration.nanos(750n)
const micro = Duration.micros(20n)
const polling = Duration.millis(250)
const budget = Duration.seconds(12)
const session = Duration.minutes(15)
const shift = Duration.hours(8)
const retention = Duration.days(3)
const fortnight = Duration.weeks(2)
const unbounded = Duration.infinity
const negative = Duration.seconds(-2)
```

```output
["750","20000",250,12,15,8,3,2,"Infinity",-2]
```

Constructors name the unit at the call site. `infinity` is an unbounded positive span and `negativeInfinity` its negative counterpart. A day is a fixed 24 hours, not a calendar day across daylight saving changes.

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(Duration.toMillis(milliseconds), String(try Effect.try(() => Duration.toNanosUnsafe(nanoseconds))), Duration.toSeconds(text), Option.isSome(checked), Option.isNone(Duration.fromInput("invalid" as Duration.Input)))
const milliseconds = Duration.fromInputUnsafe(240)
const nanoseconds = Duration.fromInputUnsafe(240n)
const text = Duration.fromInputUnsafe("3 seconds")
const checked = Duration.fromInput("3 seconds")
```

```output
240 240 3 true true
```

`fromInputUnsafe` accepts durations, numeric milliseconds, bigint nanoseconds, and supported duration strings, and throws for invalid input; `fromInput` returns an `Option` instead. When you know the unit, prefer its constructor.

## Extracting values in chosen units

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify([Duration.toMillis(delay), Duration.toSeconds(delay), Duration.toMinutes(delay), Duration.toHours(delay), Duration.toDays(Duration.weeks(1)), Duration.toWeeks(Duration.days(14)), String(try Effect.try(() => Option.getOrThrow(Duration.toNanos(Duration.millis(3))))), Option.isNone(Duration.toNanos(Duration.infinity))]))
const delay = Duration.minutes(2)
Duration.toMillis(delay) // 120000
Duration.toSeconds(delay) // 120
Duration.toMinutes(delay) // 2
Duration.toHours(delay) // 1 / 30
Duration.toDays(Duration.weeks(1)) // 7
Duration.toWeeks(Duration.days(14)) // 2
Duration.toNanos(Duration.millis(3)) // Some containing 3000000n
Duration.toNanos(Duration.infinity) // None
```

```output
[120000,120,2,0.03333333333333333,7,2,"3000000",true]
```

Numeric conversions return a number in the requested unit. `toNanos` returns an `Option.Option<bigint>`, since infinity has no bigint form; `toNanosUnsafe` returns the bigint for finite input and throws for infinite input.

## Comparing durations

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Duration.isLessThan(elapsed, budget), Duration.isLessThanOrEqualTo(elapsed, elapsed), Duration.isGreaterThan(budget, elapsed), Duration.isGreaterThanOrEqualTo(budget, budget), Duration.equals(Duration.seconds(1), Duration.millis(1000)))
const elapsed = Duration.seconds(9)
const budget = Duration.seconds(12)
Duration.isLessThan(elapsed, budget) // true
Duration.isLessThanOrEqualTo(elapsed, elapsed) // true
Duration.isGreaterThan(budget, elapsed) // true
Duration.isGreaterThanOrEqualTo(budget, budget) // true
Duration.equals(Duration.seconds(1), Duration.millis(1000)) // true
```

```output
true true true true true
```

Comparison uses the elapsed span, whatever the constructor. Compare durations directly rather than converting them to a less precise unit first.

## Adding and scaling durations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17, VIP-33
// run: provide TestClock.layer() { try TestClock.setTime(0); const waiting = fork waitBeforeRetry(); try TestClock.adjust("9 seconds"); join waiting; try Console.log(Duration.toMillis(doubled), try Clock.currentTimeMillis) }
const attempt = Duration.seconds(4)
const overhead = Duration.millis(500)
const total = Duration.sum(attempt, overhead)
const doubled = Duration.times(total, 2)
Duration.toMillis(doubled) // 9000

effect waitBeforeRetry() {
  try sleep(doubled)
}
```

```output
9000 9000
```

`sum` adds spans and `times` scales by a number; both return new values. `sleep` accepts the result and waits when run with `try` inside an effect function or block.

## Converting and formatting

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(Duration.format(Duration.millis(6250)), String(Duration.infinity), String(try Effect.try(() => Duration.toNanosUnsafe(Duration.millis(2)))))
Duration.format(Duration.millis(6250)) // "6s 250ms"
String(Duration.infinity) // "Infinity"
Duration.toNanosUnsafe(Duration.millis(2)) // 2000000n
```

```output
6s 250ms Infinity 2000000
```

Use `format` for a compact display string and explicit unit conversions for calculations. Formatted text is presentation; when a wire protocol requires a numeric unit, store that.
