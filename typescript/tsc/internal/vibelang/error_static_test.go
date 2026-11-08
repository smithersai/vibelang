package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorStaticMembers(t *testing.T) {
	for _, source := range []string{
		"error E { static x = 1 }",
		"error E { static make() { return 1 } }",
		"error E { static get count() { return 1 } }",
		"error E { static {} }",
		"schema error E { static x = 1 }",
		"schema error E { static make() { return 1 } }",
		"schema error E { static get count() { return 1 } }",
		"schema error E { static {} }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source+"\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError && d.Code() == 1302 {
					return
				}
			}
			t.Fatal("missing EK1302 for user-written static member")
		})
	}
}

func TestErrorStaticMemberQuickFix(t *testing.T) {
	for _, source := range []string{
		"export error E { id: string; static x = 1 }\n",
		"export schema error E { id: string; static x = 1 }\n",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			t.Log(fixed)
			program, file, _, _ := editorProgram(t, fixed+"\nconst id: string = new E({ id: \"x\" }).id; const value: number = E.x;\n")
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s", d.String())
				}
			}
		})
	}
}

func TestErrorStaticMembersOnlyDeclarations(t *testing.T) {
	source := "error E { id: string; get message() { return this.id } }\nschema error S { id: string }\nclass C extends Data.TaggedError(\"C\") { static x = 1 }\nclass D extends Schema.TaggedError<D>()(\"D\", {}) { static x = 1 }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 1302 {
			t.Errorf("valid class: %s", d.String())
		}
	}
}

func TestErrorStaticMemberFixKeepsImplements(t *testing.T) {
	source := "interface Coded { readonly id: string }\nexport error E implements Coded { id: string; static x = 1 }\n"
	fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
	if !strings.Contains(fixed, "implements Coded") {
		t.Fatalf("lost implements clause: %s", fixed)
	}
}

func TestErrorStaticMemberFixPreservesShadowedModules(t *testing.T) {
	for _, source := range []string{
		"const Data = 0; const $ErrorData = 1; export error E { id: string; static x = 1 }\n",
		"const Schema = 0; export schema error E { id: string; static x = 1 }\n",
		"schema error Schema { id: string; static x = 1 }\n",
		"import * as RealSchema from \"effect/Schema\"\nnamespace Schema { export const String = RealSchema.NonEmptyString; export type String = typeof String.Type }\nschema error E { value: Schema.String; static x = 1 }\n",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), fixed)
				}
			}
			if strings.Contains(source, "value: Schema.String") && !strings.Contains(fixed, "value: Schema.String") {
				t.Fatalf("lost user schema reference: %s", fixed)
			}
		})
	}
}
