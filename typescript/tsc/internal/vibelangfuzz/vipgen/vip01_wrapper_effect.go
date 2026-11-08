package vipgen

import "strings"

// A wrapper executes its own thunk. Creating an explicit Effect inside that
// thunk does not execute the Effect body or change the source callable's kind.
func init() {
	for _, wrapper := range []struct{ key, source string }{
		{"try", "Effect.try(() => { BODY })"},
		{"try-options", "Effect.try({ try: () => { BODY }, catch: (error) => error })"},
		{"sync", "sync(() => { BODY })"},
		{"trypromise", "Effect.tryPromise(async () => { BODY })"},
		{"global-trypromise", "tryPromise(async () => { BODY })"},
	} {
		for _, form := range []struct{ key, source, reference, call string }{
			{"declaration", "effect function nested() { runs++; return runs }; return nested", "function nested() { return Effect.gen(function* () { runs++; return runs }) }; return nested", "factory()"},
			{"expression", "return effect function nested() { runs++; return runs }", "return function nested() { return Effect.gen(function* () { runs++; return runs }) }", "factory()"},
			{"arrow", "return effect () => { runs++; return runs }", "return () => Effect.gen(function* () { runs++; return runs })", "factory()"},
			{"method", "return { effect nested() { runs++; return runs } }", "return { nested() { return Effect.gen(function* () { runs++; return runs }) } }", "factory.nested()"},
			{"class", "class C { effect nested() { runs++; return runs } }; return new C()", "class C { nested() { return Effect.gen(function* () { runs++; return runs }) } }; return new C()", "factory.nested()"},
			{"block", "return effect { runs++; return runs }", "return Effect.gen(function* () { runs++; return runs })", "factory"},
		} {
			vibeWrapper := strings.Replace(wrapper.source, "BODY", form.source, 1)
			referenceWrapper := strings.Replace(wrapper.source, "BODY", form.reference, 1)
			if wrapper.key == "sync" {
				referenceWrapper = strings.Replace(referenceWrapper, "sync(", "Effect.sync(", 1)
			}
			if wrapper.key == "global-trypromise" {
				referenceWrapper = strings.Replace(referenceWrapper, "tryPromise(", "Effect.tryPromise(", 1)
			}
			result := "return [before, first, second, runs]"
			registerWitness(1, ChapterWitness{
				Key:      "vip01.wrapper-effect-" + wrapper.key + "-" + form.key,
				Chapter:  "001-functions.md",
				Quote:    "Calling an `effect` function returns its Effect unrun, as calling an `async` function returns a Promise.",
				Cite:     Citation{VIP: 1, Template: "Effect.gen(function* ()", Quote: vip01Unrun},
				Requires: []string{"vip01.effect-function", "vip05.try"},
				Vibe:     "effect function witness() { let runs = 0; const factory = try " + vibeWrapper + "; const program = " + form.call + "; const before = runs; const first = try program; const second = try program; " + result + " }",
				Effect:   "function witness() { return Effect.gen(function* () { let runs = 0; const factory = yield* " + referenceWrapper + "; const program = " + form.call + "; const before = runs; const first = yield* program; const second = yield* program; " + result + " }) }",
			})
		}
	}
}
