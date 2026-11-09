package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestComputedTryOptions(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, method := range []string{"direct", "call", "apply"} {
			for _, spelling := range []string{"direct", "quoted", "computed", "parenthesized", "constant", "typed-key", "template", "key-call"} {
				for _, site := range []string{"thunk", "catch", "nested", "throw", "key-throws"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", api, method, spelling, site), func(t *testing.T) {
						key, decl := "try", ""
						switch spelling {
						case "quoted":
							key = "\"try\""
						case "computed":
							key = "[\"try\"]"
						case "parenthesized":
							key = "[(\"try\")]"
						case "constant":
							key, decl = "[name]", "const name=\"try\" as const\n"
						case "typed-key":
							key, decl = "[name]", "declare const name:\"try\"\n"
						case "template":
							key = "[`try`]"
						case "key-call":
							key = "[key()]"
						}
						want := 0
						expression := "risky()"
						if site == "catch" {
							expression = "1"
							want = 1
						}
						if site == "nested" {
							expression = "(()=>risky())()"
							want = 1
						}
						if api == "tryPromise" {
							expression = "Promise.resolve(" + expression + ")"
						}
						callback := "()=>" + expression
						if site == "throw" {
							callback = "()=>{throw new RangeError()}"
							want = 1
						}
						mapper := "(error:unknown)=>error"
						if site == "catch" {
							mapper = "(error:unknown)=>risky()"
						}
						library := "/** @throws {RangeError} */\nexport declare function risky():number\n/** @throws {never} */\nexport declare function key():\"try\""
						if site == "key-throws" {
							key, want = "[throwingKey()]", 1
							library += "\n/** @throws {RangeError} */\nexport declare function throwingKey():\"try\""
						}
						argument := "{" + key + ":" + callback + ",catch:" + mapper + "}"
						callee := "Effect." + api
						switch method {
						case "call":
							callee += ".call"
							argument = "undefined," + argument
						case "apply":
							callee += ".apply"
							argument = "undefined,[" + argument + "]"
						}
						source := "import {Effect} from \"effect\"\nimport {risky,key,throwingKey} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + argument + ")"
						// Every case imports the same fixture names.
						if site != "key-throws" {
							library += "\n/** @throws {RangeError} */\nexport declare function throwingKey():\"try\""
						}
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
					})
				}
			}
		}
	}
}
