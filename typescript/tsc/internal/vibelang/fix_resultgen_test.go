package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// planOfResultGen returns the rewrite of source's first Result.gen call.
func planOfResultGen(t *testing.T, source string) *formRewrite {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	var rewrite *formRewrite
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && isEffectFunction(c, n.Expression(), "Result", "gen") {
			rewrite = planEffectGen(c, file, n)
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if rewrite == nil {
		t.Fatalf("no plan for %s", source)
	}
	return rewrite
}

// Result.gen stays one eager call of plain code: what Smithers' journal and
// model Endpoint write, and what Effect's Result.gen does with it.
func TestResultGenQuickFix(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"binding", "export const sum = (a: Result.Result<number, string>, b: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { const first = yield* a; let second = yield* b; second++; return first + second })"},
		{"destructuring", "export const f = (a: Result.Result<{ value: number }, string>): Result.Result<number, string> => Result.gen(function* () { const { value } = yield* a; return value })"},
		{"discard", "export const f = (a: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { yield* a; return 1 })"},
		{"return a yield", "export const f = (n: number, a: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { if (n > 0) return yield* Result.fail(\"positive\"); return yield* a })"},
		{"a callback in an operand", "export const url = (s: string): Result.Result<URL, string> => Result.gen(function* () { const u = yield* Result.try({ try: () => new URL(s), catch: () => \"bad\" }); if (u.protocol !== \"http:\") { return yield* Result.fail(\"scheme\") } return u })"},
		{"a callback in the body", "export const f = (a: Result.Result<ReadonlyArray<number>, string>): Result.Result<ReadonlyArray<number>, string> => Result.gen(function* () { const xs = yield* a; return xs.map((x) => x + 1) })"},
		{"a for-of over an array", "export const f = (xs: ReadonlyArray<number>, a: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { for (const x of xs) { yield* a } return 1 })"},
		{"an annotation in a return", "export function f(a: Result.Result<number, string>): Result.Result<number, string> { return Result.gen(function* () { const x = yield* a; return x + 1 }) }"},
		{"a long inferred object", "type Long = { a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number }\nexport const f = (l: Long, a: Result.Result<number, string>): Result.Result<Long, string> => Result.gen(function* () { yield* a; return l })"},
		{"a name in use", "export const f = (a: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { const $result0 = 5; const x = yield* a; return x + $result0 })"},
		{"comments", "export const f = (a: Result.Result<number, string>): Result.Result<number, string> => Result.gen(function* () { const x = yield /* keepA */ * /* keepB */ a; return /* keepC */ x })"},
	} {
		t.Run(test.name, func(t *testing.T) {
			rewrite := planOfResultGen(t, test.source)
			if !rewrite.fixable() {
				t.Fatalf("no quick fix: %s", rewrite.why)
			}
			fixed := applyEdits(test.source, rewrite.edits)
			if strings.Contains(fixed, "Result.gen") || strings.Contains(fixed, "yield") {
				t.Fatal(fixed)
			}
			for _, comment := range []string{"/* keepA */", "/* keepB */", "/* keepC */"} {
				if strings.Contains(test.source, comment) && !strings.Contains(fixed, comment) {
					t.Errorf("lost comment %s: %s", comment, fixed)
				}
			}
			p, f, _, _ := editorProgram(t, fixed)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s\n%s", d.String(), fixed)
				}
			}
		})
	}
}

// The plain function says the Result type the call has, so a literal the
// annotation asks for stays one, and returns don't infer a union.
func TestResultGenKeepsItsType(t *testing.T) {
	source := "export const f = (a: Result.Result<number, string>): Result.Result<{ kind: \"ok\" }, string> => Result.gen(function* () { yield* a; return { kind: \"ok\" } })"
	rewrite := planOfResultGen(t, source)
	if !rewrite.fixable() {
		t.Fatalf("no quick fix: %s", rewrite.why)
	}
	fixed := applyEdits(source, rewrite.edits)
	if !strings.Contains(fixed, "string> => {") {
		t.Fatal(fixed)
	}
	p, f, _, _ := editorProgram(t, fixed)
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed source reports %s\n%s", d.String(), fixed)
		}
	}
}

// Where plain code would mean something else, EK1002 has no quick fix, and
// its note says why.
func TestResultGenRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"no annotation", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { const x = yield* a; return x + 1 })", "annotate"},
		{"this", "export const f = () => Result.gen(function* () { return this })", "this"},
		{"this in a callback", "export const f = (xs: number[]) => Result.gen(function* () { return xs.map(() => this) })", "this"},
		{"arguments in a callback", "export const f = (xs: number[]) => Result.gen(function* () { return xs.map(() => arguments.length) })", "arguments"},
		{"fallthrough", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { yield* a })", "fallthrough"},
		{"void return", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { yield* a; return })", "void return"},
		{"a nested yield", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { return (yield* a) + 1 })", "nested"},
		{"try", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { try { const n = yield* a; return n } finally {} return 1 })", "try or finally"},
		{"not a delegate", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { const n = yield a; return n })", "does not delegate"},
		{"two declarations", "export const f = (a: Result.Result<number, string>) => Result.gen(function* () { const n = yield* a, b = 1; return n + b })", "nested"},
		{"a for-of iterator", "export const f = (xs: Iterable<number>, a: Result.Result<number, string>) => Result.gen(function* () { for (const x of xs) { yield* a } return 1 })", "for-of"},
		{"a named generator", "export const f = (a: Result.Result<number, string>) => Result.gen(function* named() { const n = yield* a; return n })", "anonymous"},
	} {
		t.Run(test.name, func(t *testing.T) {
			rewrite := planOfResultGen(t, test.source)
			if rewrite.fixable() {
				t.Fatalf("unsafe rewrite: %s", applyEdits(test.source, rewrite.edits))
			}
			if !strings.Contains(rewrite.why, test.why) {
				t.Fatalf("why = %q, want %q", rewrite.why, test.why)
			}
		})
	}
}
