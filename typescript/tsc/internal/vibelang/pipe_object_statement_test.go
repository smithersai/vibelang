package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestPipeObjectStatement(t *testing.T) {
	const helpers = `function f(x:unknown){return x}; function g(x:unknown){return x}; `
	for _, expression := range []string{`{a:1}`, `{a:{b:2}}`, `{get value(){return 1}}`, `class {}`} {
		for _, prefix := range []string{"", "const result = "} {
			source := helpers + prefix + "f(g(" + expression + "))"
			t.Run(prefix+expression, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, source)
				offset := strings.LastIndex(source, "f(g(")
				actions := vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(offset, offset), Program: program, LS: service})
				for _, action := range actions {
					if action.Description == "Convert to a pipe" {
						after := applyEditorEdits(t, file, converters, action.Changes)
						p, f, _, _ := editorProgram(t, after)
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() == diagnostics.CategoryError {
								t.Errorf("rewritten diagnostic: %s\n%s", d.String(), after)
							}
						}
						return
					}
				}
				t.Fatal("missing pipe action")
			})
		}
	}
}

// Pin the census witness inside a function and at an unbraced statement head.
func TestPipeObjectStatementCensus(t *testing.T) {
	for _, prefix := range []string{"", "if (true) "} {
		t.Run(prefix, func(t *testing.T) {
			source := "export function f() {\n  " + prefix + "Console.log(String({ a: 1 }))\n}\n"
			program, file, service, converters := editorProgram(t, source)
			// The census intentionally discards Console.log's unrun Effect.
			// Preserve EK4801 while requiring that no other error is added.
			beforeErrors := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					if d.Source() != "EK" || d.Code() != 4801 {
						t.Fatalf("input diagnostic: %s", d.String())
					}
					beforeErrors++
				}
			}
			offset := strings.Index(source, "Console.log")
			actions := vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(offset, offset), Program: program, LS: service})
			for _, action := range actions {
				if action.Description != "Convert to a pipe" {
					continue
				}
				after := applyEditorEdits(t, file, converters, action.Changes)
				want := strings.Replace(source, "Console.log(String({ a: 1 }))", "({ a: 1 }) |> String(%) |> Console.log(%)", 1)
				if after != want {
					t.Errorf("rewritten source:\n%s\nwant:\n%s", after, want)
				}
				p, f, _, _ := editorProgram(t, after)
				afterErrors := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() == diagnostics.CategoryError {
						if d.Source() != "EK" || d.Code() != 4801 {
							t.Errorf("rewritten diagnostic: %s\n%s", d.String(), after)
						}
						afterErrors++
					}
				}
				if beforeErrors != afterErrors {
					t.Errorf("error count changed: %d -> %d", beforeErrors, afterErrors)
				}
				return
			}
			t.Fatal("missing pipe action")
		})
	}
}
