package vibelangfuzz

import (
	"strings"
	"testing"
)

const generatorParameterActivationQuote = "A function literal passed where the parameter's function type admits throws, as the thunks of `Effect.try` and `Effect.tryPromise` and the `Promise` executor do, or passed to a `@rethrows` parameter, may contain calls known to throw: they belong to the enclosing call."

func TestGeneratorParameterActivationQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), generatorParameterActivationQuote) {
		t.Fatalf("callback activation rule changed: %q", generatorParameterActivationQuote)
	}
}

func failuresGeneratorParameterCases() []*failCase {
	const lib = `/** @throws {RangeError} */
export declare function risky():number
/** @throws {never} */
export declare function safe():number
export declare function unknownCall():number
/** @throws {never} @rethrows callback */
export declare function invoke<T>(callback:()=>T):T
`
	var cases []*failCase
	for _, kind := range []struct{ key, prefix string }{{"sync", "function*"}, {"async", "async function*"}} {
		for _, source := range []struct{ key, name string }{{"range", "risky"}, {"never", "safe"}, {"unknown", "unknownCall"}} {
			for _, context := range []string{"caught", "wrapped", "plain", "effect"} {
				host, code := "plain", 0
				call := "invoke(" + kind.prefix + "(x=" + source.name + "()){yield x})"
				body := call
				switch context {
				case "caught":
					body = "try{return " + call + "}catch{return undefined}"
				case "wrapped":
					host = "effect"
					body = "try Effect.try(()=>" + call + ")"
				case "effect":
					host = "effect"
					if source.key == "range" {
						body = strings.Replace(call, "invoke", "⟦invoke⟧", 1)
						code = 403
					}
				case "plain":
					if source.key == "range" {
						body = strings.Replace(call, "invoke", "⟦invoke⟧", 1)
						code = 401
					}
				}
				cases = append(cases, &failCase{Name: "generator-parameter-" + kind.key + "-" + source.key + "-" + context, Quote: generatorParameterActivationQuote, VIP: 4, Host: host, Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	return cases
}
