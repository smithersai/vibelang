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

func TestErrorReservedStaticMemberQuickFix(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{
			"static _tag = \"metadata\"",
			"static get _tag() { return \"metadata\" }",
			"static set _tag(value: string) {}",
			"static [\"_tag\"] = \"metadata\"",
		} {
			t.Run(form+"/"+member, func(t *testing.T) {
				fixed := applyQuickFixOf(t, "export "+form+" E { id: string; "+member+" }\n", 2117, diagnostics.CategoryError)
				if !strings.Contains(fixed, member) || !strings.Contains(fixed, "class E extends") {
					t.Fatalf("static member was not retained: %s", fixed)
				}
				program, file, _, _ := editorProgram(t, fixed+"\nconst id: string = new E({ id: \"x\" }).id;\n")
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid class migration: %s\n%s", d.String(), fixed)
					}
				}
			})
		}
	}
}

func TestErrorReservedStaticMemberFixAvoidsCapture(t *testing.T) {
	source := "const TaggedError = 0; const $ErrorTaggedError = 1; const Data = 2;\nexport error E { value: number; static _tag = \"metadata\" }\n"
	fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed+"\nconst n: number = new E({ value: 1 }).value;\n")
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("migration captured a user name: %s\n%s", d.String(), fixed)
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

func TestErrorReservedAbstractSchemaMemberQuickFix(t *testing.T) {
	source := "export abstract schema error E { id: string; static _tag = \"metadata\" }\n"
	fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("abstract schema migration: %s\n%s", d.String(), fixed)
		}
	}
}
