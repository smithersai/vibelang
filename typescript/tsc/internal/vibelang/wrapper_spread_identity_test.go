package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestWrapperSpreadIdentity(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, row := range []struct {
			name, object string
			rejected     bool
		}{
			{"copy", "{...Original}", false},
			{"empty-after", "{...Original,...{}}", false},
			{"empty-before", "{...{},...Original}", false},
			{"explicit-before", "{API:Original.API,...{}}", false},
			{"explicit-after", "{...{},API:Original.API}", false},
			{"overwritten-safe", "{...{API:local},...Original}", false},
			{"overwritten-unsafe", "{...Original,...{API:local}}", true},
			{"explicit-safe-last", "{...{API:local},API:Original.API}", false},
			{"explicit-unsafe-last", "{...Original,API:local}", true},
			{"unrelated-after", "{...Original,...{other:local}}", false},
			{"numeric-after", "{...Original,...{0:local}}", false},
			{"computed", "{...{},['API']:Original.API}", false},
			{"nested-copy", "{...{API:Original.API}}", false},
			{"mixed", "{...Original,...(flag?{API:concrete}:{API:Original.API})}", true},
			{"both-safe", "{...(flag?{API:Original.API}:{API:Original.API})}", false},
		} {
			for _, input := range []string{"thunk", "options"} {
				for _, contract := range []string{"RangeError", "never", "builtin"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, row.name, input, contract), func(t *testing.T) {
						tag := contract
						if tag == "builtin" {
							tag = "RangeError"
						}
						lib := "/** @throws {" + tag + "} */\nexport declare function risky():number\n"
						expression := "risky()"
						if contract == "builtin" {
							expression = "JSON.parse(\"1\") as number"
						}
						if api == "tryPromise" {
							expression = "Promise.resolve(" + expression + ")"
						}
						callback := "()=>" + expression
						if input == "options" {
							callback = "{try:" + callback + ",catch:(error:unknown)=>error}"
						}
						valueType := "number"
						if api == "tryPromise" {
							valueType = "Promise<number>"
						}
						concrete := "function concrete(input:(()=>" + valueType + ")|{try:()=>" + valueType + ";catch:(error:unknown)=>unknown}):" + valueType + "{return typeof input===\"function\"?input():input.try()}\n"
						source := "import {Effect as Original} from \"effect\"\nimport {risky} from \"./foreign.js\"\n" +
							"declare const flag:boolean\nfunction local<T>(input:(()=>T)|{try:()=>T;catch:(error:unknown)=>unknown}):T{return typeof input===\"function\"?input():input.try()}\n" +
							concrete + "const api=" + strings.ReplaceAll(row.object, "API", api) + "\nexport const value=api." + api + "(" + callback + ")\n"
						p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": lib})
						var errors []string
						want := 0
						if row.rejected && contract != "never" {
							want = 1
						}
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							errors = append(errors, d.String())
							if want == 0 || d.Source() != diagnosticSource || d.Code() != 401 {
								t.Errorf("unexpected: %s", d.String())
							}
						}
						if len(errors) != want {
							t.Errorf("got %v, want %d EK0401", errors, want)
						}
					})
				}
			}
		}
	}
}

// Generic callable unions retain TypeScript's call-compatibility restriction.
func TestWrapperSpreadGenericUnionNativeError(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		t.Run(api, func(t *testing.T) {
			expression := "safe()"
			if api == "tryPromise" {
				expression = "Promise.resolve(safe())"
			}
			source := "import {Effect as Original} from \"effect\"\nimport {safe} from \"./foreign.js\"\ndeclare const flag:boolean\nfunction local<T>(input:(()=>T)|{try:()=>T;catch:(error:unknown)=>unknown}):T{return typeof input===\"function\"?input():input.try()}\nconst api={...Original,...(flag?{" + api + ":local}:{" + api + ":Original." + api + "})}\nexport const value=api." + api + "(()=>" + expression + ")"
			p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": "/** @throws {never} */\nexport declare function safe():number\n"})
			got := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				got++
				if d.Source() != "" || d.Code() != 2349 {
					t.Errorf("unexpected: %s", d.String())
				}
			}
			if got != 1 {
				t.Errorf("got %d errors, want native TS2349", got)
			}
		})
	}
}
