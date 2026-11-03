package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestCatchExecutionHeadSourceBoundaries(t *testing.T) {
	for _, test := range []struct {
		expression string
		want       int
	}{
		{"try p", 1}, {"try (p)", 1}, {"try f()", 1}, {"try (f())", 1},
		{"try p as any", 1}, {"<any>try p", 1}, {"try p satisfies any", 1}, {"try p!", 1}, {"try p<number>", 1},
		{"1 + try p", 1}, {"-try p", 1}, {"try p + try p", 2},
		{"fork p", 1}, {"join fiber", 1}, {"try.all [p]", 1}, {"try.race [p]", 1}, {"try.any [p]", 1}, {"try.allSettled [p]", 1},
		{"(try p)", 0}, {"(try f())", 0}, {"(try p) as any", 0}, {"(join fiber)!", 0}, {"(fork p)", 0},
		{"f(try p)", 0}, {"[try p]", 0}, {"({n:try p})", 0}, {"`n${try p}`", 0}, {"effect {return try p}", 0}, {"do {try p}", 0},
	} {
		t.Run(test.expression, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "export effect function main(){ return "+test.expression+" catch () => 0 }")
			var found *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if catchExpressionOf(n) != nil {
					found = n
					return true
				}
				return n.ForEachChild(visit)
			}
			visit(file.AsNode())
			if found == nil {
				t.Fatal("missing catch")
			}
			left, _ := catchParts(found)
			count := 0
			catchExecutionHeads(left, func(*ast.Node) { count++ })
			if count != test.want {
				t.Fatalf("got %d heads, want %d", count, test.want)
			}
			if count == 1 {
				catchExecutionHeads(left, func(head *ast.Node) {
					rewrite := catchExecutionRewrite(nil, file, head)
					if strings.HasPrefix(test.expression, "fork ") {
						return
					}
					if !rewrite.fixable() || !strings.Contains(rewrite.edits[0].text, "(") {
						t.Fatal("missing preserving effect block")
					}
				})
			}
		})
	}
}

func TestCatchExecutionPreservingFix(t *testing.T) {
	for _, head := range []string{"try p", "try p as Effect.Effect<number, string>", "join fiber", "fork p", "try.all [p]"} {
		t.Run(head, func(t *testing.T) {
			source := "declare const p: Effect.Effect<Effect.Effect<number, string>, string>; declare const fiber: Fiber.Fiber<Effect.Effect<number, string>, string>; export effect function main(){ " + head + " catch () => 0; return 0 }"
			got := applyQuickFixOf(t, source, EK0505.Code, diagnostics.CategoryError)
			if !strings.Contains(got, "(effect { return "+head) && !(head == "fork p" && strings.Contains(got, "fork Effect.catch(p,")) && !(head == "join fiber" && strings.Contains(got, "Fiber.join(fiber)")) {
				t.Fatal("first fix did not preserve running left side: " + got)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fix introduced an error: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

func TestCatchExecutionIndependentDiagnostics(t *testing.T) {
	source := `declare const p: number!!;
function take(n: number) { return Effect.succeed(n) }
export effect function main() {
 try take("bad") catch () => 0;
 try p satisfies string catch () => 0;
 try do { const n: number = "bad"; Effect.succeed(n) } catch () => 0;
 return 0
}`
	program, file, _, _ := editorProgram(t, source)
	codes := map[int32]bool{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		codes[d.Code()] = true
	}
	for _, code := range []int32{505, 2345, 1360, 2322} {
		if !codes[code] {
			t.Errorf("lost independent diagnostic %d: %v", code, codes)
		}
	}
}

func TestCatchExecutionForkHandlerKind(t *testing.T) {
	for _, handler := range []string{"() => 0", "(error) => error.length", "function (error) { return error.length }", "effect (error) => { return error.length }"} {
		t.Run(handler, func(t *testing.T) {
			source := "declare const p: number!string; export effect function main(){ const child = fork p catch " + handler + "; return join child }"
			got := applyQuickFixOf(t, source, EK0505.Code, diagnostics.CategoryError)
			if strings.Contains(got, "Effect.map(") == strings.HasPrefix(handler, "effect ") {
				t.Fatal("repair confused source handler kind: " + got)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("repair failed: %s\n%s", d.String(), got)
				}
			}
		})
	}
}
