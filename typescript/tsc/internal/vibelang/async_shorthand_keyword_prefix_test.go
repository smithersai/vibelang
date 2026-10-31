package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncShorthandKeywordPrefix(t *testing.T) {
	for _, name := range []string{"functionality", "functionary", "function1", "function_", "function$", "functionπ", "later"} {
		for _, gap := range []string{" ", " /* keep async modifier */ "} {
			t.Run(name+gap, func(t *testing.T) {
				source := "const café = '😀';" + string(rune(10)) + "export async" + gap + name + "(input: Promise<number>) { return await input }"
				pos := strings.Index(source, "async")
				program, file, service, converters := editorProgram(t, source)
				for _, title := range []string{"Convert to a VibeLang function", "Convert to a VibeLang function with an error per await"} {
					var chosen *ls.CodeAction
					for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
						if action.Description == title {
							chosen = action
						}
					}
					if chosen == nil {
						t.Fatalf("missing %s", title)
					}
					got := applyEditorEdits(t, file, converters, chosen.Changes)
					checked, edited, _, _ := editorProgram(t, got)
					all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
					for _, d := range all {
						if d.Category() == diagnostics.CategoryError {
							t.Errorf("edited shorthand does not check after %s: %s\n%s", title, d.String(), got)
						}
					}
					marked := false
					var visit func(*ast.Node) bool
					visit = func(n *ast.Node) bool {
						if ast.IsFunctionLike(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
							marked = true
						}
						return n.ForEachChild(visit)
					}
					edited.AsNode().ForEachChild(visit)
					if !marked {
						t.Fatalf("edited shorthand has no explicit Effect function after %s: %s", title, got)
					}
					if !strings.Contains(got, "function"+gap+name+"(") && !strings.Contains(got, "function "+name+"(") {
						t.Errorf("shorthand repair did not write its function keyword after %s: %s", title, got)
					}
				}
			})
		}
	}
}
