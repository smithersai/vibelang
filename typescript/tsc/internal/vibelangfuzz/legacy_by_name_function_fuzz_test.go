package vibelangfuzz

import ()

// legacyByNameSites are programs where the old compiler passed take(…) by
// name and ran load(1) inside it.
var legacyByNameSites = map[string]string{
	"map-argument": "export effect function f() {\n  return try Effect.map(take(load(1), FN), (n) => n + 1)\n}\n",
	"own-helper":   "export effect function f() {\n  return try hold(take(load(1), FN))\n}\n",
	"block-map":    "export effect function f() {\n  return try Effect.map(effect { return plain(load(1)) + (FN)() }, (n) => n + 1)\n}\n",
	"block-helper": "export effect function f() {\n  return try hold(effect { return plain(load(1)) + (FN)() })\n}\n",
	"block-pipe":   "export effect function f() {\n  return try (effect { return plain(load(1)) + (FN)() } |> Effect.map(%, (n) => n + 1))\n}\n",
	"pipe-topic":   "export effect function f() {\n  return try (take(load(1), FN) |> Effect.map(%, (n) => n + 1))\n}\n",
}

var legacyByNameFunctions = map[string]struct {
	text    string
	refused bool
}{
	"arrow":        {text: "() => 2"},
	"expression":   {text: "function () { return 2 }"},
	"throws":       {text: "(): number => raise(new Error(\"plain\"))"},
	"nested":       {text: "() => [1].map((x) => x + 1)[0]!"},
	"gives-effect": {text: "() => take(1, () => 2) as unknown as number", refused: true},
}

const legacyByNameHelpers = `import { Effect } from "effect"

function plain(n: number): number {
  return n
}

effect function load(n: number): number!! {
  return n
}

effect function take(n: number, thunk: () => number): number!! {
  return n + thunk()
}

effect function hold(program: number!!): number!! {
  return try program
}

`
