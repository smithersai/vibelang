package vipgen

// Compare primitive results of explicit source equality operations. This does
// not ask the canonical encoder to compare independently allocated objects.
func init() {
	for _, row := range []struct{ key, source, reference, call string }{
		{"declaration-empty", "effect function f() {}", "function f() { return Effect.gen(function* () {}) }", "f()"},
		{"declaration-return", "effect function f() { return }", "function f() { return Effect.gen(function* () { return }) }", "f()"},
		{"arrow-empty", "const f = effect () => {}", "const f = () => Effect.gen(function* () {})", "f()"},
		{"arrow-return", "const f = effect () => { return }", "const f = () => Effect.gen(function* () { return })", "f()"},
		{"expression", "const f = effect function () {}", "const f = function () { return Effect.gen(function* () {}) }", "f()"},
		{"method", "const object = { effect f() {} }", "const object = { f() { return Effect.gen(function* () {}) } }", "object.f()"},
		{"parameter", "effect function f(value: number) {}", "function f(value) { return Effect.gen(function* () {}) }", "f(1)"},
		{"block", "const f = () => effect {}", "const f = () => Effect.gen(function* () {})", "f()"},
		{"explicit-sharing-control", "const shared = Effect.void; const f = () => shared", "const shared = Effect.void; const f = () => shared", "f()"},
	} {
		result := "const first = " + row.call + "; const second = " + row.call + "; return [first === second, first === first]"
		registerWitness(2, ChapterWitness{
			Key:      "vip02.builder-construction-" + row.key,
			Chapter:  "008-runtime.md",
			Quote:    "Compiled output gives the same \x60Exit\x60 as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order.",
			Cite:     Citation{VIP: 31, Template: "Effect.gen(function* ()", Quote: "Compiled output gives the same \x60Exit\x60 as the Effect TypeScript shown in each VIP: success, failure, defect or interruption, with finalizers in the same order."},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Vibe:     "effect function witness() { " + row.source + "; " + result + " }",
			Effect:   "function witness() { return Effect.gen(function* () { " + row.reference + "; " + result + " }) }",
		})
	}
}
