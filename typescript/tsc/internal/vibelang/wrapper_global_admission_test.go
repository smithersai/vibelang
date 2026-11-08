package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const wrapperGlobalLibrary = `/** @throws {RangeError} */
export declare function risky(): number
/** @throws {TypeError} */
export declare function later(): Promise<number>
`

// The thunk of Effect.try and tryPromise admits calls known to throw in
// either spelling of the wrapper, Effect.tryPromise or the VIP-6 global
// tryPromise; promise and sync admit only never, and a function nested in
// the thunk is its own plain code.
func TestWrapperGlobalThunkAdmission(t *testing.T) {
	for _, row := range []struct {
		name, body string
		want       int
	}{
		{"global-trypromise", "tryPromise(() => later())", 0},
		{"global-trypromise-options", "tryPromise({ try: () => later(), catch: (e) => e })", 0},
		{"global-trypromise-sync-call", "tryPromise(() => Promise.resolve(risky()))", 0},
		{"global-trypromise-import", "tryPromise(() => import(String(risky())))", 0},
		{"global-trypromise-parenthesized", "tryPromise((() => later()))", 0},
		{"global-trypromise-function", "tryPromise(function () { return later() })", 0},
		{"qualified-trypromise", "Effect.tryPromise(() => later())", 0},
		{"qualified-trypromise-parenthesized", "Effect.tryPromise((() => later()))", 0},
		{"qualified-try-parenthesized", "Effect.try((() => risky()))", 0},
		{"qualified-trypromise-options", "Effect.tryPromise({ try: () => later(), catch: (e) => e })", 0},
		{"qualified-try", "Effect.try(() => risky())", 0},
		{"global-promise", "promise(() => later())", 1},
		{"global-sync", "sync(() => risky())", 1},
		{"qualified-sync", "Effect.sync(() => risky())", 1},
		{"global-trypromise-nested-literal", "tryPromise(() => { const f = () => risky(); return later() })", 1},
		{"global-trypromise-shadowed", "((tryPromise: (f: () => Promise<number>) => number) => tryPromise(() => later()))(() => 1)", 1},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { risky, later } from \"./lib.js\"\nexport const value = " + row.body
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: wrapperGlobalLibrary})
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
