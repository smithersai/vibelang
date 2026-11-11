package vibelangmapper

import (
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// An is test that binds names makes the projection render its whole block
// through the pattern printer. Every other statement of that block keeps the
// lowering it has without the test: a form the walker lowers is never printed
// from the parser's internal helper call.
func TestPatternBlockKeepsSiblingLowerings(t *testing.T) {
	for _, test := range []struct {
		name, sibling string
		want          []string
	}{
		{"try.all", "const [a, b] = try.all [load(1), load(2)]", []string{`(yield* $run(Effect.all([load(1), load(2)], { concurrency: "unbounded" })))`}},
		{"try.race", "const first = try.race [load(3), load(4)]", []string{"(yield* $run(Effect.raceAllFirst([load(3), load(4)])))"}},
		{"try.any", "const any = try.any [load(3), load(4)]", []string{"(yield* $run(Effect.raceAll([load(3), load(4)])))"}},
		{"try.allSettled", "const settled = try.allSettled [load(3), load(4)]", []string{"Effect.all([Effect.exit(load(3)), Effect.exit(load(4))]"}},
		{"try.all statement", "try.all [load(1)]", []string{"(yield* $run(Effect.all([load(1)]"}},
		{"try.all in parentheses", "const n = (try.all [load(2)]).length", []string{"((yield* $run(Effect.all([load(2)]"}},
		{"try.all in if", "if (u) { const z = try.all [load(1)] }", []string{"const z = (yield* $run(Effect.all([load(1)]"}},
		{"try.race in while", "while (u) { try.race [load(1)]; break }", []string{"(yield* $run(Effect.raceAllFirst([load(1)])))", "break"}},
		{"try.all in labeled for", "out: for (;;) { try.all [load(1)]; break out }", []string{"(yield* $run(Effect.all([load(1)]", "break out"}},
		{"try.all in do expression", "const d = do { try.all [load(1)] }", []string{"return (yield* $run(Effect.all([load(1)]"}},
		{"uninterruptible", `uninterruptible { try log("x") }`, []string{"yield* uninterruptible($gen(function* () {"}},
		{"interruptible", `interruptible { try log("x") }`, []string{"yield* interruptible($gen(function* () {"}},
		{"restore", `uninterruptible { restore { try log("x") } }`, []string{"yield* uninterruptible($gen(function* () { yield* restore($gen(function* () {"}},
		{"mask in if", `if (u) { uninterruptible { try log("x") } }`, []string{"yield* uninterruptible($gen(function* () {"}},
		{"provide", `provide Live { try log("x") }`, []string{"yield* Effect.provide(Live)($gen(function* () {"}},
		{"Effect lambda", "const h = (n: number): number!! => try.race [load(n)]", []string{"=> $gen(function* () { return (yield* $run(Effect.raceAllFirst([load(n)]))) })"}},
		{"using block", "{ using r = acquire(); try.all [load(1)] }", []string{"yield* $scopedBody($gen(function* () { const r = (yield* $acquire("}},
		{"using in if", "if (u) { using r = acquire(); try.all [load(1)] }", []string{"if (u) { yield* $scopedBody($gen(function* () { const r = (yield* $acquire("}},
		{"using in while", "while (u) { using r = acquire(); try.all [load(1)]; break }", []string{"const $c = yield* $scopedBody($gen(function* () { const r = (yield* $acquire(", `return $jump("break:")`}},
		{"fork in for", "for (let i = 0; i < 2; i++) { const f = fork load(i); try.all [load(1)] }", []string{"{ yield* $scopedBody($gen(function* () { const f = (yield* $run($scoped(fork)("}},
		{"fork as loop body", "for (let i = 0; i < 2; i++) fork load(try.race [load(i)])", []string{"{ yield* $scopedBody($gen(function* () { (yield* $run($scoped(fork)("}},
		{"labeled break from a scope", "out: while (u) { for (;;) { using r = acquire(); try.all [load(1)]; break out } }", []string{`return $jump("break:out")`, "break out"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			plain := projectBesideTest(t, test.sibling, "if (u) { try log(u.id) }")
			bound := projectBesideTest(t, test.sibling, "if (u is { id: let who }) { try log(who) }")
			for _, want := range test.want {
				assert.Assert(t, strings.Contains(plain, want), "without a binding test, want %q in:\n%s", want, plain)
				assert.Assert(t, strings.Contains(bound, want), "beside a binding test, want %q in:\n%s", want, bound)
			}
			for _, helper := range []string{"$tryAll", "$tryRace", "$tryAny", "$tryAllSettled", "$uninterruptibleBlock", "$interruptibleBlock", "$restoreBlock"} {
				assert.Assert(t, !strings.Contains(bound, helper), "parser helper %s printed in:\n%s", helper, bound)
			}
			assert.Assert(t, strings.Contains(bound, "let who;"), "the test's binding is declared:\n%s", bound)
		})
	}
}

// A lambda with no form reports CodeFormChoice beside a binding test as it
// does alone, and a retired await operation keeps its diagnostic.
func TestPatternBlockKeepsSiblingDiagnostics(t *testing.T) {
	for _, sibling := range []string{
		"const g = (n: number) => try.all [load(n)]",
		"const aw = await.all [load(1)]",
	} {
		plain := Project(besideTestSource(sibling, "if (u) { try log(u.id) }"), testContext)
		bound := Project(besideTestSource(sibling, "if (u is { id: let who }) { try log(who) }"), testContext)
		assert.Equal(t, len(plain.Diagnostics), 1, "%s: %v", sibling, plain.Diagnostics)
		assert.Equal(t, len(bound.Diagnostics), 1, "%s: %v", sibling, bound.Diagnostics)
		assert.Equal(t, bound.Diagnostics[0].Code, plain.Diagnostics[0].Code)
		assert.Equal(t, bound.Diagnostics[0].Start, plain.Diagnostics[0].Start)
		assert.Assert(t, !strings.Contains(bound.Text, "$tryAll") && !strings.Contains(bound.Text, "$awaitAll"), "%s", bound.Text)
	}
}

func besideTestSource(sibling, test string) string {
	return "effect function load(n: number) { return n }\n" +
		"export effect function main() {\n" +
		"  const u: { id: string } | undefined = { id: \"a\" }\n" +
		"  " + sibling + "\n" +
		"  " + test + "\n" +
		"  return 1\n}\n"
}

func projectBesideTest(t *testing.T, sibling, test string) string {
	t.Helper()
	source := besideTestSource(sibling, test)
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertValidMap(t, projection, source)
	assertParses(t, projection.Text)
	return projection.Text
}

// The checking projection is consumed by stock TypeScript and its language
// server. Check the combined program with the pinned external compiler too.
func TestPatternBlockSiblingStockTypeScript(t *testing.T) {
	source := `effect function load(n: number) { return n }
export effect function main() {
  const u: { id: string } | undefined = { id: "a" }
  const [a, b] = try.all [load(1), load(2)]
  const first: number = try.race [load(3), load(4)]
  const any: number = try.any [load(5), load(6)]
  const settled = try.allSettled [load(7), load(8)]
  uninterruptible {
    try log("x")
    restore { try load(any) }
  }
  interruptible { try load(first) }
  if (u is { id: let who }) { try log(who) }
  return a + b + first
}
`
	if _, output, err := catchTagStock(t, source); err != nil {
		t.Fatalf("stock TypeScript rejected sibling forms: %v\n%s", err, output)
	}
}
