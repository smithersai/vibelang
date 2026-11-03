package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestPlainHandlerEffectAdviceQuickfix(t *testing.T) {
	for _, text := range []string{"() => Effect.succeed(0)", "() => { return Effect.succeed(0) }"} {
		source := "export effect function load() { return Effect.fail(\"bad\") catch " + text + " }"
		program, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == "EK" && d.Code() == 508 {
				found = true
				if d.Category() != diagnostics.CategoryWarning {
					t.Errorf("EK0508 is not a warning: %v", d.Category())
				}
			}
		}
		if !found {
			t.Fatalf("missing EK0508 for %s", text)
		}
		var handler *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if call := catchExpressionOf(n); call != nil {
				_, fallback := catchParts(call)
				handler = plainCatchHandler(call, fallback)
				return true
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		edits := catchHandlerEffectEdits(c, file, handler)
		done()
		if len(edits) == 0 {
			t.Fatalf("no quick fix for %s", text)
		}
		rewritten := applyTextChanges(source, edits)
		fixed, ff, _, _ := editorProgram(t, rewritten)
		for _, d := range fixed.GetSemanticDiagnostics(t.Context(), ff) {
			if d.Category() == diagnostics.CategoryError || d.Source() == "EK" && d.Code() == 508 {
				t.Fatalf("invalid quick fix: %s\n%s", d.String(), rewritten)
			}
		}
	}
}

func TestPlainHandlerEffectAdviceMixedResultNeedsBranch(t *testing.T) {
	source := "declare const input: Effect.Effect<number> | number; export effect function load() {return Effect.fail(\"bad\") catch () => input}"
	program, file, _, _ := editorProgram(t, source)
	var handler *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if call := catchExpressionOf(n); call != nil {
			_, fallback := catchParts(call)
			handler = plainCatchHandler(call, fallback)
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	if edits := catchHandlerEffectEdits(c, file, handler); len(edits) != 0 {
		t.Fatal("mixed data/Effect result cannot blindly be run")
	}
}
