package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestProvideTypeArgumentAdvisory(t *testing.T) {
	for _, a := range []string{"number", "unknown", "number | string"} {
		for _, alias := range []bool{false, true} {
			prefix, callee := "", "Effect.provide"
			if alias {
				prefix = "import {provide as supplied} from \"effect/Effect\";"
				callee = "supplied"
			}
			call := callee + "<" + a + ",never,never,never,never,never>(e,Layer.empty)"
			for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
				t.Run(fmt.Sprintf("%s/alias=%t/%s", a, alias, style), func(t *testing.T) {
					body := "return try " + call
					switch style {
					case "parenthesized":
						body = "return try (" + call + ")"
					case "nonnull":
						body = "return try " + call + "!"
					case "stored":
						body = "const stored=" + call + ";return try stored"
					}
					program, file, _, _ := editorProgram(t, prefix+"export effect function f(e:number!!){"+body+"}")
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("invalid fixture: %s", d.String())
						}
						if d.Source() == diagnosticSource && d.Code() == 4836 {
							count++
							if !strings.Contains(diagnosticWithNotes(d), "explicit type-argument contract") {
								t.Fatalf("missing type contract explanation: %s", diagnosticWithNotes(d))
							}
						}
					}
					want := 1
					if style == "stored" {
						want = 0
					}
					if count != want {
						t.Fatalf("want %d EK4836, got %d", want, count)
					}
				})
			}
		}
	}
}
