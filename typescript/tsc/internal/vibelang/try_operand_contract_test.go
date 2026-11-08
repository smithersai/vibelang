package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const tryOperandLibrary = `import type { Effect } from "effect"
/** @throws {Error} */
export declare function tagged<T>(): T
/** @throws {Error} */
export declare function constrained<T extends Effect.Effect<number>>(): T
/** @throws {Error} */
export declare function partial<T extends Effect.Effect<number> | number>(): T
/** @throws {Error} */
export declare function effectful(): Effect.Effect<number>
/** @throws {Error} */
export declare function loose(): any
export declare function untagged<T>(): T
`

// A try operand keeps its callee's thrown contract. Chapter 3 classifies a
// generic signature as effectful before type-argument substitution, through
// its constraints, and counts any as not effectful, so a foreign generic
// instantiated to an Effect is EK0403 whether or not try runs its result.
func TestTryOperandKeepsCalleeContract(t *testing.T) {
	for _, row := range []struct {
		name, body string
		want       int
	}{
		{"generic-tagged", "return try tagged<Effect.Effect<number>>()", 1},
		{"generic-tagged-parenthesized", "return try (tagged<Effect.Effect<number>>())", 1},
		{"generic-tagged-binding", "const v = try tagged<Effect.Effect<number>>(); return v", 1},
		{"generic-tagged-not-run", "const v = tagged<Effect.Effect<number>>(); return try v", 1},
		{"generic-untagged", "return try untagged<Effect.Effect<number>>()", 1},
		{"generic-partial-constraint", "return try partial<Effect.Effect<number>>()", 1},
		{"any", "return try loose()", 1},
		{"generic-constrained", "return try constrained<Effect.Effect<number>>()", 0},
		{"effectful", "return try effectful()", 0},
		{"effect-method-generic", "return try Effect.succeed(1).pipe(Effect.map((x) => x + 1))", 0},
		{"vibe-generic", "return try pick(Effect.succeed(1))", 0},
		{"wrapped", "return try (try Effect.try(() => tagged<Effect.Effect<number>>()))", 0},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { tagged, constrained, partial, effectful, loose, untagged } from \"./lib.js\"\n" +
					"function pick<T>(x: T): T { return x }\n" +
					"export effect function f() { " + row.body + " }\n"
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: tryOperandLibrary})
				for _, d := range p.GetSyntacticDiagnostics(t.Context(), f) {
					t.Errorf("syntax: %s", d.String())
				}
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == 403 {
						got++
						continue
					}
					t.Errorf("unexpected: %s", d.String())
				}
				if got != row.want {
					t.Errorf("EK0403 got %d, want %d", got, row.want)
				}
			})
		}
	}
}
