# DateTime

`DateTime` works in VibeLang exactly as in Effect. It represents immutable instants, optionally with a time zone, and provides parsing, calendar operations, and formatting without mutating a JavaScript `Date`.

## Modeling UTC and zoned instants

```vibe
// pending: VIP-5, VIP-14
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

A `Utc` holds epoch milliseconds; a `Zoned` adds a `TimeZone`, either a fixed millisecond offset or a named region with daylight saving rules. Attaching a zone normally changes the calendar view, not the instant.

## Constructing timestamps from supported inputs

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([Option.getOrNull(Option.map(text, DateTime.formatIso)), Option.getOrNull(Option.map(epoch, DateTime.formatIso)), Option.getOrNull(Option.map(parts, DateTime.formatIso)), DateTime.formatIso(date), Option.isNone(invalid), Option.getOrNull(Option.map(localAppointment, DateTime.formatIsoZoned)), Option.getOrNull(Option.map(serialized, DateTime.formatIsoZoned))]))
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

`DateTime.Input` is a `DateTime`, a JavaScript `Date`, epoch milliseconds, partial calendar parts, or a parseable string. `make` and `makeZoned` return an `Option`; `makeUnsafe`, `fromDateUnsafe`, and `makeZonedUnsafe` throw for invalid input. Explicit offsets or UTC strings avoid host-dependent parsing.

`adjustForTimeZone: true` reads the parts as wall-clock time in the zone; without it, zoned construction attaches the zone to the input instant. The `disambiguation` option chooses how daylight saving gaps and repeated times resolve.

## Reading current time

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-12, VIP-14, VIP-33
// run: provide TestClock.layer() { try TestClock.setTime(0); try Console.log(try timestamp()) }
effect timestamp() {
  const now = try DateTime.now
  return DateTime.formatIso(now)
}
// string!!
```

```output
1970-01-01T00:00:00.000Z
```

`DateTime.now` is an Effect value: `try DateTime.now` reads UTC time through Effect's Clock, which tests can control. Effect's `nowUnsafe` bypasses Clock. Read application time with `try DateTime.now`, not `Date.now()` or `new Date()`.

## Identifying timestamp variants

```vibe
// pending: VIP-5, VIP-14
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

`isDateTime` narrows unknown input; `isUtc` and `isZoned` tell the variants apart. `isTimeZone` recognizes a zone; `isTimeZoneNamed` and `isTimeZoneOffset` expose its region identifier or fixed offset.

## Parsing and changing time zones

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: try Console.log(Option.isSome(named), Option.isSome(parsed), DateTime.zoneToString(fixed), Option.isSome(optional)); try Console.log(DateTime.formatIsoZoned(known)); try Console.log(DateTime.formatIsoOffset(shiftedView)); provide TestClock.layer() { try TestClock.setTime(0); try Console.log(DateTime.formatIsoZoned(try inTokyo())) }
const named = DateTime.zoneMakeNamed("Asia/Tokyo")
const parsed = DateTime.zoneFromString("+09:00")
const fixed = DateTime.zoneMakeOffset(9 * 60 * 60 * 1000)
DateTime.zoneToString(fixed) // "+09:00"

effect inTokyo() {
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

For an invalid identifier, `zoneMakeNamed` and `zoneFromString` return `None`, `zoneMakeNamedEffect` fails with the expected error `IllegalArgumentError`, and `zoneMakeNamedUnsafe` throws. `zoneMakeLocal` reads the host's local zone; prefer a configured zone for reproducible output.

## Comparing and converting instants

```vibe
// pending: VIP-5, VIP-14
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

Ordering compares instants, ignoring zones. `distance(start, end)` is signed: reversed arguments give a negative duration. `toDateUtc` keeps the instant in a JavaScript `Date`; `toDate` gives the zone-adjusted calendar view, so it does not substitute for `toDateUtc`.

`isGreaterThan`, `isGreaterThanOrEqualTo`, `isLessThanOrEqualTo`, and inclusive `between` cover the other comparisons. `isFuture` and `isPast` return Effects that read Clock. For zoned values, `zonedOffset` and `zonedOffsetIso` return the effective offset at that instant.

## Accessing calendar components

```vibe
// pending: VIP-5, VIP-14
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

`Parts` has year, month, day, hour, minute, second, and millisecond, with months starting at one; `PartsWithWeekday` adds `weekDay`. The UTC variants ignore an attached zone.

## Calendar arithmetic and formatting

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([DateTime.formatIso(tomorrow), DateTime.formatIso(previous), DateTime.formatIso(elapsedHour), DateTime.formatIso(earlier), DateTime.formatIso(dayStart), DateTime.formatIso(dayEnd), DateTime.formatIso(rounded), DateTime.formatIsoDate(appointment), DateTime.formatIsoDateUtc(appointment), DateTime.formatIsoOffset(appointment), DateTime.format(appointment, { locale: "en-GB", dateStyle: "long" })]))
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

Calendar `add` and `subtract` change parts in the value's zone; duration arithmetic adds fixed elapsed time, so the two differ across daylight saving transitions. `formatIsoZoned` keeps a named zone, `formatUtc` forces UTC, `formatLocal` uses the host's zone, and `formatIntl` takes an existing formatter.

## Providing a default time zone

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide TestClock.layer() { try TestClock.setTime(0); try Console.log(try main()) }
effect localDate() {
  return DateTime.formatIsoDate(try DateTime.nowInCurrentZone)
}
// string!!DateTime.CurrentTimeZone

effect main() {
  provide DateTime.layerCurrentZoneNamed("Asia/Tokyo") { return try localDate() }
}
```

```output
1970-01-01
```

`CurrentTimeZone` supplies the zone for `nowInCurrentZone` and `setZoneCurrent`. Provide it with `layerCurrentZone`, `layerCurrentZoneNamed` (which fails for an invalid identifier), `layerCurrentZoneOffset`, or `layerCurrentZoneLocal`. `withCurrentZone`, `withCurrentZoneNamed`, `withCurrentZoneOffset`, and `withCurrentZoneLocal` provide it around one Effect, passed as `work()`.
