package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// VIP-13/29 reserve the payload name even when its type admits the generated tag.
func TestErrorReservedPayloadTag(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, abstract := range []string{"", "abstract "} {
			for i, field := range []string{
				`_tag: "E"`, `_tag: string`, `_tag?: "E"`, `readonly _tag: "E"`,
				`"_tag": "E"`, `'\u005ftag': string`, `_tag: "Other"`, `_tag: number`,
				`_tag: "E" | "Other"`, `_tag: never`, `_tag: unknown`,
			} {
				t.Run(fmt.Sprintf("%s/%s/%d", form, abstract, i), func(t *testing.T) {
					source := "export " + abstract + form + " E { " + field + "; id: string }\n"
					program, file, _, _ := editorProgram(t, source)
					var errors []string
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						errors = append(errors, d.String())
						if d.Code() == 2117 && d.Source() == diagnosticSource {
							count++
							name := strings.Index(source, field) + len(field) - len(strings.TrimPrefix(field, "readonly "))
							if d.Pos() != name {
								t.Errorf("payload diagnostic at %d, want the field name at %d: %s", d.Pos(), name, d.String())
							}
						}
					}
					if count != 1 || len(errors) != 1 {
						t.Fatalf("want one EK2117 for reserved payload, got %v", errors)
					}
				})
			}
		}
	}
}

func TestErrorReservedPayloadTagKeepsIndependentErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, "export "+form+" E { _tag: MissingType; id: string }\n")
		var reserved, unknown bool
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			reserved = reserved || d.Code() == 2117
			unknown = unknown || d.Code() == 2304
		}
		if !reserved || !unknown {
			t.Fatalf("form=%s reserved=%v independent unknown=%v", form, reserved, unknown)
		}
	}
}

func TestErrorReservedPayloadTagsAreEachDiagnosed(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, fields := range []string{`_tag: "E"; _tag: string`, `_tag: MissingType; _tag: "E"`, `_tag: "E"; get _tag(): "E" { return "E" }`} {
			t.Run(form+fields, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, "export "+form+" E { "+fields+" }\n")
				reserved, unknown := 0, false
				var errors []string
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() == 2117 {
						reserved++
						continue
					}
					if d.Code() == 2304 {
						unknown = true
						continue
					}
					errors = append(errors, d.String())
				}
				if reserved != 2 || unknown != strings.Contains(fields, "MissingType") || len(errors) > 0 {
					t.Fatalf("reserved=%d unknown=%v other=%v", reserved, unknown, errors)
				}
			})
		}
	}
}

func TestErrorReservedPayloadTagKeepsNestedTypeErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, "export "+form+" E { _tag: { x: string; x: number } }\n")
		reserved, duplicate := false, false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			reserved = reserved || d.Code() == 2117
			duplicate = duplicate || d.Code() == 2300 || d.Code() == 2717
		}
		if !reserved || !duplicate {
			t.Fatalf("%s reserved=%v independent nested duplicate=%v", form, reserved, duplicate)
		}
	}
}

func TestErrorReservedPayloadTagTriviaName(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, field := range []string{
			"_tag /* key */: string", "_tag: /* type */ string",
			"readonly /* key */ _tag: string", "\\u005ftag: string",
			"\"\\u005ftag\" /* key */: string", "_tag:\u00a0string", "_tag:\ufeffstring",
		} {
			t.Run(form+field, func(t *testing.T) {
				source := "export " + form + " E { " + field + "; id: string }"
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == 2117 {
						found = true
						name := strings.Index(source, field)
						if strings.HasPrefix(field, "readonly") {
							name = strings.Index(source, "_tag")
						}
						if d.Pos() != name {
							t.Errorf("diagnostic at %d, want name at %d: %s", d.Pos(), name, d.String())
						}
					}
				}
				if !found {
					t.Fatal("missing EK2117")
				}
			})
		}
	}
}
