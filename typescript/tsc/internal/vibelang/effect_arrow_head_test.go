package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEffectArrowHeadDiagnosticAndFix(t *testing.T) {
	for _, test := range []struct{ name, source, fixed string }{
		{"typed", "const value = effect x: number => x", "const value = effect (x: number) => x"},
		{"effect parameter", "const value = effect x: number!! => x", "const value = effect (x: number!!) => x"},
		{"union parameter", "const value = effect x: number | string => x", "const value = effect (x: number | string) => x"},
		{"array parameter", "const value = effect x: readonly number[] => x", "const value = effect (x: readonly number[]) => x"},
		{"function parameter", "const value = effect x: (n: number) => number => x", "const value = effect (x: (n: number) => number) => x"},
		{"optional typed", "const value = effect x?: number => x", "const value = effect (x?: number) => x"},
		{"generic typed", "const value = effect <T> x: T => x", "const value = effect <T> (x: T) => x"},
		{"generic bare", "const value = effect <T> x => x", "const value = effect <T> (x) => x"},
		{"generic constraint", "const value = effect <T extends Array<string>> x: T => x", "const value = effect <T extends Array<string>> (x: T) => x"},
		{"generic function constraint", "const value = effect <T extends (n: number) => number> x: T => x", "const value = effect <T extends (n: number) => number> (x: T) => x"},
		{"generic default", "const value = effect <T = number> x: T => x", "const value = effect <T = number> (x: T) => x"},
		{"comments", "const café = '😀';\nconst value = effect /* head */ x /* name */: number /* type */ => x", "const café = '😀';\nconst value = effect /* head */ (x /* name */: number) /* type */ => x"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			syntax := program.GetSyntacticDiagnostics(t.Context(), file)
			for _, d := range syntax {
				if d.Source() != "EK" || d.Code() != 109 {
					t.Fatalf("recognized Effect head lost recovery: %v", syntax)
				}
			}
			var found *ast.Diagnostic
			for _, d := range append(syntax, program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == "EK" && d.Code() == 109 {
					if found != nil {
						t.Fatal("duplicate EK0109")
					}
					found = d
				}
			}
			if found == nil {
				t.Fatal("missing EK0109")
			}
			actions, err := typeScriptFormFix.GetCodeActions(t.Context(), &ls.CodeFixContext{
				SourceFile: file, Span: core.NewTextRange(found.Pos(), found.End()),
				ErrorCode: 109, Program: program, LS: service,
			})
			if err != nil || len(actions) != 1 {
				t.Fatalf("parenthesizing quick fix: %v, %v", actions, err)
			}
			got := applyEditorEdits(t, file, converters, actions[0].Changes)
			if got != test.fixed {
				t.Fatalf("quick fix changed source:\ngot: %s\nwant: %s", got, test.fixed)
			}
			checked, edited, _, _ := editorProgram(t, got)
			keptImplicitAny := false
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
				if d.Category() == diagnostics.CategoryError {
					// Parentheses fix the head; a genuinely untyped generic
					// parameter keeps TypeScript's independent strict error.
					if test.name == "generic bare" && d.Source() == "" && d.Code() == 7006 {
						keptImplicitAny = true
						continue
					}
					t.Errorf("parenthesized source has an error: %s\n%s", d.String(), got)
				}
			}
			if test.name == "generic bare" && !keptImplicitAny {
				t.Fatal("parenthesizing the head suppressed native TS7006")
			}
		})
	}
}

func TestEffectArrowHeadContextualControls(t *testing.T) {
	for _, source := range []string{
		"const effect = (x: number) => x; const value = effect(1)",
		"function effect<T>(x: T): T { return x }; const value = effect<number>(1)",
		"const effect = 1; const value = effect < 2",
		"const value = (effect: number) => effect",
		"const value: (x: number) => (number!!) = effect x => x",
		"const value = effect (x: number) => x",
		"const value = effect <T>(x: T) => x",
		"const value = effect <T extends (n: number) => number>(x: T) => x",
		"const value = { effect: (x: number) => x }",
		"const effect = 1; effect\nx => x",
		"const value = async x: number => x",
		"const value = effect (x: ) => x",
	} {
		t.Run(strings.ReplaceAll(source, "\n", " newline "), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == "EK" && d.Code() == 109 {
					t.Fatalf("ordinary/native syntax was reclassified: %s\n%s", d.String(), source)
				}
			}
		})
	}
}

func TestEffectArrowHeadKeepsBodyErrors(t *testing.T) {
	program, file, _, _ := editorProgram(t, "const value = effect x: number => { const broken = }")
	for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
		if d.Source() == "" {
			return
		}
	}
	t.Fatal("the invalid body lost its native parser error")
}
