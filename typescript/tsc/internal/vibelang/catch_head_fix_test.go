package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"strings"
	"testing"
)

func TestCatchHeadPreservingFix(t *testing.T) {
	for _, test := range []struct{ name, head string }{
		{"number", "identity(try Effect.succeed(1))"},
		{"failure", "identity(try Effect.fail(\"outer\"))"},
		{"comment", "identity(/* keep */ try Effect.succeed(1))"},
		{"chain", "(Effect.fail(1) catch effect ()=>7)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "function identity(n:number){return n}\nexport effect function main(){return " + test.head + " catch ()=>9}\n"
			got, result := fixedPipe(t, source)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if !strings.Contains(got, "effect {") {
				program, file, _, _ := editorProgram(t, source)
				program.GetSemanticDiagnostics(t.Context(), file)
				c, done := program.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				var inspect func(*ast.Node) bool
				inspect = func(node *ast.Node) bool {
					if catchExpressionOf(node) != nil {
						fn := node.Arguments()[0]
						t.Logf("CATCH_FIX head=%d:%d operand=%s runs=%d changesOwner=%t fixable=%t",
							nodeStart(file, fn), fn.End(), c.TypeToString(inlineCatchOperandType(c, node)),
							len(analyzerFor(c).flowOf(fn.Body()).runs), catchHeadBoundaryChangesOwner(c, file, fn.Body()),
							catchHeadBoundaryRewrite(c, file, node).fixable())
					}
					return node.ForEachChild(inspect)
				}
				file.AsNode().ForEachChild(inspect)
				t.Fatalf("missing preserving block (remaining: %+v; sites: %+v):\n%s", result.Remaining, result.Sites, got)
			}
			if test.name == "comment" && !strings.Contains(got, "/* keep */") {
				t.Fatalf("lost comment:\n%s", got)
			}
			if errors := errorsOf(t, got); len(errors) != 0 {
				t.Fatalf("fixed source has errors: %v\n%s", errors, got)
			}
			again, result := fixedPipe(t, got)
			if result.Err != nil || again != got {
				t.Fatalf("fix not idempotent: %v\n%s\n%s", result.Err, got, again)
			}
		})
	}
}

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
