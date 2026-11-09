package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestDirectTypeArgumentsAdvisory(t *testing.T) {
	for _, api := range []string{"succeed", "fail"} {
		types, value := []string{"number", "unknown", "number | string"}, "1"
		if api == "fail" {
			types, value = []string{"string", "unknown", "string | number"}, "\"no\""
		}
		for _, typ := range types {
			for _, alias := range []bool{false, true} {
				prefix, callee := "", "Effect."+api
				if alias {
					prefix = "import {" + api + " as supplied} from \"effect/Effect\";"
					callee = "supplied"
				}
				call := callee + "<" + typ + ">(" + value + ")"
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/%s/alias=%t/%s", api, typ, alias, style), func(t *testing.T) {
						body := "return try " + call
						switch style {
						case "parenthesized":
							body = "return try (" + call + ")"
						case "nonnull":
							body = "return try " + call + "!"
						case "stored":
							body = "const stored=" + call + ";return try stored"
						}
						program, file, _, _ := editorProgram(t, prefix+"export effect function f(){"+body+"}")
						count := 0
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == 4834 {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "explicit type-argument contract") {
									t.Fatalf("missing written-contract explanation: %s", diagnosticWithNotes(d))
								}
							}
						}
						want := 1
						if style == "stored" {
							want = 0
						}
						if count != want {
							t.Fatalf("want %d EK4834, got %d", want, count)
						}
					})
				}
			}
		}
	}
}
