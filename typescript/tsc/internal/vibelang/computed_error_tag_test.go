package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestComputedErrorPayloadTagDiagnostics(t *testing.T) {
	check := func(t *testing.T, source string, missingType bool) {
		t.Helper()
		program, file, _, _ := editorProgram(t, source)
		errors := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
		foundTag, foundMissing := 0, false
		for _, d := range errors {
			if d.Source() == diagnosticSource && d.Code() == EK2117.Code {
				foundTag++
			}
			if d.Code() == 2304 {
				foundMissing = true
			}
			if d.Code() == 2509 {
				t.Errorf("leaked generated base-type failure: %s", d.String())
			}
		}
		if foundTag != 1 {
			t.Errorf("want one EK2117, got %d: %s", foundTag, source)
		}
		if missingType && !foundMissing {
			t.Errorf("lost independent missing-type diagnostic: %s", source)
		}
	}
	for _, kind := range []string{"error", "schema error", "abstract error"} {
		if kind != "abstract error" {
			t.Run(kind+"/ordinary control", func(t *testing.T) {
				check(t, kind+" Forbidden { _tag: \"Other\" }\n", false)
			})
		}
		for _, field := range []string{"[\"_tag\"]", "[tagKey]"} {
			for _, payload := range []string{"\"Other\"", "\"Forbidden\"", "string"} {
				t.Run(kind+"/"+field+"/"+payload, func(t *testing.T) {
					check(t, "const tagKey = \"_tag\" as const\n"+kind+" Forbidden { "+field+": "+payload+" }\n", false)
				})
			}
		}
		if kind != "abstract error" {
			t.Run(kind+"/symbol description is not a string key", func(t *testing.T) {
				program, file, _, _ := editorProgram(t, "const key = Symbol(\"_tag\")\n"+kind+" Safe { [key]: number }\nconst value: number = new Safe({ [key]: 1 })[key]\n")
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("symbol keys cannot override the string tag: %s%d: %s", d.Source(), d.Code(), d.String())
					}
				}
			})
		}
	}
	for _, field := range []string{"[\"_tag\"]", "[tagKey]"} {
		t.Run("independent-type/"+field, func(t *testing.T) {
			check(t, "const tagKey = \"_tag\" as const\nerror Forbidden { "+field+": \"Other\"; field: MissingPayloadType }\n", true)
		})
	}
}
