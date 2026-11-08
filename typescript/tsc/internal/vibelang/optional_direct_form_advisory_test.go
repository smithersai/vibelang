package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func optionalDirectFormSource(api string, chain int, style string, alias bool) string {
	prefix := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Optional\";value:number};"
	ns := "Effect"
	if alias {
		prefix = "import {Effect as Library} from \"effect\";" + prefix
		ns = "Library"
	}
	callee := ns + "." + api
	switch chain {
	case 0:
		callee += "?."
	case 1:
		callee = ns + "?." + api
	case 2:
		callee = ns + "?." + api + "?."
	}
	args := "1"
	switch api {
	case "catch":
		args = "e,h"
	case "catchTag":
		args = "e,\"Oops\",h"
	case "catchTags":
		args = "e,{Oops:h}"
	case "provide":
		args = "e,Layer.succeed(S,{value:1})"
	case "provideService":
		args = "e,S,{value:1}"
	}
	call := callee + "(" + args + ")"
	body := "return try " + call
	switch style {
	case "parenthesized":
		body = "return try (" + call + ")"
	case "nonnull":
		body = "return try (" + call + ")!"
	case "stored":
		body = "const stored=" + call + ";return try stored"
	}
	return prefix + "export effect function f(e:number!Tagged!S,h:(x:Tagged)=>number!!){" + body + "}"
}
func optionalDirectFormCode(api string) int32 {
	switch api {
	case "succeed", "fail":
		return 4834
	case "catch", "catchTag", "catchTags":
		return 4835
	}
	return 4836
}
func TestOptionalDirectFormAdvisories(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for chain := range 3 {
			for _, alias := range []bool{false, true} {
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/chain%d/alias%t/%s", api, chain, alias, style), func(t *testing.T) {
						p, file, _, _ := editorProgram(t, optionalDirectFormSource(api, chain, style, alias))
						count := 0
						for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == optionalDirectFormCode(api) {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "optional chaining") {
									t.Fatalf("missing optional-call explanation: %s", diagnosticWithNotes(d))
								}
							}
						}
						want := 1
						if style == "stored" {
							want = 0
						}
						if count != want {
							t.Fatalf("want %d advisory, got %d", want, count)
						}
					})
				}
			}
		}
	}
}
