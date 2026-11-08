package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestStrictAPIAsTry(t *testing.T) {
	for _, api := range []string{"sync", "promise", "try", "tryPromise"} {
		for _, name := range []string{"try", "tryPromise"} {
			for _, style := range []string{"constant", "parameter", "imported"} {
				for _, operand := range []string{"risky()", "JSON.parse(\"1\") as number"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, name, style, operand), func(t *testing.T) {
						expr := operand
						if api == "promise" || api == "tryPromise" {
							expr = "Promise.resolve(" + expr + ")"
						}
						imports := "import {Effect as Original} from \"effect\"\nimport {risky} from \"./foreign.js\"\n"
						source := imports + "const Effect={" + name + ":Original." + api + "}\nexport const value=Effect." + name + "(()=>" + expr + ")"
						if style == "parameter" {
							source = imports + "export function value(Effect:{" + name + ":typeof Original." + api + "}){return Effect." + name + "(()=>" + expr + ")}"
						}
						if style == "imported" {
							source = imports + "import {Alias as Effect} from \"./foreign.js\"\nexport const value=Effect." + name + "(()=>" + expr + ")"
						}
						lib := "import {Effect} from \"effect\"\n/** @throws {RangeError} */\nexport declare function risky():number\nexport declare const Alias:{" + name + ":typeof Effect." + api + "}"
						p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": lib})
						want := 0
						if api == "sync" || api == "promise" {
							want = 1
						}
						got := 0
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() == diagnostics.CategoryError {
								got++
								if d.Source() != diagnosticSource || d.Code() != 401 {
									t.Errorf("unexpected: %s", d.String())
								}
							}
						}
						if got != want {
							t.Errorf("got %d errors, want %d EK0401", got, want)
						}
					})
				}
			}
		}
	}
}

func TestStrictAPIAsTryMixed(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, name := range []string{"try", "tryPromise"} {
			for _, shape := range []string{"strict-first", "admitting-first", "all-admitting"} {
				t.Run(api+"/"+name+"/"+shape, func(t *testing.T) {
					allowed := "Original." + api + "<number>"
					denied := "Original.sync<number>"
					expression := "risky()"
					if api == "tryPromise" {
						denied = "Original.promise<number>"
						expression = "Promise.resolve(risky())"
					}
					choice, want := denied+":"+allowed, 1
					if shape == "admitting-first" {
						choice = allowed + ":" + denied
					}
					if shape == "all-admitting" {
						choice = "Original." + api + "<0>:" + allowed
						expression = "risky() as 0"
						if api == "tryPromise" {
							expression = "Promise.resolve(risky() as 0)"
						}
						want = 0
					}
					source := "import {Effect as Original} from \"effect\"\nimport {flag,risky} from \"./foreign.js\"\nconst Effect={" + name + ":flag?" + choice + "}\nexport const value=Effect." + name + "(()=>" + expression + ")"
					library := "export declare const flag:boolean\n/** @throws {RangeError} */\nexport declare function risky():number"
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
					got := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() == diagnostics.CategoryError {
							got++
							if d.Source() != diagnosticSource || d.Code() != 401 {
								t.Errorf("unexpected: %s", d.String())
							}
						}
					}
					if got != want {
						t.Errorf("got %d errors, want %d EK0401", got, want)
					}
				})
			}
		}
	}
}
