# Pattern Matching

VibeLang matches values with `match` and tests them with `is`, from the TC39 pattern matching proposal. Both compile to plain conditionals: TypeScript narrows the value in each arm, and inside an effect function an arm can run an Effect with `try`. [Pattern matching with match and is](../vibelang-features/116-match-and-is.md) lists every pattern. Effect's `Match` module still builds reusable matcher functions.

## Matching values

```vibe
// pending: VIP-5, VIP-7, VIP-14
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

Arms are tried in order; the first that matches gives the value. `Number` and `String` test `typeof`. An object pattern checks only the properties it names.

## Shapes, guards, and tags

```vibe
// pending: VIP-5, VIP-6, VIP-7, VIP-14
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

`let n` binds a property, and a guard, `and if (condition)`, tests the bindings before it. Matching `_tag` narrows a tagged union. An `error` class is itself a pattern: `when NotFound:` tests its `_tag` through the class's custom matcher. A [`data` declaration](../data-types/073-data.md) declares a tagged union. Match a variant with an object pattern, such as `when { _tag: "Running", let worker }:`.

## Negating and combining patterns

```vibe
// pending: VIP-5, VIP-7, VIP-14
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

`not` matches what its pattern does not; `or` matches either pattern. Order still matters: a broad arm takes inputs meant for a later arm.

## Fixing the return type

```vibe
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(display(3), display(true), display(false))
function display(input: number | boolean): string {
  return match (input) {
    when Number: input.toFixed(1);
    when Boolean: input ? "enabled" : "disabled";
  }
}
```

```output
3.0 enabled disabled
```

A match's type is the union of its arms' types. Annotate the return type to require one type from every arm; that catches an arm returning a number from a text formatter.

## Exhaustive handling

```vibe
// pending: VIP-5, VIP-7, VIP-14
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

`match` is exhaustive. Without a `default` arm, a match over a finite union (literals, a data type's variants, `error` classes, `Option`, `Exit`, or `Result`) must handle every case: add a member to `Phase` and this match is EK4701, `This match does not handle every case of Phase: "review" is left.`, until it gets an arm. A guard doesn't prove that every value of a type is covered. Over other types, a match no arm fits throws a `TypeError` when it runs.

## Defaults, optional outputs, and result outputs

```vibe
// pending: VIP-5, VIP-7, VIP-14
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

A `default` arm comes last and receives every unmatched input, narrowed to the cases no arm took. When the caller needs to know whether a case matched, return an `Option` or a `Result` from the arms. A failed Result is a returned value, not a typed Effect failure.

## Reusable matchers with the Match module

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(describeAll([3, "news"])))
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

`Match.type<T>()` builds a matcher with no input yet; its finalizer produces a plain function to pass as a callback. Match callbacks compute values synchronously. Use `match` inside an effect function when an arm needs `try` to run an Effect. Wrap any synchronous call that may throw with `Effect.try` before running it in effect code.
