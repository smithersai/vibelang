package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Native fibers can be returned, stored, passed, captured, and joined.
func TestFiberFlows(t *testing.T) {
	const prefix = "effect function one() { try sleep(1); return 1 }\nfunction keep(f: Fiber.Fiber<number>) {}\nlet outer: Fiber.Fiber<number> | undefined\n"
	for _, test := range []struct {
		name, source string
	}{
		{"returned", "export effect function fib() { return fork one() }"},
		{"returned binding", "export effect function fib() { const f = fork one(); return f }"},
		{"returned let alias", "export effect function fib() { let f = fork one(); const g = f; return g }"},
		{"returned in an object", "export effect function fib() { const f = fork one(); return { f } }"},
		{"returned in an array", "export effect function fib() { return [fork one()] }"},
		{"returned through a conditional", "export effect function fib(b: boolean) { const f = fork one(); return b ? f : undefined }"},
		{"arrow body", "export const fib = effect () => fork one()"},
		{"assigned outside", "export effect function fib() { outer = fork one() }"},
		{"assigned to a property", "export effect function fib(o: { f?: Fiber.Fiber<number> }) { o.f = fork one() }"},
		{"passed to a call", "export effect function fib() { keep(fork one()) }"},
		{"passed through a binding", "export effect function fib() { const f = fork one(); keep(f) }"},
		{"captured", "export effect function fib() { const f = fork one(); return () => f }"},
		{"discarded", "export effect function fib() { fork one(); return 0 }"},
		{"joined", "export effect function fib() { const f = fork one(); return join f }"},
		{"held object returned", "export effect function fib() { const a = fork one(); const box = { a }; return box }"},
		{"let reassigned", "export effect function fib() { let f = fork one(); f = fork one(); return join f }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError || (d.Source() == diagnosticSource && d.Code() == EK4838.Code) {
					t.Errorf("ordinary Fiber use rejected: %s", diagnosticWithNotes(d))
				}
			}
		})
	}
}

// The current fiber owns keyword fork in each transparent source region.
func TestForkRegions(t *testing.T) {
	for _, test := range []struct {
		name, source string
	}{
		{"function body", "effect function f() { fork one() }"},
		{"arrow body", "const f = effect () => fork one()"},
		{"if branch", "effect function f(b: boolean) { if (b) { fork one() } }"},
		{"if without braces", "effect function f(b: boolean) { if (b) fork one() }"},
		{"bare block", "effect function f() { { fork one() } }"},
		{"do block", "effect function f() { const x = do { fork one(); 1 }; return x }"},
		{"loop body", "effect function f() { for (const n of [1]) { fork one() } }"},
		{"loop body without braces", "effect function f() { for (const n of [1]) fork one() }"},
		{"try block", "effect function f() { try { fork one() } finally { } }"},
		{"using block", "effect function f(b: boolean) { if (b) { using t = { [Symbol.dispose]() {} }; fork one() } }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "effect function one() { try sleep(1); return 1 }\n" + test.source
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			a := analyzerFor(c)
			forks := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && a.isPreludeFork(n) {
					forks++
					if !isNativeFork(n) || a.getsScope(n) {
						t.Fatal("keyword fork received a lexical resource owner")
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if forks != 1 {
				t.Fatalf("found %d keyword forks, want 1", forks)
			}

		})
	}
}
