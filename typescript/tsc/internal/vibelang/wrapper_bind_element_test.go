package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestWrapperBindElementIdentity(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, member := range []string{".bind", "[\"bind\"]", "[key]", "[\"bi\\u006ed\"]"} {
			for _, input := range []string{"thunk", "options"} {
				for _, site := range []string{"thunk", "catch", "nested"} {
					if input == "thunk" && site == "catch" {
						continue
					}
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, member, input, site), func(t *testing.T) {
						expression := "risky()"
						if site == "nested" {
							expression = "(()=>risky())()"
						}
						if site == "catch" {
							expression = "1"
						}
						if api == "tryPromise" {
							expression = "Promise.resolve(" + expression + ")"
						}
						callback := "()=>" + expression
						if input == "options" {
							mapper := "(error:unknown)=>error"
							if site == "catch" {
								mapper = "(error:unknown)=>risky()"
							}
							callback = "{try:" + callback + ",catch:" + mapper + "}"
						}
						source := "import {Effect as Original} from \"effect\"\nimport {risky} from \"./foreign.js\"\nconst key=\"bind\" as const\nconst wrap=Original." + api + member + "(undefined)\nexport const value=wrap(" + callback + ")\n"
						p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": "/** @throws {RangeError} */\nexport declare function risky():number\n"})
						want := 0
						if site != "thunk" {
							want = 1
						}
						got := 0
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							got++
							if want == 0 || d.Source() != diagnosticSource || d.Code() != 401 {
								t.Errorf("unexpected: %s", d.String())
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
