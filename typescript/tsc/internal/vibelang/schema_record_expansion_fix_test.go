package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaRecordFlagPreservingFix(t *testing.T) {
	for _, source := range []string{
		"const Mutable = Schema.mutableKey(Schema.Number)\nexport schema R { readonly items: Readonly<Record<string, Mutable>> }\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema R = Readonly<Record<string, Optional>>\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema R { readonly items: Readonly<Record<string, Optional>> }\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema error Problem { id: string; value: Readonly<Record<string, Optional>>; get label() { return this.id } }\n",
	} {
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && (d.Code() == EK4832.Code || d.Code() == EK4841.Code) {
				t.Errorf("fixed source reports %s:\n%s", d.String(), fixed)
			}
		}
		t.Log(fixed)
	}
}

func TestSchemaRecordFlagExpansionCommentsAndScope(t *testing.T) {
	for _, source := range []string{
		"const Optional = Schema.optionalKey(Schema.Number)\n/** Alias docs */\nexport schema R = Readonly<Record<string, /* slot docs */ Optional>>\n/** Next docs */\nexport const tail = 1\n",
		"import * as S from \"effect/Schema\"\nconst Optional = S.optionalKey(S.Number)\nconst Schema = 1\nexport schema R = Readonly<Record<string, Optional>>\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R = Readonly<Record<string, Optional>> }\n",
	} {
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source reports %s:\n%s", d.String(), fixed)
			}
		}
		for _, comment := range []string{"Alias docs", "slot docs", "Next docs"} {
			if strings.Contains(source, comment) && strings.Count(fixed, comment) != 1 {
				t.Errorf("comment %q was lost or duplicated:\n%s", comment, fixed)
			}
		}
	}
}

func TestSchemaRecordFlagDirectivePrologue(t *testing.T) {
	for _, prefix := range []string{"\"use client\";\n", "\"use strict\"; \"use client\";\n", "#!/usr/bin/env node\n\"use client\";\n", "\ufeff\"use client\";\n"} {
		for _, source := range []string{
			"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R = Readonly<Record<string, Optional>> }\n",
			"declare const Optional: import(\"effect/Schema\").optionalKey<import(\"effect/Schema\").Number>\nconst Schema = 1\nexport schema R = Readonly<Record<string, Optional>>\n",
		} {
			fixed := applyQuickFixOf(t, prefix+source, EK2109.Code, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("directive fix reports %s:\n%s", d.String(), fixed)
				}
			}
			if !strings.HasPrefix(fixed, strings.TrimPrefix(strings.TrimRight(prefix, "\n"), "\ufeff")) {
				t.Fatalf("lost directive prologue %q:\n%s", prefix, fixed)
			}
		}
	}
}

func TestSchemaRecordFlagDerivedErrorFix(t *testing.T) {
	source := "const Optional=Schema.optionalKey(Schema.Number)\nexport abstract schema error Parent { id: string; get label() { return this.id } }\nexport schema error Child extends Parent { value: Readonly<Record<\"a\", Optional>> }\n"
	fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
	// The legacy inheritance clause needs its separate VIP-13 migration.
	fixed = applyQuickFixOf(t, fixed, 2117, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("derived error fix reports %s:\n%s", d.String(), fixed)
		}
	}
}
