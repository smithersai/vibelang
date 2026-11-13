package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsSelfReferences(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"declaration", "export async function /*cursor*/load(n: number): Promise<number> { if (n > 0) return await load(n - 1); return 0 }", false},
		{"expression", "export const load = async function /*cursor*/recur(n: number): Promise<number> { if (n > 0) return await recur(n - 1); return 0 }", false},
		{"property-value", "declare function retain(f: (n: number) => Promise<number>): void; export const loader = { load: async /*cursor*/(n: number): Promise<number> => { retain(loader.load); return await Promise.resolve(n) } }", false},
		{"property-arrow", "export const loader = { load: async /*cursor*/(n: number): Promise<number> => n > 0 ? await loader.load(n - 1) : 0 }", false},
		{"field-arrow", "export class Loader { load = async /*cursor*/(n: number): Promise<number> => n > 0 ? await this.load(n - 1) : 0 }", false},
		{"arrow", "export const load = async /*cursor*/(n: number): Promise<number> => n > 0 ? await load(n - 1) : 0", false},
		{"object-method", "export const loader = { async /*cursor*/load(n: number): Promise<number> { if (n > 0) return await this.load(n - 1); return 0 } }", false},
		{"class-method", "export class Loader { async /*cursor*/load(n: number): Promise<number> { if (n > 0) return await this.load(n - 1); return 0 } }", false},
		{"symbol-method", "const key = Symbol(); export class Loader { async /*cursor*/[key](n: number): Promise<number> { if (n > 0) return await this[key](n - 1); return 0 } }", false},
		{"computed-method", "const key = \"load\"; export class Loader { async /*cursor*/[key](n: number): Promise<number> { if (n > 0) return await this[key](n - 1); return 0 } }", false},
		{"element-method", "export class Loader { async /*cursor*/load(n: number): Promise<number> { if (n > 0) return await this[\"load\"](n - 1); return 0 } }", false},
		{"private-method", "export class Loader { async /*cursor*/#load(n: number): Promise<number> { if (n > 0) return await this.#load(n - 1); return 0 } }", false},
		{"static-method", "export class Loader { static async /*cursor*/load(n: number): Promise<number> { if (n > 0) return await Loader.load(n - 1); return 0 } }", false},
		{"alias", "export async function /*cursor*/load(n: number): Promise<number> { const recur = load; if (n > 0) return await recur(n - 1); return 0 }", false},
		{"nested-capture", "export async function /*cursor*/load(n: number): Promise<number> { const recur = async () => await load(n - 1); if (n > 0) return await recur(); return 0 }", false},
		{"parameter-default", "export async function /*cursor*/load(n: number, recur: (n: number) => Promise<number> = load): Promise<number> { if (n > 0) return await recur(n - 1); return 0 }", false},
		{"ordinary-control", "export async function /*cursor*/load(input: Promise<number>): Promise<number> { return await input }", true},
		{"shadowed-control", "export async function /*cursor*/load(input: Promise<number>): Promise<number> { const recur = async (load: Promise<number>) => await load; return await recur(input) }", true},
		{"property-control", "export async function /*cursor*/load(input: { load: Promise<number> }): Promise<number> { return await input.load }", true},
		{"type-control", "export async function /*cursor*/load(input: Promise<number>): Promise<number> { type Own = typeof load; return await input }", true},
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
				if tc.offer {
					got := applyEditorEdits(t, file, converters, action.Changes)
					checked, edited, _, _ := editorProgram(t, got)
					for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
						if d.Category() == diagnostics.CategoryError {
							t.Errorf("invalid conversion: %s\n%s", d.String(), got)
						}
					}
				}
			}
			want := 0
			if tc.offer {
				want = 2
			}
			if count != want {
				t.Fatalf("offered %d async conversions, want %d: %s", count, want, source)
			}
		})
	}
}
