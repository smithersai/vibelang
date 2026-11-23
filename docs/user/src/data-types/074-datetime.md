# DateTime

`DateTime` represents an immutable instant in time—either pure `Utc` or `Zoned` with an attached `TimeZone`—along with parsing, calendar math, and formatting. Use it instead of mutable JavaScript `Date` instances whenever you need testable clocks, explicit time zones, or DST-aware calendar arithmetic.

| Task | Key APIs |
| --- | --- |
| Construct | `make`, `makeZoned`, `makeZonedFromString`, `makeUnsafe`, `fromDateUnsafe`, `makeZonedUnsafe` |
| Read clock | `try DateTime.now`, `try DateTime.nowInCurrentZone` |
| Time zones | `zoneMakeNamed`, `zoneFromString`, `zoneMakeOffset`, `zoneMakeNamedEffect`, `setZone`, `setZoneOffset` |
| Compare & convert | `isLessThan`, `min`, `max`, `between`, `distance`, `toEpochMillis`, `toDateUtc`, `removeTime` |
| Calendar & format | `getPart`/`toParts`/`setParts` (`*Utc`), `add`/`subtract`, `addDuration`, `startOf`/`endOf`, `formatIso*`, `format` |

## Modeling UTC and zoned instants

```vibe
// run: try Console.log(instant.epochMilliseconds === paris.epochMilliseconds); try Console.log(DateTime.formatIsoZoned(paris))
const instant = DateTime.makeUnsafe("2026-04-12T10:00:00Z")
const paris = DateTime.setZone(instant, DateTime.zoneMakeNamedUnsafe("Europe/Paris"))
instant.epochMilliseconds === paris.epochMilliseconds // true
DateTime.formatIsoZoned(paris) // "2026-04-12T12:00:00.000+02:00[Europe/Paris]"
```

```output
true
2026-04-12T12:00:00.000+02:00[Europe/Paris]
```

A `Utc` value stores epoch milliseconds; a `Zoned` value adds a `TimeZone` (either a fixed millisecond offset or a named IANA region with daylight saving rules). Attaching a zone changes the calendar projection without shifting the underlying instant.

## Constructing timestamps from supported inputs

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([Option.getOrNull(Option.map(text, DateTime.formatIso)), Option.getOrNull(Option.map(epoch, DateTime.formatIso)), Option.getOrNull(Option.map(parts, DateTime.formatIso)), DateTime.formatIso(date), Option.isNone(invalid), Option.getOrNull(Option.map(localAppointment, DateTime.formatIsoZoned)), Option.getOrNull(Option.map(serialized, DateTime.formatIsoZoned))])))
const text = DateTime.make("2026-04-12T10:00:00Z")
const epoch = DateTime.make(0)
const parts = DateTime.make({ year: 2026, month: 4, day: 12 })
const date = DateTime.fromDateUnsafe(new Date("2026-04-12T10:00:00Z"))
const invalid = DateTime.make("not a timestamp") // None

