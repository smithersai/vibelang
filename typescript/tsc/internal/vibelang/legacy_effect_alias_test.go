package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-3/VIP-14, decided detail260: only the unwritten transitional prelude
// alias migrates. Local/imported native type declarations keep their meaning.
func TestLegacyEffectAliasWarning(t *testing.T) {
	for _, source := range []string{
		"export type Value = Effect<number>",
		"export let value: Effect<string, Error>",
		"export type Values = Array<Effect<number>>",
		"export type Value = Effect<Effect<number>>",
		"export type Value = { read(): Effect<number> }",
		"export type Value = [Effect<number>]",
		"export interface Value extends Effect<number> {}",
		"export type Value = (() => Effect<number>)",
		"export type Value = Effect<number> | null",
		"export type Value = number!!(Effect<string>)",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			got := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4856 {
					got++
					if d.Category() != diagnostics.CategoryWarning {
						t.Errorf("category %v; want warning", d.Category())
					}
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected error: %s", d.String())
				}
			}
			want := strings.Count(source, "Effect<")
			if got != want {
				t.Errorf("got %d EK4856 warnings; want %d", got, want)
			}
		})
	}
}
func TestLegacyEffectAliasPreservesNativeBindings(t *testing.T) {
	for _, source := range []string{
		"type Effect<A> = { value: A }; export type Value = Effect<number>",
		"type Effect<A> = import(\"effect/Effect\").Effect<A>; export type Value = Effect<number>",
		"import type { Effect } from \"effect/Effect\"; export type Value = Effect<number>",
		"import type { Effect as Native } from \"effect/Effect\"; export type Value = Native<number>",
		"import { Effect } from \"effect\"; export type Value = Effect.Effect<number>",
		"export type Value = number!!",
		"export type Value<Effect> = Effect",
		"export type Value = { Effect: number }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4856 || d.Category() == diagnostics.CategoryError {
					t.Errorf("native binding changed: %s", d.String())
				}
			}
		})
	}
}
func TestLegacyEffectAliasQuickFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export type Value = Effect<number>", "export type Value = number!!"},
		{"export type Value = Effect<number, never>", "export type Value = number!never"},
		{"export type Value = Effect<number, never, never>", "export type Value = number!never!never"},
		{"type Inner = Effect<number, never, never>; export type Value = Inner", "type Inner = number!never!never; export type Value = Inner"},
		{"export type Value = Effect<number | string>", "export type Value = Effect.Effect<number | string>"},
		{"export type Value = Effect<{ a: number } & { b: string }>", "export type Value = Effect.Effect<{ a: number } & { b: string }>"},
		{"export type Value = Effect<number, Error | { readonly _tag: 'Missing' }>", "export type Value = Effect.Effect<number, Error | { readonly _tag: 'Missing' }>"},
		{"export type Value = Effect<number, never, \"Left\" | \"Right\">", "export type Value = Effect.Effect<number, never, \"Left\" | \"Right\">"},
		{"export type Value = Array<Effect<number>>", "export type Value = Array<number!!>"},
		{"export type Value = Effect<() => number>", "export type Value = Effect.Effect<() => number>"},
		{"export type Value = Effect<number, Error>", "export type Value = number!Error"},
		{"export type Value = [Effect<number>]", "export type Value = [number!!]"},
		{"export type Value = Effect<number>[]", "export type Value = Effect.Effect<number>[]"},
		{"export interface Value extends Effect<number> {}", "export interface Value extends Effect.Effect<number> {}"},
		{"export type Value = Effect<number> | null", "export type Value = Effect.Effect<number> | null"},
		{"export type Value = null | Effect<number>", "export type Value = null | Effect.Effect<number>"},
		{"export type Value = Effect<number> & { readonly id: string }", "export type Value = Effect.Effect<number> & { readonly id: string }"},
		{"export type Value = keyof Effect<number>", "export type Value = keyof Effect.Effect<number>"},
		{"export type Value<T> = Effect<number> extends T ? 1 : 2", "export type Value<T> = Effect.Effect<number> extends T ? 1 : 2"},
		{"export type Value = (Effect<number>)[]", "export type Value = (Effect.Effect<number>)[]"},
		{"export type Value = Effect<(number | string)>", "export type Value = Effect.Effect<(number | string)>"},
		{"export type Value = Effect<number, (Error | string)>", "export type Value = Effect.Effect<number, (Error | string)>"},
		{"export type Value = Effect<(() => number)>", "export type Value = Effect.Effect<(() => number)>"},
		{"export type Value = Effect<new () => { readonly id: number }>", "export type Value = Effect.Effect<new () => { readonly id: number }>"},
		{"export type Value<T> = Effect<T extends string ? 1 : 2>", "export type Value<T> = Effect.Effect<T extends string ? 1 : 2>"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got := applyQuickFix(t, test.source, 4856)
			if got != test.want {
				t.Errorf("got %q; want %q", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4856 || d.Category() == diagnostics.CategoryError {
					t.Errorf("repair failed: %s", d.String())
				}
			}
		})
	}
}

