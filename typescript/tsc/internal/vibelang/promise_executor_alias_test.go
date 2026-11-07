package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestPromiseExecutorReferences(t *testing.T) {
	const library = "/** @throws {RangeError} */\nexport declare function risky(): number\n/** @throws {RangeError} */\nexport declare function executor(resolve: (value: number) => void): void\n"
	for _, ref := range []struct{ name, setup, constructor string }{
		{"direct", "", "Promise"},
		{"parenthesized", "", "(Promise)"},
		{"global", "", "globalThis.Promise"},
		{"computed", "", "globalThis[\"Promise\"]"},
		{"alias", "const P = Promise\n", "P"},
		{"typed-alias", "const P: PromiseConstructor = Promise\n", "P"},
		{"holder", "const holder = { P: Promise }\n", "holder.P"},
		{"subclass", "", "super"},
	} {
		for _, callback := range []struct {
			name, text string
			reject     bool
		}{
			{"arrow", "resolve => resolve(risky())", false},
			{"function", "function(resolve) { resolve(risky()) }", false},
			{"foreign", "executor", false},
			{"nested", "resolve => { const nested = () => risky(); resolve(1) }", true},
			{"throw", "resolve => { throw 7 }", true},
			{"generator", "function*(resolve) { risky(); resolve(1) }", true},
		} {
			t.Run(ref.name+"/"+callback.name, func(t *testing.T) {
				expression := "new " + ref.constructor + "<number>(" + callback.text + ")"
				source := "export function f() { return " + expression + " }"
				if ref.name == "subclass" {
					source = "export class P extends Promise<number> { constructor() { super(" + callback.text + ") } }"
				}
				source = "import { risky, executor } from './lib.js'\n" + ref.setup + source
				program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": library})
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					count++
					if !callback.reject || d.Code() != 401 || d.Source() != diagnosticSource {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
					if callback.name != "throw" && !strings.Contains(d.String(), "RangeError") {
						t.Errorf("lost thrown contract: %s", d.String())
					}
				}
				want := 0
				if callback.reject {
					want = 1
				}
				if count != want {
					t.Errorf("got %d errors, want %d", count, want)
				}
			})
		}
	}
}

func TestPromiseExecutorDoesNotAdmitUserConstructors(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		source := "import { risky } from './lib.js'\n"
		library := "/** @throws {RangeError} */\nexport declare function risky(): number\n"
		constructor := "class Promise<T> { constructor(executor: (resolve: (value: T) => void) => void) {} }\n"
		if foreign {
			library += "export declare class Promise<T> { constructor(executor: (resolve: (value: T) => void) => void) }\n"
			source = "import { risky, Promise } from './lib.js'\n"
		} else {
			source += constructor
		}
		source += "export function f() { return new Promise<number>(resolve => resolve(risky())) }"
		program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": library})
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			count++
			if d.Code() != 401 || d.Source() != diagnosticSource {
				t.Errorf("foreign=%t unexpected diagnostic: %s", foreign, d.String())
			}
		}
		if count != 1 {
			t.Errorf("foreign=%t got %d errors, want 1", foreign, count)
		}
	}
}
