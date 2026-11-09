package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func computedDirectFormSource(api string, spread int, style string, alias bool) string {
	prefix := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Computed\";value:number};"
	ns := "Effect"
	if alias {
		prefix = "import {Effect as Library} from \"effect\";" + prefix
		ns = "Library"
	}
	callee := ns + "." + api
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
	setup := ""
	call := callee + "(" + args + ")"
	switch spread {
	case 0:
		call = ns + "[\"" + api + "\"](" + args + ")"
	case 1:
		call = ns + "[`" + api + "`](" + args + ")"
	case 2:
		setup = "const key=\"" + api + "\" as const;"
		call = ns + "[key](" + args + ")"
	case 3:
		call = ns + "[(\"" + api + "\")](" + args + ")"
	}
	body := "return try " + call
	switch style {
	case "parenthesized":
		body = "return try (" + call + ")"
	case "nonnull":
		body = "return try (" + call + ")!"
	case "stored":
		body = "const stored=" + call + ";return try stored"
	}
	return prefix + "export effect function f(e:number!Tagged!S,h:(x:Tagged)=>number!!){" + setup + body + "}"
}
func computedDirectFormCode(api string) int32 {
	switch api {
	case "succeed", "fail":
		return 4834
	case "catch", "catchTag", "catchTags":
		return 4835
	}
	return 4836
}
func TestComputedDirectFormAdvisories(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for chain := range 4 {
			for _, alias := range []bool{false, true} {
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/key%d/alias%t/%s", api, chain, alias, style), func(t *testing.T) {

						p, file, _, _ := editorProgram(t, computedDirectFormSource(api, chain, style, alias))
						count := 0
						for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == computedDirectFormCode(api) {
								count++

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

func TestComputedDirectFormsRespectShadows(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for key := range 4 {
			t.Run(fmt.Sprintf("%s/key%d", api, key), func(t *testing.T) {
				source := computedDirectFormSource(api, key, "direct", false)
				source = "import {Effect as Library} from \"effect\";" + strings.Replace(source, "function f(", "function f(Effect:typeof Library,", 1)
				p, file, _, _ := editorProgram(t, source)
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == computedDirectFormCode(api) {
						t.Fatalf("shadow control: %s", d.String())
					}
				}
			})
		}
	}
}
func TestComputedCatchPipelinePreservesCalls(t *testing.T) {
	for _, api := range []string{"catch", "catchTag", "catchTags"} {
		t.Run(api, func(t *testing.T) {
			source := computedDirectFormSource(api, 0, "direct", false)
			source = strings.Replace(source, "return try Effect[\""+api+"\"](e,", "return try (e |> Effect[\""+api+"\"](%,", 1)
			source = strings.TrimSuffix(source, "}") + ")}"
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == 4835 {
					t.Fatalf("pipeline control: %s", d.String())
				}
			}
		})
	}
}
