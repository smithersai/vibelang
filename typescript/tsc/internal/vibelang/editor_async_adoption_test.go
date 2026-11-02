package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestEditorAsyncAdoptsCompletedReturn(t *testing.T) {
	t.Run("LSP same-start protocol", checkAsyncRefactorEditProtocol)
	for _, source := range []string{
		"export async function /*cursor*/f(input: number) { return input }",
		"type Unrelated = Option.Option<number>; export async function /*cursor*/f(input: number) { return input }",
		"export async function /*cursor*/f(__asyncValue: number) { return __asyncValue }",
		"export const f = async /*cursor*/(input: number) => input",
		"export async function /*cursor*/f(input: Promise<number>) { return await input }",
		"export async function /*cursor*/f(input: number) { 'use strict'; return input }",
		"export async function /*cursor*/f(input: number) { const __asyncValue = 1; return input + __asyncValue - __asyncValue }",
	} {
		t.Run(source, func(t *testing.T) {
			pos := strings.Index(source, "/*cursor*/")
			source = strings.ReplaceAll(source, "/*cursor*/", "")
			program, file, service, converters := editorProgram(t, source)
			var chosen *ls.CodeAction
			for _, a := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if a.Description == "Convert to a VibeLang function" {
					chosen = a
					break
				}
			}
			if chosen == nil {
				t.Fatal("missing conversion for primitive-typed returned value")
			}
			got := applyEditorEdits(t, file, converters, chosen.Changes)
			// The source body must finish before native Promise adoption. Merely
			// yielding at the return evaluates then getters before IteratorClose or
			// finally, and a primitive TypeScript type does not rule out boxing.
			if !strings.Contains(got, "try effect {") || !strings.Contains(got, "Effect.tryPromise(async () =>") {
				t.Fatalf("missing completed-body adoption bridge:\n%s", got)
			}
			checked, edited, _, _ := editorProgram(t, got)
			all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("conversion does not check: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

func TestEditorAsyncAdoptionDeclinesShadowedBridge(t *testing.T) {
	for _, source := range []string{
		"const Effect = { tryPromise: 1 }; export async function /*cursor*/f(input: number) { return input }",
		"import type { Effect } from \"effect\"; export async function /*cursor*/f(input: number) { return input }",
		"export async function /*cursor*/f(Effect: { tryPromise: number }, input: number) { return input }",
		"export async function /*cursor*/f(input: number) { const Effect = { tryPromise: 1 }; return input }",
	} {
		t.Run(source, func(t *testing.T) {
			pos := strings.Index(source, "/*cursor*/")
			source = strings.ReplaceAll(source, "/*cursor*/", "")
			program, file, service, _ := editorProgram(t, source)
			for _, a := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if strings.HasPrefix(a.Description, "Convert to a VibeLang function") {
					t.Fatalf("offered a conversion through an unavailable Effect value: %s", source)
				}
			}
		})
	}
}

func TestEditorAsyncAdoptionModuleConfiguration(t *testing.T) {
	for _, test := range []struct {
		name, prefix, body string
		disabled, want     bool
	}{
		{"implicit", "", "return input", false, true},
		{"disabled", "", "return input", true, false},
		{"root value", "import { Effect } from \"effect\"; ", "return input", true, true},
		{"namespace value", "import * as Effect from \"effect/Effect\"; ", "return input", true, true},
		{"type-only root", "import type { Effect } from \"effect\"; ", "return input", false, false},
		{"type-only namespace", "import type * as Effect from \"effect/Effect\"; ", "return input", false, false},
		{"literal without module", "", "return 1", true, true},
		{"literal with shadow", "const Effect = { tryPromise: 1 }; ", "return 1", false, true},
		{"nested shadow", "", "function nested(Effect: number): number { return Effect }; return input", false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := test.prefix + "export async function f(input: number) { " + test.body + " }"
			pos := strings.Index(source, "async function")
			program, file, service, converters := editorProgram(t, source)
			setting := core.TSUnknown
			if test.disabled {
				setting = core.TSFalse
			}
			program.Options().VibeLang = &core.VibeLangOptions{EffectModules: setting}
			var chosen *ls.CodeAction
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{
				SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service,
			}) {
				if action.Description == "Convert to a VibeLang function" {
					chosen = action
					break
				}
			}
			if (chosen != nil) != test.want {
				t.Fatalf("offered conversion=%v, want %v: %s", chosen != nil, test.want, source)
			}
			if chosen == nil {
				return
			}
			got := applyEditorEdits(t, file, converters, chosen.Changes)
			checked, edited, _, _ := editorProgram(t, got)
			checked.Options().VibeLang = &core.VibeLangOptions{EffectModules: setting}
			all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("conversion does not check: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

// LSP 3.17 permits same-start insertions followed by one replacement.
func checkAsyncRefactorEditProtocol(t *testing.T) {
	const source = "const café = '😀'; export const value = 0"
	_, file, _, converters := editorProgram(t, source)
	pos := strings.LastIndex(source, "0")
	edit := func(start, end int, text string) *lsproto.TextEdit {
		r, _ := converters.ToLSPRange(file, core.NewTextRange(start, end))
		return &lsproto.TextEdit{Range: r, NewText: text}
	}
	for _, test := range []struct {
		name         string
		prefixes     []string
		suffix, want string
	}{
		{"one insertion", []string{"("}, ")", "(7)"},
		{"two insertions", []string{"(", "["}, "])", "([7])"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var edits []*lsproto.TextEdit
			for _, prefix := range test.prefixes {
				edits = append(edits, edit(pos, pos, prefix))
			}
			edits = append(edits, edit(pos, pos+1, "7"), edit(pos+1, pos+1, test.suffix))
			got := applyEditorEdits(t, file, converters, edits)
			want := strings.Replace(source, "0", test.want, 1)
			if got != want {
				t.Fatalf("LSP edit protocol:\ngot: %s\nwant: %s", got, want)
			}
		})
	}
}
