package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorErrorNames(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"error", "error PromiseFailed { previous: string }\nexport /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"class", "class PromiseFailed {}\nexport /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"type", "type PromiseFailed = number\nexport /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"interface", "interface PromiseFailed { previous: string }\nexport /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"value", "const PromiseFailed = 1\nexport /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"parameter", "export /*cursor*/async function load(input: Promise<number>, PromiseFailed: number) { return await input }", "PromiseFailed2"},
		{"local", "export /*cursor*/async function load(input: Promise<number>) { const PromiseFailed = 1; return await input }", "PromiseFailed2"},
		{"local-class", "export /*cursor*/async function load(input: Promise<number>) { class PromiseFailed {}; return await input }", "PromiseFailed2"},
		{"expression-name", "export const load = /*cursor*/async function PromiseFailed(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"arrow", "export const load = /*cursor*/async (input: Promise<number>, PromiseFailed: number) => await input", "PromiseFailed2"},
		{"object-method", "export const loader = { /*cursor*/async load(input: Promise<number>, PromiseFailed: number) { return await input } }", "PromiseFailed2"},
		{"class-method", "export class Loader { /*cursor*/async load(input: Promise<number>, PromiseFailed: number) { return await input } }", "PromiseFailed2"},
		{"suffix", "const PromiseFailed = 1, PromiseFailed2 = 2, PromiseFailed3 = 3; export /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed4"},
		{"escaped", "const Promise\\u0046ailed = 1; export /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed2"},
		{"callee", "function read(input: Promise<number>) { return input }; const ReadFailed = 1; export /*cursor*/async function load(input: Promise<number>) { return await read(input) }", "ReadFailed2"},
		{"control", "export /*cursor*/async function load(input: Promise<number>) { return await input }", "PromiseFailed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pos := strings.Index(tc.source, "/*cursor*/")
			source := strings.ReplaceAll(tc.source, "/*cursor*/", "")
			program, file, service, converters := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
			}
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				if strings.HasSuffix(action.Description, "with an error per await") {
					if !strings.Contains(got, "error "+tc.want+" { cause: unknown }") || !strings.Contains(got, "new "+tc.want+"({ cause })") {
						t.Errorf("generated error name must avoid existing bindings, want %s:\n%s", tc.want, got)
					}
				}
				checked, edited, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid conversion: %s\n%s", d.String(), got)
					}
				}
			}
			if count != 2 {
				t.Fatalf("offered %d conversions, want 2", count)
			}
		})
	}
}
