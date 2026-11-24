# Foldkit migration pairs

Historical migration excerpts from VibeLang 0.0.11, before explicit effects.
The VibeLang panes do not compile with the current language.

Real Effect TypeScript to VibeLang pairs from the VibeLang team's migration
of [foldkit/foldkit](https://github.com/foldkit/foldkit) at `b702a5efbb74`
(2026-10-28). The VibeLang compiler was 0.0.11; the commits named below are
on the migration's `vibe` branch.
Each batch passed Foldkit's own suite (3022 passed, 3 inherited failures,
1 skipped) with identical public declarations (225/225).

These are fragments of the `foldkit` package: they import its internals and
are not compiled here. Comments are trimmed; the code is as committed.

## 1. A schema declaration and an Option method chain

`packages/foldkit/src/devTools/submodelPath.ts`, batch 01, commit
`2ce1a51dbae7`. `schema` replaces `Schema.Struct`, `Option<A>` replaces
`Option.Option<A>`, and the Option `pipe` becomes method calls (`EK4840`).
`Option` and `Schema` need no import.

```ts
import { Option, Schema, pipe } from 'effect'

const Tagged = Schema.Struct({ _tag: Schema.String })
export const isTagged = Schema.is(Tagged)

export type SubmodelInfo = Readonly<{
  submodelPath: ReadonlyArray<string>
  maybeLeafTag: Option.Option<string>
}>

// ...inside extractSubmodelInfo:
  return {
    submodelPath: path,
    maybeLeafTag: pipe(
      current,
      Option.liftPredicate(isTagged),
      Option.map(({ _tag }) => _tag),
    ),
  }
```

```vibe
schema Tagged { _tag: string }
export const isTagged = Schema.is(Tagged)

export type SubmodelInfo = Readonly<{
  submodelPath: ReadonlyArray<string>
  maybeLeafTag: Option<string>
}>

// ...inside extractSubmodelInfo:
  return {
    submodelPath: path,
    maybeLeafTag: Option.liftPredicate(current, isTagged).map(({ _tag }) => _tag),
  }
```

## 2. A schema transformation that fails with `throw`

`packages/foldkit/src/calendar/calendarDate.ts`, batch 02, commit
`bad6d2b80273`. Inside `transformEffect`, `Effect.fail(e)` becomes `throw e`
and `Effect.succeed(v)` becomes `v`. The `pipe` became a `|>` pipeline with
the topic `%`; the codemod wrote that form, and the plain call
`Schema.decodeTo(...)(Schema.String)` reads more simply.

```ts
import { Effect, Schema, SchemaIssue, SchemaTransformation } from 'effect'

export const CalendarDateFromIsoString = Schema.String.pipe(
  Schema.decodeTo(
    CalendarDate,
    SchemaTransformation.transformEffect({
      decode: input => {
        const match = input.match(isoPattern)
        if (match === null) {
          return Effect.fail(
            new SchemaIssue.InvalidValue({
              message: `Expected ISO date (YYYY-MM-DD), got ${JSON.stringify(input)}`,
            }),
          )
        }
        const [, yearString, monthString, dayString] = match
        return Effect.succeed({
          year: Number(yearString),
          month: Number(monthString),
          day: Number(dayString),
        })
      },
      encode: ({ year, month, day }) =>
        Effect.succeed(
          `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        ),
    }),
  ),
)
```

```vibe
export const CalendarDateFromIsoString = Schema.String |> Schema.decodeTo(
    CalendarDate,
    SchemaTransformation.transformEffect({
      decode: input => {
        const match = input.match(isoPattern)
        if (match === null) {
          throw new SchemaIssue.InvalidValue({
            message: `Expected ISO date (YYYY-MM-DD), got ${JSON.stringify(input)}`,
          })
        }
        const [, yearString, monthString, dayString] = match
        return {
          year: Number(yearString),
          month: Number(monthString),
          day: Number(dayString),
        }
      },
      encode: ({ year, month, day }) =>
        `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    }),
  )(%)
```

## 3. Effect modules named like JavaScript globals

`packages/foldkit/src/fieldValidation/rule.ts`, batch 03, commit
`0e63079c31f8`. In a `.vibe` file `Array`, `String` and `Number` are
JavaScript's globals, so Effect's modules of those names are imported under
other names (`EK4842`). `Option`, `Predicate` and `Schema` come from the
prelude, and `Predicate<A>` is `Predicate.Predicate<A>`.

```ts
import { Array, Number, Option, Predicate, Schema, String, flow } from 'effect'

export type Rule<A> = readonly [Predicate.Predicate<A>, RuleMessage<A>]

export const minLength = (min: number, message?: RuleMessage<string>): Rule<string> => [
  flow(String.length, Number.isGreaterThanOrEqualTo(min)),
  message ?? `Must be at least ${min} characters`,
]

export const oneOf = (values: ReadonlyArray<string>, message?: RuleMessage<string>): Rule<string> => {
  const joinedValues = Array.join(values, ', ')
  return [value => Array.contains(values, value), message ?? `Must be one of: ${joinedValues}`]
}
```

```vibe
import { Array as Arr, Number as Num, String as Str, flow } from 'effect'

export type Rule<A> = readonly [Predicate<A>, RuleMessage<A>]

export const minLength = (min: number, message?: RuleMessage<string>): Rule<string> => [
  flow(Str.length, Num.isGreaterThanOrEqualTo(min)),
  message ?? `Must be at least ${min} characters`,
]

export const oneOf = (values: ReadonlyArray<string>, message?: RuleMessage<string>): Rule<string> => {
  const joinedValues = Arr.join(values, ', ')
  return [value => Arr.contains(values, value), message ?? `Must be one of: ${joinedValues}`]
}
```

Pair 3 joins Foldkit's multi-line signatures onto one line; the tokens are
unchanged.
