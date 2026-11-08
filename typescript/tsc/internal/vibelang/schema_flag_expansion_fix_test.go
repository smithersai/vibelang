package vibelang

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaTupleFlagPreservingFix(t *testing.T) {
	for _, source := range []string{
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema R = readonly [Optional]\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema R { readonly items: readonly [Optional] }\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nexport schema error Problem { id: string; value: readonly [Optional]; get label() { return this.id } }\n",
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

func TestSchemaFlagExpansionCommentsAndScope(t *testing.T) {
	for _, source := range []string{
		"const Optional = Schema.optionalKey(Schema.Number)\n/** Alias docs */\nexport schema R = readonly [/* slot docs */ Optional]\n/** Next docs */\nexport const tail = 1\n",
		"import * as S from \"effect/Schema\"\nconst Optional = S.optionalKey(S.Number)\nconst Schema = 1\nexport schema R = readonly [Optional]\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R = readonly [Optional] }\n",
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

func TestSchemaTupleFlagDirectivePrologue(t *testing.T) {
	for _, prefix := range []string{"\"use client\";\n", "\"use strict\"; \"use client\";\n", "#!/usr/bin/env node\n\"use client\";\n", "\ufeff\"use client\";\n"} {
		for _, source := range []string{
			"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R = readonly [Optional] }\n",
			"declare const Optional: import(\"effect/Schema\").optionalKey<import(\"effect/Schema\").Number>\nconst Schema = 1\nexport schema R = readonly [Optional]\n",
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

func TestSchemaTupleFlagDerivedErrorFix(t *testing.T) {
	source := "const Optional=Schema.optionalKey(Schema.Number)\nexport abstract schema error Parent { id: string; get label() { return this.id } }\nexport schema error Child extends Parent { value: readonly [Optional] }\n"
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

func TestSchemaTupleFlagEscapedHelpers(t *testing.T) {
	prefix := "const Optional = Schema.optionalKey(Schema.Number)\n"
	for _, kind := range []string{"holder", "factory", "namespace"} {
		source := prefix
		if kind == "namespace" {
			source += "namespace N { const Schema = 1;\n"
		}
		start := len(source)
		source += "export schema error E { value: readonly [Optional] }\n"
		base := "$codecs" + strconv.Itoa(start)
		if kind == "factory" {
			base = "$makeCodec" + strconv.Itoa(start) + "_0"
		}
		if kind == "namespace" {
			source += "}\n"
			base = "$Schema" + strconv.Itoa(start)
		}
		escaped := strings.Replace(base, "e", "\\u0065", 1)
		source += "const " + escaped + " = 1\n"
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s helper repair reports %s:\n%s", kind, d.String(), fixed)
			}
		}
	}
}
