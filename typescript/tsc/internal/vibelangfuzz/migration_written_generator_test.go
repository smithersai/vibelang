package vibelangfuzz

const migrationWrittenGeneratorQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

var migrationWrittenGeneratorPrograms = []struct{ key, source string }{
	{"smithers-fn-return", "export const main = () => Effect.gen(function* (): Effect.fn.Return<Outcome> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"smithers-generator-return", "export const main = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, Outcome, never> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"alias", "type G = Generator<Effect.Effect<unknown>, Outcome, never>\nexport const main = () => Effect.gen(function* (): G { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"failure", "export const main = () => Effect.result(Effect.gen(function* (): Effect.fn.Return<Outcome, string> { yield* Effect.fail(\"bad\"); return { kind: \"ok\", value: 7 } }))\n"},
	{"t3code-device-hub-record-inexact", ""},
	{"t3code-device-hub-record-exact", ""},
	{"t3code-device-hub-renamed-inexact", ""},
	{"t3code-device-hub-renamed-exact", ""},
	{"t3code-device-hub-conditional-inexact", ""},
	{"t3code-device-hub-conditional-exact", ""},
}
