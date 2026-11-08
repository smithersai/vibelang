package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestCatchHeadBoundaryRefusesNewOwners(t *testing.T) {
	for _, head := range []string{
		"do {try Effect.succeed(1); return 7}",
		"do {const child = fork Effect.succeed(1); try Effect.succeed(1); 7}",
		"do {using resource = Effect.succeed({[Symbol.dispose](){}}); try Effect.succeed(1); 7}",
	} {
		p, file, _, _ := editorProgram(t, "export effect function main(){return ("+head+") catch ()=>9}")
		p.GetSemanticDiagnostics(t.Context(), file)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		var call *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if catchExpressionOf(n) != nil {
				call = n
			}
			n.ForEachChild(visit)
			return false
		}
		file.AsNode().ForEachChild(visit)
		if call == nil {
			done()
			t.Fatal("missing catch")
		}
		rewrite := catchHeadBoundaryRewrite(c, file, call)
		done()
		if rewrite.fixable() {
			t.Fatalf("retargeted a jump/resource/child:\n%s", head)
		}
	}
}

func TestCatchHeadValueTypes(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"direct Effect", `export effect function main(): number!! {
            return Effect.fail("inner" as const) catch (e) => e.length
        }`},
		{"returned Effect", `export effect function main(): number!! {
            return (try Effect.succeed(Effect.fail("inner" as const))) catch (e) => e.length
        }`},
		{"explicit boundary", `export effect function main(): number!! {
            return (effect { return Effect.fail("inner" as const) catch (e) => e.length }) catch () => 0
        }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if errors := errorsOf(t, tc.source); len(errors) != 0 {
				t.Fatalf("catch head changed the source value or handler channel: %v", errors)
			}
		})
	}
}
