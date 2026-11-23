# Pattern Matching

`match` selects the first arm whose pattern fits a value and returns its result; `is` tests one pattern as a boolean expression. Both implement the TC39 pattern matching proposal, compile to ordered conditionals with TypeScript narrowing, and permit `try` inside effect functions. See [Pattern matching with match and is](../vibelang-features/116-match-and-is.md) for the complete grammar; Effect's `Match` module remains available for building standalone matcher callbacks.

![Exhaustive match narrowing across tagged unions](/diagrams/match-exhaustiveness.svg)

## Matching values

```vibe
// run: try Console.log(describeInput(3)); try Console.log(describeInput("news")); try Console.log(describeJob({ state: "queued", attempts: 2 })); try Console.log(describeJob({ state: "done", attempts: 1 }))
function describeInput(input: number | string) {
  return match (input) {
    when Number: `count ${input}`;
    when String: `label ${input}`;
  }
}

function describeJob(input: { state: string; attempts: number }) {
  return match (input) {
    when { state: "queued" }: `waiting: ${input.attempts}`;
    default: `state: ${input.state}`;
  }
}
```

```output
count 3
label news
waiting: 2
state: done
```

Arms are evaluated top to bottom, and the first match determines the expression's value. Built-in primitive matchers (`Number`, `String`, `Boolean`) check `typeof` or boxed `instanceof`, and object patterns match only the properties they name while narrowing the subject inside the arm.

## Shapes, guards, and tags

```vibe
// run: try Console.log(classifyRetry({ status: "failed", attempts: 3 }), classifyRetry({ status: "failed", attempts: 2 }), classifyRetry({ status: "done", attempts: 5 })); try Console.log(jobLabel({ _tag: "Queued" })); try Console.log(jobLabel({ _tag: "Running", worker: "w-1" })); try Console.log(jobLabel({ _tag: "Done", output: "report.csv" }))
function classifyRetry(input: { status: string; attempts: number }) {
  return match (input) {
    when { status: "failed", attempts: let n } and if (n >= 3): "escalate";
    when { status: "failed" }: "retry";
    default: "leave unchanged";
  }
}

type Job =
  | { _tag: "Queued" }
  | { _tag: "Running"; worker: string }
  | { _tag: "Done"; output: string }

function jobLabel(job: Job) {
  return match (job) {
    when { _tag: "Queued" }: "waiting";
    when { _tag: "Running", let worker }: `worker ${worker}`;
    when { _tag: "Done", let output }: output;
  }
}
```

```output
escalate retry leave unchanged
waiting
worker w-1
report.csv
```

Bind extracted fields with `let` or `const` (`{ let worker }` shorthand, or `{ worker: let renamed }` to rename), and refine arms with `and if (condition)` guards over earlier bindings. An `error` class matches directly by `_tag` through its custom matcher (`when NotFound:`), whereas [`data` declaration](../data-types/073-data.md) variants match via `_tag` object patterns (`when { _tag: "Running", let worker }:`).

## Negating and combining patterns

```vibe
// run: try Console.log(availability("active"), availability("paused"), availability("closed")); try Console.log(weekend("Saturday"), weekend("Sunday"), weekend("Monday"))
function availability(status: "active" | "paused" | "closed") {
  return match (status) {
    when not "closed": "can reopen";
    default: "archived";
  }
}

function weekend(day: string) {
  return match (day) {
    when "Saturday" or "Sunday": true;
    default: false;
  }
}
```

```output
can reopen can reopen archived
true true false
```

`not` negates a pattern and `or` matches either branch; place narrower arms before broader ones. Branches of `or` may bind the same name (such as `{ left: let value } or { right: let value }`), sharing one lexical binding typed as the union of extracted types while preserving `const` immutability.

## Fixing the return type

```vibe
// run: const rendered = try Effect.try(() => [display(3), display(true), display(false)]); try Console.log(...rendered)
function display(input: number | boolean): string {
  return match (input) {
    when Number: (input as number).toFixed(1);
    when Boolean: input ? "enabled" : "disabled";
  }
}
```

```output
3.0 enabled disabled
```

A `match` expression takes the union of its arm types, with `throw` arms contributing `never`. Annotating the enclosing function's return type forces every arm to conform to a single type.

## Exhaustive handling

```vibe
// run: try Console.log(phaseLabel("draft"), phaseLabel("published"))
type Phase = "draft" | "published"

function phaseLabel(phase: Phase) {
  return match (phase) {
    when "draft": "Draft";
    when "published": "Published";
  }
}
```

```output
Draft Published
```

Without a `default:` arm, `match` checks exhaustiveness over finite unions and reports `EK4701` for any unhandled member (for example, adding `"review"` to `Phase` produces `This match does not handle every case of Phase: "review" is left.`). Guarded arms do not count as covering a type. If the subject includes any open type outside the finite kinds below, exhaustiveness checking is disabled and an unmatched value throws `TypeError` at run time.

| Checked finite kinds | Examples |
| --- | --- |
| Primitive singletons & enums | String/number/bigint literals, `boolean`, `null`, `undefined`, enums |
| VibeLang & Effect ADTs | `data` variants, `error` / `schema error` classes, `Option`, `Exit`, `Result`, retained Effect errors |
| Tagged shapes | Objects, interfaces, or class instances with a literal (or literal-union) `_tag` |

## Defaults, optional outputs, and result outputs

```vibe
// run: try Console.log(withDefault("start"), withDefault("stop")); try Console.log(Option.getOrNull(optionalCommand("start")), Option.isNone(optionalCommand("help"))); try Console.log(Result.getOrElse(commandResult("start"), (error) => error), Result.getOrElse(commandResult("help"), (error) => error))
type Command = "start" | "stop" | "help"

function withDefault(command: Command) {
  return match (command) {
    when "start": "starting";
    default: `unhandled: ${command}`;
  }
}

function optionalCommand(command: Command) {
  return match (command) {
    when "start": Option.some("starting");
    default: Option.none();
  }
}

function commandResult(command: Command) {
  return match (command) {
    when "start": Result.succeed("starting");
    default: Result.fail(command);
  }
}
```

```output
starting unhandled: stop
starting true
starting help
```

Place `default:` last to catch any remaining inputs. Return `Option` or `Result` from the arms when callers must inspect whether a specific case matched; a failed `Result` stays a return value rather than entering the Effect error channel.

## Reusable matchers with the Match module

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(describeAll([3, "news"]))))
// expect-warning: EK4839
const describe = pipe(
  Match.type<number | string>(),
  Match.when(Match.number, (n) => `count ${n}`),
  Match.when(Match.string, (s) => `label ${s}`),
  Match.exhaustive
)

function describeAll(inputs: ReadonlyArray<number | string>) {
  return inputs.map(describe)
}
```

```output
["count 3","label news"]
```

`Match.type<T>()` builds a reusable synchronous matcher function suitable for collection callbacks. Use VibeLang's `match` expression inside effect functions whenever an arm needs `try`, and wrap any synchronous call that might throw with `Effect.try`.