// D260 retains native namespace/type distinctions. These are native-error
// controls, separate from the legacy prelude alias that receives a warning.
func TestLegacyEffectAliasModuleConfiguration(t *testing.T) {
	for _, setting := range []core.Tristate{core.TSUnknown, core.TSTrue, core.TSFalse} {
		for _, test := range []struct {
			name, prefix string
			code         int32
		}{
			{"implicit", "", 0},
			{"root module", "import { Effect } from \"effect\"; ", 2709},
			{"namespace module", "import * as Effect from \"effect/Effect\"; ", 2709},
			{"native type", "import type { Effect } from \"effect/Effect\"; ", 0},
		} {
			t.Run(fmt.Sprintf("%s/%v", test.name, setting), func(t *testing.T) {
				program, file, _, _ := editorProgram(t, test.prefix+"export type Value = Effect<number>")
				program.Options().VibeLang = &core.VibeLangOptions{EffectModules: setting}
				wantCode, wantWarnings := test.code, 0
				if test.name == "implicit" {
					if setting == core.TSFalse {
						wantCode = 2304
					} else {
						wantWarnings = 1
					}
				}
				warnings := 0
				var errors []int32
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == 4856 {
						warnings++
					}
					if d.Category() == diagnostics.CategoryError {
						errors = append(errors, d.Code())
					}
				}
				if warnings != wantWarnings {
					t.Errorf("got %d EK4856 warnings, want %d", warnings, wantWarnings)
				}
				if wantCode == 0 && len(errors) != 0 || wantCode != 0 && (len(errors) != 1 || errors[0] != wantCode) {
					t.Errorf("got native errors %v, want code %d", errors, wantCode)
				}
			})
		}
	}
}

// Details260/277: a qualified migration result retains its EK4833 advisory,
// but neither a style action nor a later --fix round may undo its contract.
func TestLegacyEffectAliasStyleAdvisory(t *testing.T) {
	for _, source := range []string{
		"export type Value = Effect.Effect<number>[]",
		"export type Value = Effect.Effect<number> | null",
		"export type Value = (Effect.Effect<number>)[]",
		"export type Value = Effect.Effect<(number | string)>",
		"export type Value = Effect.Effect<number, Error | string>",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			found := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Fatalf("native qualified contract failed: %s", diagnostic.String())
				}
				if diagnostic.Code() != 4833 || diagnostic.Source() != diagnosticSource {
					continue
				}
				found = true
				notes := ""
				for _, note := range diagnostic.MessageChain() {
					notes += note.String()
				}
				if !strings.Contains(notes, "No quick fix") {
					t.Fatalf("advisory omitted its refusal reason: %s", notes)
				}
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write ") {
							t.Fatalf("unsafe automatic style edit: %s", action.CodeAction.Title)
						}
					}
				}
			}
			if !found {
				t.Fatal("qualified type lost its EK4833 style advisory")
			}
		})
	}
}
