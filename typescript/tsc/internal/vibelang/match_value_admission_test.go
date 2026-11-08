package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestPatternValueAdmissionDiagnostics(t *testing.T) {
	for _, value := range []string{"p", "holder.p", "holder[\"p\"]"} {
		for _, typ := range []string{"object", "Function", "unknown", "any", "{}"} {
			for _, form := range []string{"match", "is", "extract"} {
				t.Run(typ+"/"+value+"/"+form, func(t *testing.T) {
					source := "declare const p: " + typ + "; declare const holder: {p: " + typ + "}; export function f(s:unknown){ return "
					switch form {
					case "match":
						source += "match(s){when " + value + ":1;default:0;}"
					case "is":
						source += "s is " + value
					case "extract":
						source += "match(s){when " + value + "(let x):x;default:0;}"
					}
					source += "}"
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							if d.Code() != 702 {
								t.Errorf("unexpected: %s", d.String())
							}
							count++
						}
					}
					if count != 1 {
						t.Fatalf("want exactly one EK0702, got %d", count)
					}
				})
			}
		}
	}
}

func TestPatternValueAdmissionUnresolved(t *testing.T) {
	for _, value := range []string{"missing", `missing["p"]`, "missing.p"} {
		program, file, _, _ := editorProgram(t, "export function f(s:unknown){return s is "+value+"}")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 702 {
				t.Errorf("extra EK0702: %s", d.String())
			}
			if d.Code() == 2304 {
				found = true
			}
		}
		if !found {
			t.Fatal("missing native unresolved-name diagnostic")
		}
	}
}
