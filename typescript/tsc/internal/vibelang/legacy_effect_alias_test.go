package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
