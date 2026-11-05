package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsCallablePropertyContracts(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"implements-field", "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { load = /*cursor*/async (input: Promise<number>) => await input }", false},
		{"extends-field", "class Base { load = async (input: Promise<number>) => await input }; export class Loader extends Base { load = /*cursor*/async (input: Promise<number>) => await input }", false},
		{"implements-expression", "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { load = /*cursor*/async function (input: Promise<number>) { return await input } }", false},
		{"static-field", "class Base { static load = async (input: Promise<number>) => await input }; export class Loader extends Base { static load = /*cursor*/async (input: Promise<number>) => await input }", false},
		{"index-method", "export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { /*cursor*/async load(input: Promise<number>) { return await input } }", false},
		{"class-index", "export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; load = /*cursor*/async (input: Promise<number>) => await input }", false},
		{"class-method-index", "export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; /*cursor*/async load(input: Promise<number>) { return await input } }", false},
		{"number-index", "export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { /*cursor*/async 7(input: Promise<number>) { return await input } }", false},
		{"template-index", "export const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async load7(input: Promise<number>) { return await input } }", false},
		{"symbol-index", "const key = Symbol(); export const holder: { [key: symbol]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"untyped-field-control", "export class Loader { load = /*cursor*/async (input: Promise<number>) => await input }", true},
		{"object-base-field-control", "interface Contract { load(input: Promise<number>): object }; export class Loader implements Contract { load = /*cursor*/async (input: Promise<number>) => await input }", true},
		{"any-index-control", "export const holder: Record<string, (input: Promise<number>) => any> = { /*cursor*/async load(input: Promise<number>) { return await input } }", true},
		{"unknown-class-index-control", "export class Loader { [key: string]: (input: Promise<number>) => unknown; load = /*cursor*/async (input: Promise<number>) => await input }", true},
		{"other-number-index-control", "export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; load = /*cursor*/async (input: Promise<number>) => await input }", true},
		{"other-template-index-control", "export class Loader { [key: `task${number}`]: (input: Promise<number>) => Promise<number>; load = /*cursor*/async (input: Promise<number>) => await input }", true},
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
			if tc.offer && count != 2 {
				t.Fatalf("missing safe conversion: got %d actions", count)
			}
			if bad != 0 {
				t.Fatalf("%d type errors from offered conversions", bad)
			}
		})
	}
}
