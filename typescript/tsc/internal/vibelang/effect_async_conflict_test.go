package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEffectAsyncConflictQuickFix(t *testing.T) {
	for _, prefix := range []string{"effect async", "async effect", "effect /* keep 😀 */ async", "async /* keep */ effect"} {
		for _, form := range []string{"%s function f() {}", "const f = %s () => 1", "class C { %s m() {} }", "const f = %s { return 1 }"} {
			source := fmt.Sprintf(form, prefix)
			t.Run(source, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, source)
				var found *ast.Diagnostic
				for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 105 {
						found = d
					}
				}
				if found == nil {
					t.Fatal("missing parser EK0105")
				}
				actions, err := effectAsyncConflictFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: core.NewTextRange(found.Pos(), found.End()), ErrorCode: 105, Program: program, LS: service})
				want := 2
				if strings.Contains(form, "return 1 }") {
					want = 1
				}
				if err != nil || len(actions) != want {
					t.Fatalf("quick fixes: %v, %v (want %d)", actions, err, want)
				}
				first := "Remove effect modifier"
				if want == 1 {
					first = "Remove async modifier"
				}
				if actions[0].Description != first {
					t.Fatal("CLI must preserve the old Promise API for functions")
				}
				for _, action := range actions {
					got := applyEditorEdits(t, file, converters, action.Changes)
					modifier := strings.TrimSuffix(strings.TrimPrefix(action.Description, "Remove "), " modifier")
					expected := strings.Replace(source, modifier, "", 1)
					if got != expected {
						t.Fatalf("fix lost source trivia: got %q want %q", got, expected)
					}
					checked, edited, _, _ := editorProgram(t, got)
					if ds := checked.GetSyntacticDiagnostics(t.Context(), edited); len(ds) != 0 {
						t.Fatalf("fix does not parse: %v", ds)
					}
				}
			})
		}
	}
}
