package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func checkTryOptionsMethod(t *testing.T, source string, want int) {
	t.Helper()
	library := `/** @throws {RangeError} */
export declare function risky():number
/** @throws {RangeError} */
export declare function throwingKey():"try"
`
	p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
	got := 0
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got++
		if d.Source() != diagnosticSource || d.Code() != 401 {
			t.Errorf("unexpected: %s", d.String())
		}
	}
	if got != want {
		t.Errorf("got %d errors, want %d EK0401", got, want)
	}
}

func TestTryOptionsMethods(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, invoke := range []string{"direct", "call", "apply"} {
			for _, spelling := range []string{"identifier", "quoted", "computed", "constant"} {
				for _, site := range []string{"thunk", "catch", "nested", "throw", "async", "key-throws"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, invoke, spelling, site), func(t *testing.T) {
						key, decl := "try", ""
						switch spelling {
						case "quoted":
							key = "\"try\""
						case "computed":
							key = "[\"try\"]"
						case "constant":
							key, decl = "[name]", "const name=\"try\" as const\n"
						}
						body, want, prefix := "risky()", 0, ""
						if site == "catch" {
							body = "1"
							want = 1
						}
						if site == "nested" {
							body = "(()=>risky())()"
							want = 1
						}
						if api == "tryPromise" {
							body = "Promise.resolve(" + body + ")"
						}
						body = "return " + body
						if site == "throw" {
							body = "throw new RangeError()"
							want = 1
						}
						if site == "async" {
							body = "return risky()"
							prefix = "async "
						}
						if site == "key-throws" {
							key = "[\"try\"]"
							key = "[throwingKey()]"
							want = 1
						}
						mapper := "return error"
						if site == "catch" {
							mapper = "return risky()"
						}
						argument := "{" + prefix + key + "(){" + body + "},catch(error:unknown){" + mapper + "}}"
						callee := "Effect." + api
						switch invoke {
						case "call":
							callee += ".call"
							argument = "undefined," + argument
						case "apply":
							callee += ".apply"
							argument = "undefined,[" + argument + "]"
						}
						source := "import {Effect} from \"effect\"\nimport {risky,throwingKey} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + argument + ")"
						checkTryOptionsMethod(t, source, want)
					})
				}
			}
		}
	}
}

func TestTryOptionsMethodScope(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"getter", `export const value=Effect.try({get try(){risky();return ()=>1},catch(error:unknown){return error}})`},
		{"class", `export const value=Effect.try(()=>{class Local {read(){return risky()}};return new Local()})`},
		{"stored", `const options={try(){return risky()},catch(error:unknown){return error}};export const value=Effect.try(options)`},
		{"nested-method", `export const value=Effect.try({try(){const nested={read(){return risky()}};return nested},catch(error:unknown){return error}})`},
		{"generator", `export const value=Effect.try({*try(){yield risky()},catch(error:unknown){return error}})`},
		{"strict-api", `const bridge=Effect.sync;export const value=bridge(function(){return risky()})`},
		{"unrelated-api", `const bridge={try<T>(options:{try:()=>T,catch:(error:unknown)=>unknown}){return options.try()}};export const value=bridge.try({try(){return risky()},catch(error:unknown){return error}})`},
	} {
		t.Run(test.name, func(t *testing.T) {
			checkTryOptionsMethod(t, "import {Effect} from \"effect\"\nimport {risky} from \"./foreign.js\"\n"+test.body, 1)
		})
	}
}