const localAppointment = DateTime.makeZoned(
  { year: 2026, month: 4, day: 12, hour: 10 },
  { timeZone: "Europe/Paris", adjustForTimeZone: true }
)
const serialized = DateTime.makeZonedFromString(
  "2026-04-12T10:00:00.000+02:00[Europe/Paris]"
)
```

```output
["2026-04-12T10:00:00.000Z","1970-01-01T00:00:00.000Z","2026-04-12T00:00:00.000Z","2026-04-12T10:00:00.000Z",true,"2026-04-12T10:00:00.000+02:00[Europe/Paris]","2026-04-12T10:00:00.000+02:00[Europe/Paris]"]
```

`DateTime.Input` accepts a `DateTime`, `Date`, epoch milliseconds, partial calendar parts, or a timestamp string (prefer explicit UTC or offset strings to avoid host-dependent parsing). Safe constructors (`make`, `makeZoned`) return `Option`; `*Unsafe` variants throw on invalid input.

Set `adjustForTimeZone: true` to interpret input parts as local wall-clock time in the target zone rather than attaching the zone to a UTC instant; use `disambiguation` to resolve DST spring-forward gaps and fall-back overlaps.

## Reading current time

```vibe
// run: provide TestClock.layer() { try TestClock.setTime(0); try Console.log(try timestamp()) }
effect function timestamp() {
  const now = try DateTime.now
  return DateTime.formatIso(now)
}
// string!!
```

```output
1970-01-01T00:00:00.000Z
```

`DateTime.now` is an Effect that reads UTC time through Effect's `Clock`, allowing deterministic control via `TestClock`. Always read application time with `try DateTime.now` rather than `Date.now()`, `new Date()`, or `DateTime.nowUnsafe`.

## Identifying timestamp variants

```vibe
// run: try Console.log(describe(null), describe(instant), describe(paris), describe(DateTime.setZoneOffset(instant, 3600000)))
function describe(value: unknown) {
  if (!DateTime.isDateTime(value)) return "not a timestamp"
  if (DateTime.isUtc(value)) return "UTC"
  if (DateTime.isZoned(value)) {
    if (DateTime.isTimeZoneNamed(value.zone)) return value.zone.id
    if (DateTime.isTimeZoneOffset(value.zone)) return String(value.zone.offset)
  }
  return "unknown"
}
```

```output
not a timestamp UTC Europe/Paris 3600000
```

Use `isDateTime`, `isUtc`, and `isZoned` to narrow timestamps, and `isTimeZone`, `isTimeZoneNamed`, and `isTimeZoneOffset` to inspect a zone's `.id` or fixed `.offset`.

## Parsing and changing time zones

```vibe
// run: try Console.log(Option.isSome(named), Option.isSome(parsed), DateTime.zoneToString(fixed), Option.isSome(optional)); try Console.log(DateTime.formatIsoZoned(known)); try Console.log(DateTime.formatIsoOffset(shiftedView)); provide TestClock.layer() { try TestClock.setTime(0); try Console.log(DateTime.formatIsoZoned(try inTokyo())) }
const named = DateTime.zoneMakeNamed("Asia/Tokyo")
const parsed = DateTime.zoneFromString("+09:00")
const fixed = DateTime.zoneMakeOffset(9 * 60 * 60 * 1000)
DateTime.zoneToString(fixed) // "+09:00"

effect function inTokyo() {
  const zone = try DateTime.zoneMakeNamedEffect("Asia/Tokyo")
  const now = try DateTime.now
  return DateTime.setZone(now, zone)
}

