package vipgen

// Multi-statement bodies exercise the general generator path without a try
// expression, so callable identity cannot depend on an optional suspension.
func init() {
	for _, row := range []struct{ key, source, reference, call string }{
		{"arrow", "const f = effect () => { runs++; const value = runs; return value }", "const f = () => Effect.gen(function* () { runs++; const value = runs; return value })", "f"},
		{"grouped-arrow", "const f = (effect () => { runs++; const value = runs; return value })", "const f = (() => Effect.gen(function* () { runs++; const value = runs; return value }))", "f"},
		{"expression", "const f = effect function () { runs++; const value = runs; return value }", "const f = function () { return Effect.gen(function* () { runs++; const value = runs; return value }) }", "f"},
		{"named-expression", "const f = effect function inner() { runs++; const value = runs; return value }", "const f = function inner() { return Effect.gen(function* () { runs++; const value = runs; return value }) }", "f"},
		{"property-arrow", "const object = { member: effect () => { runs++; const value = runs; return value } }", "const object = { member: () => Effect.gen(function* () { runs++; const value = runs; return value }) }", "object.member"},
		{"symbol-expression", "const key = Symbol(\"sample\"); const object = { [key]: effect function () { runs++; const value = runs; return value } }", "const key = Symbol(\"sample\"); const object = { [key]: function () { return Effect.gen(function* () { runs++; const value = runs; return value }) } }", "object[key]"},
		{"value-expression", "const values = [effect function () { runs++; const value = runs; return value }]", "const values = [function () { return Effect.gen(function* () { runs++; const value = runs; return value }) }]", "values[0]"},
		{"method-control", "const object = { effect method() { runs++; const value = runs; return value } }", "const object = { method() { return Effect.gen(function* () { runs++; const value = runs; return value }) } }", "object.method"},
	} {
		setup := "let runs = 0; "
		common := "const f0 = " + row.call + "; const program = f0(); const atCall = runs; "
		result := "return [f0.name, \"prototype\" in f0, f0.length, atCall, first, second, runs]"
		registerWitness(1, ChapterWitness{
			Key:      "vip01.zero-parameter-metadata-" + row.key,
			Chapter:  "001-functions.md",
			Quote:    "Each form keeps the form it is written in, as `async` does.",
			Cite:     Citation{VIP: 1, Template: "Effect.gen(function* ()", Quote: vip01Where},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Vibe:     "effect function witness() { " + setup + row.source + "; " + common + "const first = try program; const second = try program; " + result + " }",
			Effect:   "function witness() { " + setup + row.reference + "; " + common + "return Effect.gen(function* () { const first = yield* program; const second = yield* program; " + result + " }) }",
		})
	}
}
