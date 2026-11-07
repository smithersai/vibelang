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
		{"computed-number-string", "const key: number = 7; export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-number-number", "const key: number = 7; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-template", "const key = 'load7' as `load${number}`; export const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-union", "const key = 7 as number | symbol; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-number-class", "const key: number = 7; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-string-class", "const key: number = 7; export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-template-class", "const key = 'load7' as `load${number}`; export class Loader { [key: `load${number}`]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-number-inherited", "const key: number = 7; class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export class Loader extends Base { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-union-string", "const key = 7 as number | `load${number}`; export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-any-control", "const key: number = 7; export const holder: Record<number, (input: Promise<number>) => any> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"computed-unknown-control", "const key = 'load7' as `load${number}`; export class Loader { [key: `load${number}`]: (input: Promise<number>) => unknown; /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"computed-other-index-control", "const key: number = 7; export class Loader { [key: symbol]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"computed-untyped-control", "const key: number = 7; export class Loader { /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"computed-template-number-contract", "const key = 'load7' as `load${number}`; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-template-other-contract", "const key = 'load7' as `load${number}`; export class Loader { [key: `task${number}`]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"named-other-inferred-contract", "const key: string = 'other'; export class Loader { async [key](input: Promise<number>) { return await input }; /*cursor*/async load(input: Promise<number>) { return await input } }", true},
		{"literal-other-inferred-contract", "const key: string = 'other'; const picked = 'load'; export class Loader { async [key](input: Promise<number>) { return await input }; /*cursor*/async [picked](input: Promise<number>) { return await input } }", true},
		{"computed-string-union-number", "const key = '7' as '7' | 'load'; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-template-untyped-control", "const key = 'load7' as `load${number}`; export class Loader { /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"computed-literal-untyped-control", "const picked = 'load'; export class Loader { /*cursor*/async [picked](input: Promise<number>) { return await input } }", true},
		{"computed-numeric-template-number", "const key = '7' as `${number}`; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-number-numeric-template", "const key: number = 7; export class Loader { [key: `${number}`]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } }", false},
		{"computed-numeric-template-control", "const key = '7' as `${number}`; export class Loader { /*cursor*/async [key](input: Promise<number>) { return await input } }", true},
		{"generic-union-number", "export function create<K extends number | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-union-string", "export function create<K extends number | symbol>(key: K) { const holder: { [key: string]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-union-template", "export function create<K extends `load${number}` | symbol>(key: K) { const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-numeric-template", "export function create<K extends `${number}` | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-union-class", "export function create<K extends number | symbol>(key: K) { return class Loader { [key: number]: (input: Promise<number>) => Promise<number>; /*cursor*/async [key](input: Promise<number>) { return await input } } }", false},
		{"generic-control", "export {}; function create<K extends number | symbol>(key: K) { return class Loader { /*cursor*/async [key](input: Promise<number>) { return await input } } }", true},
		{"generic-any-control", "export function create<K extends number | symbol>(key: K) { const holder: Record<number, (input: Promise<number>) => any> = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", true},
		{"generic-chained-number", "export function create<K extends number | symbol, P extends K>(key: P) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-keyof-number", "export function create<K extends keyof { [key: number]: unknown; [key: symbol]: unknown }>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-conditional-number", "export function create<K extends number | symbol>(key: K extends number ? K : symbol) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-union-inherited", "interface Base { [key: number]: (input: Promise<number>) => Promise<number> }; interface Derived extends Base {}; export function create<K extends number | symbol>(key: K) { const holder: Derived = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-number-contract", "export function create<K extends number>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-symbol-control", "export function create<K extends symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", true},
		{"generic-symbol-inherited-control", "class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export {}; function create<K extends symbol>(key: K) { return class Loader extends Base { /*cursor*/async [key](input: Promise<number>) { return await input } } }", true},
		{"generic-unknown-control", "export function create<K extends number | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => unknown } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", true},
		{"generic-literal-number", "export function create<K extends \"7\" | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-chained-template", "export function create<K extends `${number}` | symbol, P extends K>(key: P) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
		{"generic-literal-disjoint-contract", "export function create<K extends \"load\">(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { /*cursor*/async [key](input: Promise<number>) { return await input } }; return holder }", false},
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
