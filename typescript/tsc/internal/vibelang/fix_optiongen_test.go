package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOptionGenQuickFixFoldkit(t *testing.T) {
	for _, source := range []string{
		"export function sum(a: Option.Option<number>, xs: readonly number[]): Option.Option<number> { return Option.gen(function* () { const n = yield* a; let result = n; for (const x of xs) { result += x; } return result }) }",
		"export function sum(a: Option.Option<number>, b: Option.Option<number>): Option.Option<number> { return Option.gen(function* () { const first = yield* a; const second = yield* b; return first + second }) }",
		"export function sum(a: Option.Option<{value: number}>, b: Option.Option<number>): Option.Option<number> { return Option.gen(function* () { const {value} = yield* a; let second = yield* b; second++; return value + second }) }",
		"export const one = (a: Option.Option<number>): Option.Option<number> => Option.gen(function* () { if (true) return yield* a; return 1 })",
		"export const one = (a: Option.Option<number>): Option.Option<number> => Option.gen(function* () { yield* a; return 1 })",
		"export const one = (): Option.Option<number> => Option.gen(function* () { return 1 })",
		"export const comments = (a: Option.Option<number>): Option.Option<number> => Option.gen(function* () { const x = yield /* keepA */ * /* keepB */ a; return /* keepC */ x })",
		"export const alias = (a: Option.Option<number>): Option.Option<number> => Option.gen(function* () { const $option0 = 5; const x = yield* a; return x + $option0 })",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			var rewrite *formRewrite
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && isEffectFunction(c, n.Expression(), "Option", "gen") {
					rewrite = planEffectGen(c, file, n)
					return true
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !rewrite.fixable() {
				t.Fatalf("no Option quick fix: %+v", rewrite)
			}
			fixed := applyEdits(source, rewrite.edits)
			if strings.Contains(fixed, "Option.gen") || strings.Contains(fixed, "yield*") {
				t.Fatal(fixed)
			}
			for _, comment := range []string{"/* keepA */", "/* keepB */", "/* keepC */"} {
				if strings.Contains(source, comment) && !strings.Contains(fixed, comment) {
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

func TestOptionGenRefusesChangedGeneratorProtocols(t *testing.T) {
	for _, source := range []string{
		"export const receiver = () => Option.gen(function* () { return this })",
		"export const nested = () => Option.gen(function* () { return () => 1 })",
		"export const empty = () => Option.gen(function* () {})",
		"export const empty = () => Option.gen(function* () { return })",
		"export const f = (a: Option.Option<number>) => Option.gen(function* () { return (yield* a) + 1 })",
		"export const f = (a: Option.Option<number>) => Option.gen(function* () { try { const n = yield* a; return n } finally {} })",
		"export const f = (a: Option.Option<number>) => Option.gen(function* () { const n = yield a; return n })",
		"export const f = (a: Option.Option<number>) => Option.gen(function* () { const n = yield* a, b = 1; return n + b })",
		"export const f = (a: Option.Option<number>) => Option.gen(function* named() { const n = yield* a; return n })",
	} {
		program, file, _, _ := editorProgram(t, source)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsCallExpression(n) && isEffectFunction(c, n.Expression(), "Option", "gen") {
				if rewrite := planEffectGen(c, file, n); rewrite.fixable() {
					t.Errorf("unsafe Option rewrite: %s", source)
				}
				return true
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		done()
	}
}

func TestOptionGenRefusesIteratorClosingChanges(t *testing.T) {
	for _, body := range []string{
		"for (const x of xs) { const y = yield* a; }",
		"for (const x of xs) { for (const y of xs) { yield* a; } }",
		"for (const x of xs) { if (x) return yield* a; }",
		"for (const x of xs) { while (true) { const y = yield* a; break; } }",
	} {
		source := "export const f = (a: Option.Option<number>, xs: Iterable<number>) => Option.gen(function* () { " + body + " return 1; })"
		p, file, _, _ := editorProgram(t, source)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		found := false
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsCallExpression(n) && isEffectFunction(c, n.Expression(), "Option", "gen") {
				found = true
				if r := planOptionGen(c, file, n); r.fixable() {
					t.Errorf("iterator cleanup rewrite offered: %s", source)
				}
				return true
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		done()
		if !found {
			t.Fatal("Option.gen fixture unresolved")
		}
	}
}
