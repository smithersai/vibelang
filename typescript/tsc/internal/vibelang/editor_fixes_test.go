package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Native catch parameter annotations are TypeScript annotations, not retired
// failure filters. In particular, any permits binding patterns.
func TestEditorNativeCatchAnnotations(t *testing.T) {
	for _, source := range []string{
		"export function r() { try { return 0 } catch ({ code }: any) { return code } }",
		"export function r() { try { return 0 } catch ([first]: any) { return first } }",
		"export function r() { try { return 0 } catch (error: unknown) { return error } }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			if ds := program.GetSemanticDiagnostics(t.Context(), file); len(ds) != 0 {
				t.Fatalf("native catch annotation: %v; want no diagnostic", ds)
			}
		})
	}
}

// The helper return-type fixes answered D67's inferred kinds: EK4301 for a
// helper passed or called where a callback runs synchronously, EK1001 for one
// a top level calls, and EK9203 for one a plain annotation calls. VIP-1 makes
// a function's kind its marker, so an unmarked helper is plain JavaScript and
// each of these sources compiles without an error to fix.
func TestRetiredHelperReturnTypeDiagnostics(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"return type of a passed helper", "function twice(n: number) { return n * 2 }\nexport const doubled = [1, 2].map(twice)"},
		{"return type of a helper a callback calls", "const inc = (n: number) => n + 1\nexport const bumped = [1, 2].map((n) => inc(n))"},
		{"return type of a helper at a top level", "function label(n: number) { return `#${n}` }\nexport const first = label(1)"},
		{"return type of a helper and its own", "function half(n: number) { return n / 2 }\nfunction quarter(n: number) { return half(half(n)) }\nexport function plain(n: number): number { return quarter(n) }"},
		{"return type through a name in scope", "namespace Store {\n  export interface Ref<A> { readonly target: A }\n  export const ref = (id: string): Ref<string> => ({ target: id })\n}\nconst refOf = (id: string) => Store.ref(id)\nexport const refs = [\"a\"].map(refOf)"},
		{"long return type as infer", "const pairs = (n: number) => ({ id: n, label: `#${n}`, next: n + 1, prev: n - 1, tags: [String(n)] })\nexport const made = pairs(1)"},
		{"resource callback", "function timer(name: string) { return { name, [Symbol.dispose]() {} } }\nexport function names(ids: string[]) { return ids.map((id) => { using t = timer(id); return t.name }) }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("EK%d: %s", d.Code(), d.String())
				}
			}
		})
	}
}

// TestCatchHandlerAnnotationIsNotRetired checks that EK2112, the retired typed
// catch clause, stays off a catch expression's handler: its annotation is an
// ordinary parameter type (VIP-5).
func TestCatchHandlerAnnotationIsNotRetired(t *testing.T) {
	source := "error NotFound\neffect function load(): string!NotFound { throw new NotFound() }\nexport effect function main() { return load() catch (e: NotFound) => \"missing\" }"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK2112.Code {
			t.Errorf("EK2112 on a handler annotation: %s", d.MessageText())
		}
	}
}
