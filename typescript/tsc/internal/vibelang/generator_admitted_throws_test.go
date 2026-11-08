package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const generatorAdmittedLibrary = `/** @throws {RangeError} */
export declare function risky(): number
export type Admitted<T> = {
/** @throws {unknown} */
(): T
}
/** @throws {never} */
export declare function accept<T>(f: Admitted<T>): T
/** @throws {never} @rethrows f */
export declare function invoke<T>(f: () => T): T
`

// A generator body is plain code even when creating its iterator happens
// inside an admitted thunk. Defaults run during the call, before iteration.
func TestGeneratorAdmittedThrowBoundary(t *testing.T) {
	for _, row := range []struct {
		name, body string
		want       int
	}{
		{"foreign-generator", "accept(function* () { yield risky() })", 1},
		{"wrapped-generator", "Effect.try(function* () { yield risky() })", 1},
		{"wrapped-options", "Effect.try({ try: function* () { yield risky() }, catch: (e) => e })", 1},
		{"wrapped-parentheses", "Effect.try((function* () { yield risky() }))", 1},
		{"promise-executor", "new Promise(function* (resolve) { yield risky() })", 1},
		{"caught-wrapper", "(() => { try { return Effect.try(function* () { yield risky() }) } catch { return undefined } })()", 1},
		{"rethrow-call", "Effect.try(function* () { yield invoke(() => risky()) })", 1},
		{"nested-generator", "Effect.try(() => function* () { yield risky() })", 1},
		{"ordinary-generator", "(function* () { yield risky() })", 1},
		{"foreign-plain", "accept(function () { return risky() })", 0},
		{"wrapped-plain", "Effect.try(function () { return risky() })", 0},
		{"foreign-async-generator", "accept(async function* () { yield risky() })", 0},
		{"wrapped-async-generator", "Effect.try(async function* () { yield risky() })", 0},
		{"caught-generator", "accept(function* () { try { yield risky() } catch {} })", 0},
		{"wrapped-caught-generator", "Effect.try(function* () { try { yield risky() } catch {} })", 0},
		{"safe-generator", "accept(function* () { yield 7 })", 0},
		{"wrapped-default", "Effect.try(function* (x = risky()) { yield x })", 0},
		{"foreign-default", "accept(function* (x = risky()) { yield x })", 0},
		{"wrapped-async-default", "Effect.try(async function* (x = risky()) { yield x })", 0},
		{"body-local-wrapper", "Effect.try(function* () { yield Effect.try(() => risky()) })", 0},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { accept, risky, invoke } from \"./lib.js\"\nexport const value = " + row.body
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: generatorAdmittedLibrary})
				for _, d := range p.GetSyntacticDiagnostics(t.Context(), f) {
					t.Errorf("syntax: %s", d.String())
				}
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == 401 {
						got++
						continue
					}
					t.Errorf("unexpected: %s", d.String())
				}
				if got != row.want {
					t.Errorf("EK0401 got %d, want %d", got, row.want)
				}
			})
		}
	}
}
