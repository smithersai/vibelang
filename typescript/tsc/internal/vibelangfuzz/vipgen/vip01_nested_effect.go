package vipgen

import (
	"strconv"
	"strings"
)

// An explicit Effect activation nested in plain callbacks is its own cold
// Effect at every depth: a `sync` thunk, an `Effect.try` thunk, an
// `Array.prototype.map` callback or an object method made in a thunk. Each
// level's body runs a `try`, so a level lowered as plain code fails to
// compile (its value stays an Effect) or runs early (the counts differ).
type nestedEffectKind struct{ key, vibe, effect, call string }

var nestedEffectKinds = map[string]nestedEffectKind{
	"sync":   {"sync", "sync(() => effect () => { BODY })", "Effect.sync(() => () => Effect.gen(function* () { BODY }))", "HOLDER()"},
	"try":    {"try", "Effect.try(() => ({ run: () => effect { BODY } }))", "Effect.try(() => ({ run: () => Effect.gen(function* () { BODY }) }))", "HOLDER.run()"},
	"map":    {"map", "sync(() => [0].map(effect () => { BODY }))", "Effect.sync(() => [0].map(() => Effect.gen(function* () { BODY })))", "HOLDER[0]"},
	"method": {"method", "sync(() => ({ effect run() { BODY } }))", "Effect.sync(() => ({ run() { return Effect.gen(function* () { BODY }) } }))", "HOLDER.run()"},
}

// nestedEffectLevel prints level i of kinds, innermost last, in VibeLang and
// in the Effect TS the chapters give it.
func nestedEffectLevel(kinds []string, i int) (vibe, effect string) {
	k := nestedEffectKinds[kinds[i]]
	n := strconv.Itoa(i + 1)
	var vibeBody, effectBody string
	if i == len(kinds)-1 {
		vibeBody = "runs++; const v" + n + " = try sync(() => runs); return v" + n + " + 1"
		effectBody = "runs++; const v" + n + " = yield* Effect.sync(() => runs); return v" + n + " + 1"
	} else {
		innerVibe, innerEffect := nestedEffectLevel(kinds, i+1)
		call := strings.Replace(nestedEffectKinds[kinds[i+1]].call, "HOLDER", "h"+n, 1)
		vibeBody = "runs++; const h" + n + " = try " + innerVibe + "; const b" + n + " = runs; const v" + n + " = try " + call + "; return v" + n + " * 10 + b" + n
		effectBody = "runs++; const h" + n + " = yield* " + innerEffect + "; const b" + n + " = runs; const v" + n + " = yield* " + call + "; return v" + n + " * 10 + b" + n
	}
	return strings.Replace(k.vibe, "BODY", vibeBody, 1), strings.Replace(k.effect, "BODY", effectBody, 1)
}

func init() {
	for _, kinds := range [][]string{
		{"sync"}, {"try"}, {"map"}, {"method"},
		{"sync", "sync"}, {"try", "try"}, {"map", "map"}, {"method", "method"},
		{"sync", "try", "map"}, {"try", "map", "method"}, {"map", "method", "sync"}, {"method", "sync", "try"},
	} {
		vibe, effect := nestedEffectLevel(kinds, 0)
		call := strings.Replace(nestedEffectKinds[kinds[0]].call, "HOLDER", "h0", 1)
		result := "const program = " + call + "; const before = runs; const first = PROGRAM; const second = PROGRAM; return [before, first, second, runs]"
		registerWitness(1, ChapterWitness{
			Key:      "vip01.nested-effect-" + strings.Join(kinds, "-"),
			Chapter:  "001-functions.md",
			Quote:    "Calling an `effect` function returns its Effect unrun, as calling an `async` function returns a Promise.",
			Cite:     Citation{VIP: 1, Template: "Effect.gen(function* ()", Quote: vip01Unrun},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Vibe:     "effect function witness() { let runs = 0; const h0 = try " + vibe + "; " + strings.ReplaceAll(result, "PROGRAM", "try program") + " }",
			Effect:   "function witness() { return Effect.gen(function* () { let runs = 0; const h0 = yield* " + effect + "; " + strings.ReplaceAll(result, "PROGRAM", "yield* program") + " }) }",
		})
	}
}