const base = DateTime.makeUnsafe("2026-04-12T10:00:00Z")
const optional = DateTime.setZoneNamed(base, "Asia/Tokyo")
const known = DateTime.setZoneNamedUnsafe(base, "Asia/Tokyo")
const shiftedView = DateTime.setZoneOffset(base, 9 * 60 * 60 * 1000)
```

```output
true true +09:00 true
2026-04-12T19:00:00.000+09:00[Asia/Tokyo]
2026-04-12T19:00:00.000+09:00
1970-01-01T09:00:00.000+09:00[Asia/Tokyo]
```

On an unknown zone ID, `zoneMakeNamed` and `zoneFromString` return `None`, `zoneMakeNamedEffect` fails with `IllegalArgumentError`, and `zoneMakeNamedUnsafe` throws. Prefer an explicit configured zone over `zoneMakeLocal` for host-independent output.

## Comparing and converting instants

```vibe
// run: try Console.log(DateTime.isLessThan(start, end), Equal.equals(DateTime.min(start, end), start), Equal.equals(DateTime.max(start, end), end), Duration.toHours(DateTime.distance(start, end)), Duration.toHours(DateTime.distance(end, start))); try Console.log(DateTime.toEpochMillis(start), native.toISOString(), DateTime.formatIso(calendarDate))
const start = DateTime.makeUnsafe("2026-04-12T10:00:00Z")
const end = DateTime.add(start, { hours: 3 })
DateTime.isLessThan(start, end) // true
DateTime.min(start, end) // start
DateTime.max(start, end) // end
Duration.toHours(DateTime.distance(start, end)) // 3
DateTime.toEpochMillis(start) // numeric Unix timestamp
const native = DateTime.toDateUtc(start)
const calendarDate = DateTime.removeTime(start)
```

```output
true true true 3 -3
1775988000000 2026-04-12T10:00:00.000Z 2026-04-12T00:00:00.000Z
```

Comparisons (`isLessThan`, `isLessThanOrEqualTo`, `isGreaterThan`, `isGreaterThanOrEqualTo`, inclusive `between`, `min`, `max`) operate on instants regardless of zone, and `distance(start, end)` returns a signed `Duration`. Use `toDateUtc` to preserve the instant as a JavaScript `Date` (`toDate` shifts the timestamp for local calendar display), `isFuture`/`isPast` to compare against `Clock`, and `zonedOffset`/`zonedOffsetIso` to read a zoned value's active offset.

## Accessing calendar components

```vibe
// run: try Console.log(DateTime.getPart(evening, "day"), DateTime.getPartUtc(evening, "day"), localParts.hour, utcParts.hour); try Console.log(DateTime.formatIsoZoned(rescheduled)); try Console.log(DateTime.formatIso(utcEdited))
const evening = DateTime.makeZonedUnsafe("2026-04-12T22:30:00Z", {
  timeZone: "Asia/Tokyo"
})
DateTime.getPart(evening, "day") // 13
DateTime.getPartUtc(evening, "day") // 12
const localParts = DateTime.toParts(evening)
const utcParts = DateTime.toPartsUtc(evening)
const rescheduled = DateTime.setParts(evening, { hour: 9, minute: 0 })
const utcEdited = DateTime.setPartsUtc(evening, { hour: 9 })
```

```output
13 12 7 22
2026-04-13T09:00:00.000+09:00[Asia/Tokyo]
2026-04-12T09:30:00.000Z
```

`Parts` contains 1-indexed `month` alongside `year`, `day`, `hour`, `minute`, `second`, and `millisecond` (`PartsWithWeekday` adds `weekDay`). The `*Utc` functions ignore any attached zone.

## Calendar arithmetic and formatting

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([DateTime.formatIso(tomorrow), DateTime.formatIso(previous), DateTime.formatIso(elapsedHour), DateTime.formatIso(earlier), DateTime.formatIso(dayStart), DateTime.formatIso(dayEnd), DateTime.formatIso(rounded), DateTime.formatIsoDate(appointment), DateTime.formatIsoDateUtc(appointment), DateTime.formatIsoOffset(appointment), DateTime.format(appointment, { locale: "en-GB", dateStyle: "long" })])))
const appointment = DateTime.makeZonedUnsafe("2026-04-12T10:00:00Z", {
  timeZone: "Europe/Paris"
})
const tomorrow = DateTime.add(appointment, { days: 1 })
const previous = DateTime.subtract(appointment, { months: 1 })
const elapsedHour = DateTime.addDuration(appointment, Duration.hours(1))
const earlier = DateTime.subtractDuration(appointment, Duration.minutes(15))
const dayStart = DateTime.startOf(appointment, "day")
const dayEnd = DateTime.endOf(appointment, "day")
const rounded = DateTime.nearest(appointment, "hour")
DateTime.formatIso(tomorrow) // "2026-04-13T10:00:00.000Z"
DateTime.formatIsoDate(appointment) // "2026-04-12"
DateTime.formatIsoDateUtc(appointment) // "2026-04-12"
DateTime.formatIsoOffset(appointment) // "2026-04-12T12:00:00.000+02:00"
DateTime.format(appointment, { locale: "en-GB", dateStyle: "long" })
```

```output
["2026-04-13T10:00:00.000Z","2026-03-12T11:00:00.000Z","2026-04-12T11:00:00.000Z","2026-04-12T09:45:00.000Z","2026-04-11T22:00:00.000Z","2026-04-12T21:59:59.999Z","2026-04-12T10:00:00.000Z","2026-04-12","2026-04-12","2026-04-12T12:00:00.000+02:00","12 April 2026"]
```

`add` and `subtract` adjust calendar fields in the value's time zone, whereas `addDuration` and `subtractDuration` add exact elapsed time—diverging across DST boundaries. For output, `formatIsoZoned` preserves named zones, `formatUtc` forces UTC, `formatLocal` uses the host zone, and `formatIntl` reuses an existing `Intl.DateTimeFormat`.

## Providing a default time zone

```vibe
// run: provide TestClock.layer() { try TestClock.setTime(0); try Console.log(try main()) }
effect function localDate() {
  return DateTime.formatIsoDate(try DateTime.nowInCurrentZone)
}
// string!!DateTime.CurrentTimeZone

effect function main() {
  provide DateTime.layerCurrentZoneNamed("Asia/Tokyo") { return try localDate() }
}
```

```output
1970-01-01
```

`DateTime.CurrentTimeZone` supplies the ambient zone for `nowInCurrentZone` and `setZoneCurrent`. Provide it as a layer (`layerCurrentZone`, `layerCurrentZoneNamed`—which fails on invalid IDs—`layerCurrentZoneOffset`, `layerCurrentZoneLocal`) or around a single Effect value (`withCurrentZone`, `withCurrentZoneNamed`, `withCurrentZoneOffset`, `withCurrentZoneLocal`).
