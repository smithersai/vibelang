# Terminal

`Terminal` is Effect's interactive input/output service. Request `Terminal.Terminal`, read lines or key events, handle `QuitError` as a typed failure, and supply a runtime terminal layer at the entry point.

## Requesting the service

```vibe
// run: provide Terminal.Terminal = Terminal.make({ columns: succeed(80), rows: succeed(24), readInput: Queue.unbounded<Terminal.UserInput>(), size: Queue.unbounded<Terminal.Size, Cause.Done>(), readLine: succeed(" Ada "), display: (text) => Console.log(text.trimEnd()) }) { { const jsonValue = try dimensions(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
effect function dimensions() {
  const terminal = try Terminal.Terminal
  return { columns: try terminal.columns, rows: try terminal.rows }
}
// { columns: number; rows: number }!!Terminal.Terminal
// Output: {"columns":80,"rows":24}
```

`columns`, `rows`, and `readLine` are Effect properties—run them with `try terminal.columns` or `try terminal.readLine`. `display(text)` returns an Effect that also runs with `try`.

## Writing output

```vibe
// main.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeTerminal from "@effect/platform-node/NodeTerminal"

effect function main() {
  const terminal = try Terminal.Terminal
  try terminal.display("Package prepared.\n")
}

NodeRuntime.runMain(Effect.provide(main(), NodeTerminal.layer))
// Output: Package prepared.
```

`display` writes verbatim without adding a newline and can fail with `PlatformError`. Provide `NodeTerminal.layer` (or `NodeServices.layer`).

## Reading input

```vibe
// run: provide Terminal.Terminal = Terminal.make({ columns: succeed(80), rows: succeed(24), readInput: Queue.unbounded<Terminal.UserInput>(), size: Queue.unbounded<Terminal.Size, Cause.Done>(), readLine: succeed(" Ada "), display: (text) => Console.log(text.trimEnd()) }) { try askName() }
effect function askName() {
  const terminal = try Terminal.Terminal
  try terminal.display("Your name: ")
  const name = try terminal.readLine
  try terminal.display(`Hello, ${name.trim() || "visitor"}.\n`)
}
// void!(Terminal.QuitError | PlatformError.PlatformError)!Terminal.Terminal
// Output: Your name:
// Output: Hello, Ada.
```

`try terminal.readLine` waits for one line of input; statements execute in order, so the prompt prints before reading. For key-by-key events, use the scoped `readInput` queue.

## Handling `QuitError` and signals

```vibe
// run: provide Terminal.Terminal = Terminal.make({ columns: succeed(80), rows: succeed(24), readInput: Queue.unbounded<Terminal.UserInput>(), size: Queue.unbounded<Terminal.Size, Cause.Done>(), readLine: fail(new Terminal.QuitError()), display: (text) => Console.log(text.trimEnd()) }) { try askNameOrQuit(); try Console.log("quit handled") }
effect function askNameOrQuit() {
  return askName() catch effect (error) => match (error) {
    when { _tag: "QuitError" }: undefined;
    default: throw error;
  }
}
// Output: Your name:
// Output: quit handled
```

In Effect 4.1.1 on Node:
- `readLine` raises `QuitError` on EOF (including Ctrl+D). Because `readLine` does not enable raw mode, Ctrl+C raises a host `SIGINT`, interrupting the program and running finalizers (bypassing `catch`).
- `readInput` puts the terminal in raw mode while active, turning Ctrl+C into a key event governed by `NodeTerminal.make`'s quit-key configuration rather than a host signal.

Catch `QuitError` when end-of-input should exit cleanly, and rethrow other errors.

## Interactive guessing game

```vibe
// guessing.vibe
// run: const inputs = ["no", "2", "19", "11"]; provide Random.Random = { nextIntUnsafe: () => 0, nextDoubleUnsafe: () => 0.5 }, Terminal.Terminal = Terminal.make({ columns: succeed(80), rows: succeed(24), readInput: Queue.unbounded<Terminal.UserInput>(), size: Queue.unbounded<Terminal.Size, Cause.Done>(), readLine: Effect.suspend(() => { const input = inputs.shift(); return input === undefined ? fail(new Terminal.QuitError()) : succeed(input) }), display: (text) => Console.log(text.trimEnd()) }) { try main() }
function parseGuess(input: string) {
  const text = input.trim()
  const number = Number(text)
  return /^\d+$/.test(text) && Number.isInteger(number) &&
    number >= 1 && number <= 20
    ? Option.some(number)
    : Option.none<number>()
}

effect function game() {
  const terminal = try Terminal.Terminal
  const secret = try Random.nextIntBetween(1, 20)
  try terminal.display("Guess an integer from 1 to 20. You have five guesses.\n")

  let attempts = 0
  while (attempts < 5) {
    try terminal.display(`Guess ${attempts + 1}: `)
    const guess = parseGuess(try terminal.readLine)
    if (Option.isNone(guess)) {
      try terminal.display("Enter a whole number from 1 to 20.\n")
      continue
    }
    attempts++
    if (guess.value === secret) {
      try terminal.display("Correct!\n")
      return
    }
    try terminal.display(guess.value < secret ? "Try higher.\n" : "Try lower.\n")
  }
  try terminal.display(`The answer was ${secret}.\n`)
}
// void!(Terminal.QuitError | PlatformError.PlatformError)!Terminal.Terminal

export effect function main() {
  return game() catch effect (error) => match (error) {
    when { _tag: "QuitError" }: undefined;
    default: throw error;
  }
}

// Output: Guess an integer from 1 to 20. You have five guesses.
// Output: Guess 1:
// Output: Enter a whole number from 1 to 20.
// Output: Guess 1:
// Output: Try higher.
// Output: Guess 2:
// Output: Try lower.
// Output: Guess 3:
// Output: Correct!
```

`Random.nextIntBetween(1, 20)` chooses an inclusive secret once per game. Invalid entries re-prompt without consuming a guess; `main` handles `QuitError` while letting unexpected `PlatformError` values reach the runner.

## Coming from Effect

`try terminal.readLine` replaces `yield* terminal.readLine`, and ordinary `while` loops replace recursive Effect combinators. Keep `NodeRuntime.runMain` in a separate entry file so tests can supply scripted `Terminal` layers:

```vibe
// guessing-main.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeTerminal from "@effect/platform-node/NodeTerminal"
import { main } from "./guessing.vibe"

NodeRuntime.runMain(Effect.provide(main(), NodeTerminal.layer))
// Output: Guess an integer from 1 to 20. You have five guesses.
// Output: Guess 1: 
```
