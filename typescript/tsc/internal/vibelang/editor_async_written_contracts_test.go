package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsWrittenPromiseContracts(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"inferred-variable", "export const load = async /*cursor*/(input: Promise<number>) => await input", true},
		{"own-return-annotation", "export async function /*cursor*/load(input: Promise<number>): Promise<number> { return await input }", true},
		{"inferred-method", "export const loader = { async /*cursor*/load(input: Promise<number>) { return await input } }", true},
		{"any-context", "export const load: (input: Promise<number>) => any = async /*cursor*/input => await input", true},
		{"unknown-context", "export const load: (input: Promise<number>) => unknown = async /*cursor*/input => await input", true},
		{"void-context", "export const load: (input: Promise<number>) => void = async /*cursor*/input => await input", true},
		{"object-context", "export const load: (input: Promise<number>) => object = async /*cursor*/input => await input", true},
		{"object-base-context", "interface Contract { load(input: Promise<number>): object }; export class Loader implements Contract { async /*cursor*/load(input: Promise<number>) { return await input } }", true},
		{"variable-contract", "export const load: (input: Promise<number>) => Promise<number> = async /*cursor*/(input) => await input", false},
		{"object-contract", "export const loader: { load(input: Promise<number>): Promise<number> } = { async /*cursor*/load(input) { return await input } }", false},
		{"implements-contract", "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { async /*cursor*/load(input: Promise<number>) { return await input } }", false},
		{"extends-contract", "class Base { async load(input: Promise<number>) { return await input } }; export class Loader extends Base { async /*cursor*/load(input: Promise<number>) { return await input } }", false},
		{"callback-contract", "function consume(f: (input: Promise<number>) => Promise<number>) {}; consume(async /*cursor*/(input) => await input)", false},
		{"assertion-contract", "export const load = (async /*cursor*/(input: Promise<number>) => await input) as ((input: Promise<number>) => Promise<number>)", false},
		{"satisfies-contract", "export const load = (async /*cursor*/(input: Promise<number>) => await input) satisfies ((input: Promise<number>) => Promise<number>)", false},
		{"overload-contract", "export function load(input: Promise<number>): Promise<number>; export async function /*cursor*/load(input: Promise<number>) { return await input }", false},
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
			count, bad := 0, 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				checked, edited, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if d.Category() == diagnostics.CategoryError {
						bad++
						t.Errorf("offered conversion does not check: %s", d.String())
					}
				}
			}
			want := 0
			if tc.offer {
				want = 2
			}
			if count != want {
				t.Fatalf("offered %d async conversions, want %d", count, want)
			}
			if bad != 0 {
				t.Fatalf("%d type errors from offered conversions", bad)
			}
		})
	}
}
