package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-13/29 reserve the member name, independently of member kind or tag type.
func TestErrorReservedNonPayloadMembers(t *testing.T) {
	members := []string{
		"_tag = 1",
		"_tag: \"Bad\" = \"Bad\"",
		"[\"_tag\"] = 1",
		"[tag] = 1",
		"[\"_tag\"]: number = 1",
		"[\"\\u005ftag\"] = 1",
		"_tag() { return 1 }",
		"get _tag(): \"Bad\" { return \"Bad\" }",
		"set _tag(value: string) {}",
		"static _tag = \"Bad\"",
		"static _tag() { return 1 }",
		"static get _tag() { return \"Bad\" }",
		"static set _tag(value: string) {}",
		"\"_tag\"() { return 1 }",
		"[\"_tag\"]() { return 1 }",
		"get [\"_tag\"](): \"Bad\" { return \"Bad\" }",
		"static [\"_tag\"] = \"Bad\"",
		"static set [\"_tag\"](value: string) {}",
		"[tag]() { return 1 }",
		"static get [tag]() { return \"Bad\" }",
	}
	for _, form := range []string{"error", "schema error"} {
		for _, abstract := range []string{"", "abstract "} {
			for i, member := range members {
				t.Run(fmt.Sprintf("%s/%s/%d", form, abstract, i), func(t *testing.T) {
					source := "const tag = \"_tag\" as const\nexport " + abstract + form + " Bad { " + member + " }\n"
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
							if d.Pos() < strings.Index(source, member) {
								t.Errorf("reserved-member error belongs on the member: %s", d.String())
							}
						}
					}
					if count != 1 || len(errors) != 1 {
						t.Fatalf("want one EK2117 on reserved member, got %v", errors)
					}
				})
			}
		}
	}
}

func TestErrorReservedNonPayloadMemberControls(t *testing.T) {
	for _, source := range []string{
		"export error Good { value: number; get label() { return this.value } }",
		"export schema error Good { value: number; get label() { return this.value } }",
		"export error Good { #_tag() { return 1 } }",
		"export schema error Good { #_tag() { return 1 } }",
		"const key = Symbol(); export error Good { [key]() { return 1 } }",
		"const key = Symbol(); export schema error Good { [key]() { return 1 } }",
		"class Ordinary { static _tag = 1; get _tag() { return 1 } }",
		"class Native extends Data.TaggedError(\"Native\") { static _tag = 1 }",
		"class Native extends Schema.TaggedError<Native>()(\"Native\", {}) { static _tag = 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source+"\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 2117 {
					t.Errorf("unrelated source was rejected: %s", d.String())
				}
			}
		})
	}
}

func TestErrorReservedMemberKeepsIndependentErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{"_tag() { return missingValue }", "[\"_tag\"] = missingValue", "[tag] = missingValue"} {
			t.Run(form+"/"+member, func(t *testing.T) {
				source := "const tag = \"_tag\" as const\nexport " + form + " Bad { " + member + " }\n"
				program, file, _, _ := editorProgram(t, source)
				var reserved, unknown bool
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					reserved = reserved || d.Code() == 2117
					unknown = unknown || d.Code() == 2304
				}
				if !reserved || !unknown {
					t.Fatalf("reserved=%v independent unknown name=%v, want both", reserved, unknown)
				}
			})
		}
	}
}

func TestSchemaErrorTeachingKeepsReservedMembers(t *testing.T) {
	for _, member := range []string{
		"static get _tag() { return \"metadata\" }",
		"get _tag(): \"E\" { return \"E\" }",
		"static get label() { return \"metadata\" }",
	} {
		source := "export class E extends Schema.TaggedError<E>()(\"E\", {}) { " + member + " }\n"
		program, file, _, _ := editorProgram(t, source)
		program.GetSemanticDiagnostics(t.Context(), file)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		rewrite := errorClassRewrite(c, file, file.Statements.Nodes[0])
		done()
		if rewrite != nil && len(rewrite.edits) != 0 {
			t.Fatalf("teaching must not introduce a rejected member: %s", source)
		}
	}
}
