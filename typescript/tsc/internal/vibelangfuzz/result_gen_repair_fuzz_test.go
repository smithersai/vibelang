package vibelangfuzz

// resultGenBodies pairs each key with a generator body and whether plain code
// can say the same thing. An explicit producer used as a native generator
// keeps EK1002 when its body cannot be repaired.
var resultGenBodies = map[string]struct {
	body  string
	fixed bool
}{
	"binding":      {"const y = yield* VALUE; return y + 1;", true},
	"discard":      {"yield* VALUE; return 1;", true},
	"return":       {"if (n > 0) return yield* VALUE; return 1;", true},
	"fail":         {"if (n > 0) return yield* Result.fail(\"no\"); return 1;", true},
	"callback":     {"const y = yield* VALUE; return [y].map((x) => x + n)[0]!;", true},
	"for-of-array": {"for (const x of [n]) { yield* VALUE; } return 1;", true},
	"for-of":       {"for (const x of xs) { yield* VALUE; } return 1;", false},
	"try":          {"try { yield* VALUE; } finally { n++; } return 1;", false},
	"nested":       {"return (yield* VALUE) + 1;", false},
	"this":         {"const y = yield* VALUE; return [y].map(() => this)[0];", false},
	"fallthrough":  {"yield* VALUE;", false},
}
