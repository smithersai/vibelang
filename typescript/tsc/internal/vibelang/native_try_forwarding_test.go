package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNativeTryForwarding(t *testing.T) {
	check := func(t *testing.T, source string, want int) {
		t.Helper()
		p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{
			"foreign.d.ts": "/** @throws {RangeError} */\nexport declare function risky():number",
		})
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
	}
	for _, api := range []string{"try", "tryPromise"} {
		for _, method := range []string{"call", "apply"} {
			for _, input := range []string{"thunk", "options"} {
				for _, site := range []string{"thunk", "catch", "nested", "throw"} {
					if input == "thunk" && site == "catch" {
						continue
					}
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, method, input, site), func(t *testing.T) {
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
						if site == "throw" {
							callback = "()=>{throw new RangeError()}"
						}
						receiver := "(Effect." + api + "<number>)"
						argument := callback
						if input == "options" {
							receiver = "Effect." + api
							mapper := "(error:unknown)=>error"
							if site == "catch" {
								mapper = "(error:unknown)=>risky()"
							}
							argument = "{try:" + callback + ",catch:" + mapper + "}"
						}
						if method == "apply" {
							argument = "[" + argument + "]"
						}
						source := "import {Effect} from \"effect\"\nimport {risky} from \"./foreign.js\"\nexport const value=" + receiver + "." + method + "(undefined," + argument + ")"
						want := 1
						if site == "thunk" {
							want = 0
						}
						check(t, source, want)
					})
				}
			}
		}
	}
	for _, api := range []string{"sync", "promise"} {
		for _, method := range []string{"call", "apply"} {
			t.Run(api+"/"+method, func(t *testing.T) {
				expression := "risky()"
				if api == "promise" {
					expression = "Promise.resolve(risky())"
				}
				argument := "()=>" + expression
				if method == "apply" {
					argument = "[" + argument + "]"
				}
				check(t, "import {Effect} from \"effect\"\nimport {risky} from \"./foreign.js\"\nexport const value=(Effect."+api+"<number>)."+method+"(undefined,"+argument+")", 1)
			})
		}
	}
}
