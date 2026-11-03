package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Will, 2026-10-31: "If you throw in vibelang itself in a sync function
// that's an error." A throw in synchronous code outside effect code is
// EK0401 at the throw, with no EK9203, EK1001, EK2115 or EK4301 beside it for
// the same throw, whatever form the throw takes and wherever the plain code
// stands. Effect code, an async function and a module block report nothing.
func TestThrowOutsideEffectCodeIsEK0401(t *testing.T) {
	throwText := "A 'throw' is not allowed outside effect code: synchronous VibeLang code never throws. Make the function 'effect' (its 'throw' becomes 'Effect.fail'), or move the code to a '.ts' file."
	topText := "A 'throw' is not allowed at the top level of a VibeLang module. Move the code to a '.ts' file, or run it in an 'effect' function."
	for _, test := range []struct {
		name, source string
		want         []string // the message of each diagnostic, in order
	}{
		{"annotated function", "error Bad\nexport function f(x: number): number {\n  if (x < 0) throw new Bad()\n  return x\n}", []string{throwText}},
		{"throw expression", "error Missing\nexport const first = (xs: ReadonlyArray<string>): string => xs[0] ?? throw new Missing()", []string{throwText}},
		{"caught by its own try", "error Bad\nexport function f(x: number): number {\n  try { throw new Bad() } catch { return x }\n}", []string{throwText}},
		{"rethrow in a catch", "error Bad\nexport function f(x: number): number {\n  try { return x } catch (e) { throw e }\n}", []string{throwText}},
		{"constructor", "error Bad\nexport class P {\n  constructor(readonly v: number) { if (v < 0) throw new Bad() }\n}", []string{throwText}},
		{"getter", "error Bad\nexport class P {\n  get v(): number { throw new Bad() }\n}", []string{throwText}},
		{"static block", "error Bad\ndeclare const n: number\nexport class P {\n  static { if (n < 0) throw new Bad() }\n}", []string{throwText}},
		{"field initializer", "error Bad\ndeclare const n: number | undefined\nexport class P {\n  v: number = n ?? throw new Bad()\n}", []string{throwText}},
		{"parameter default of an effect function", "error Bad\ndeclare const n: number | undefined\nexport effect function f(x: number = n ?? throw new Bad()) { return x }", []string{throwText}},
		{"plain generator", "error Bad\nexport function* g(): Generator<number> { throw new Bad() }", []string{throwText}},
		{"plain catch handler", "effect function load(): number!string { throw \"x\" }\nexport effect function f() { return try (load() catch (e) => { throw e }) }", []string{throwText}},
		{"plain arrow in effect code", "error Bad\nexport effect function f() {\n  const g = (x: number): number => { if (x < 0) throw new Bad(); return x }\n  return g(1)\n}", []string{throwText}},
		{"plain callback", "error Bad\nexport const f = (xs: string[]): string[] => xs.map((x): string => { if (x === \"\") throw new Bad(); return x })", []string{throwText}},
		{"top level", "error Bad\ndeclare const n: number\nif (n < 0) throw new Bad()", []string{topText}},
		{"effect function", "error Bad\nexport effect function f(x: number) {\n  if (x < 0) throw new Bad()\n  return x\n}", nil},
		{"effect handler", "effect function load(): number!string { throw \"x\" }\nexport effect function f() { return try (load() catch effect (e) => { throw e }) }", nil},
		{"async function", "export async function f(x: number) {\n  if (x < 0) throw new Error(\"neg\")\n  return x\n}", nil},
		{"module block", "module legacy {\n  export function f(): never { throw new Error(\"ts\") }\n}\nimport { f } from legacy\nexport const g = f", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var got []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == EK0401.Code {
					got = append(got, diagnosticWithNotes(d))
					continue
				}
				switch d.Code() {
				case EK9203.Code, EK1001.Code, EK2115.Code, EK4301.Code, 511:
					t.Errorf("EK%04d reported beside EK0401: %s", d.Code(), diagnosticWithNotes(d))
				}
			}
			if len(got) != len(test.want) {
				t.Fatalf("EK0401 diagnostics:\n%s\nwant %d:\n%s", strings.Join(got, "\n"), len(test.want), strings.Join(test.want, "\n"))
			}
			for i, want := range test.want {
				if !strings.Contains(got[i], want) {
					t.Errorf("EK0401 %d:\n%s\nwant text:\n%s", i, got[i], want)
				}
			}
		})
	}
}
