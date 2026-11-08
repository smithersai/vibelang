package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func typedCatchAdvisorySource(api, success, style string, alias bool) string {
	prefix := "type Tagged={readonly _tag:\"Oops\"};"
	call := ""
	switch api {
	case "catch":
		call = "Effect.catch<number,Tagged,never," + success + ",never,never>(e,h)"
	case "catchTag":
		call = "Effect.catchTag<number,Tagged,never,\"Oops\",never,never," + success + ">(e,\"Oops\",h)"
	case "catchTags":
		call = "Effect.catchTags<never,Tagged,number,{Oops:(x:Tagged)=>(" + success + ")!!}>(e,{Oops:h})"
	}
	if alias {
		prefix = "import {" + api + " as supplied} from \"effect/Effect\";" + prefix
		call = strings.Replace(call, "Effect."+api, "supplied", 1)
	}
	body := "return try " + call
	switch style {
	case "parenthesized":
		body = "return try (" + call + ")"
	case "nonnull":
		body = "return try " + call + "!"
	case "stored":
		body = "const stored=" + call + ";return try stored"
	case "pipeline":
		body = "return try (e |> " + strings.Replace(call, "(e,", "(%,", 1) + ")"
	}
	return prefix + "export effect function f(e:number!Tagged,h:(x:Tagged)=>number!!){" + body + "}"
}

func TestCatchTypeArgumentsAdvisory(t *testing.T) {
	for _, api := range []string{"catch", "catchTag", "catchTags"} {
		for _, success := range []string{"number", "unknown", "number | string"} {
			for _, alias := range []bool{false, true} {
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/%s/alias=%t/%s", api, success, alias, style), func(t *testing.T) {
						program, file, _, _ := editorProgram(t, typedCatchAdvisorySource(api, success, style, alias))
						count := 0
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == 4835 {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "explicit type arguments") {
									t.Fatalf("missing contract explanation: %s", diagnosticWithNotes(d))
								}
							}
						}
						want := 1
						if style == "stored" {
							want = 0
						}
						if count != want {
							t.Fatalf("want %d EK4835, got %d", want, count)
						}
					})
				}
			}
		}
	}
}

func TestCatchRenamedExportAdvisory(t *testing.T) {
	for _, typed := range []bool{false, true} {
		for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
			t.Run(fmt.Sprintf("typed%t/%s", typed, style), func(t *testing.T) {
				source := typedCatchAdvisorySource("catch", "unknown", style, true)
				if !typed {
					source = strings.Replace(source, "supplied<number,Tagged,never,unknown,never,never>", "supplied", 1)
				}
				p, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid fixture: %s", d.String())
					}
					if d.Source() == diagnosticSource && d.Code() == 4835 {
						count++
					}
				}
				want := 1
				if style == "stored" {
					want = 0
				}
				if count != want {
					t.Fatalf("want %d EK4835, got %d", want, count)
				}
			})
		}
	}
}
