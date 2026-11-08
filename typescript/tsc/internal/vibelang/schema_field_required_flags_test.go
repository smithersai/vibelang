package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaRequiredFieldReferenceFlags(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nconst Alias = Optional\nconst Uncertain = Optional as Schema.Top\nschema Direct { readonly value: Optional }\nschema Aliased { readonly value: Alias }\nschema Nested { readonly child: { readonly value: Optional } }\nschema Wide { readonly value: Uncertain }\nnamespace N { export schema Nested { readonly value: Optional } }\nschema error Outer { readonly nested: { readonly value: Optional } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), "A required schema field") {
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got %d required-field errors, want 6", count)
	}
}

func TestSchemaRequiredFieldReferenceInverseSafety(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nexport const Codec = Schema.Struct({ value: Optional })\nexport type Codec = typeof Codec.Type\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
			t.Fatalf("unsafe schema rewrite: %s", d.String())
		}
	}
}

func TestSchemaRequiredFieldReferenceControls(t *testing.T) {
	source := "const Optional = Schema.optionalKey(Schema.Number)\nconst Required = Schema.Number\nschema Good { readonly value: Required; readonly maybe?: Optional; readonly present: number | undefined; readonly list: Array<number> }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
			t.Fatalf("valid mapped field rejected: %s", d.String())
		}
	}
}

func TestSchemaRequiredFieldExpansionScope(t *testing.T) {
	sources := []string{
		"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R { readonly value: Optional } }\n",
		"declare const Optional: import(\"effect/Schema\").optionalKey<import(\"effect/Schema\").Number>\nconst Schema = 1\nexport schema R { readonly value: Optional }\n",
	}
	for _, prefix := range []string{"\"use client\";\n", "\"use strict\"; \"use client\";\n", "#!/usr/bin/env node\n\"use client\";\n", "\ufeff\"use client\";\n"} {
		for _, source := range sources {
			fixed := applyQuickFixOf(t, prefix+source, EK2109.Code, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s:\n%s", d.String(), fixed)
				}
			}
			if !strings.HasPrefix(fixed, strings.TrimPrefix(strings.TrimRight(prefix, "\n"), "\ufeff")) {
				t.Fatalf("lost directive %q:\n%s", prefix, fixed)
			}
		}
	}
}

func TestSchemaRequiredFieldDerivedErrorFix(t *testing.T) {
	source := "const Optional=Schema.optionalKey(Schema.Number)\nexport abstract schema error Parent { id: string; get label() { return this.id } }\nexport schema error Child extends Parent { readonly value: { readonly item: Optional } }\n"
	fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
	// The legacy inheritance clause needs its separate VIP-13 migration.
	fixed = applyQuickFixOf(t, fixed, 2117, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("derived fix reports %s:\n%s", d.String(), fixed)
		}
	}
}
