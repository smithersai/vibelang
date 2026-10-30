package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
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

func TestSchemaTupleFlagMigrationOnlyDeclarations(t *testing.T) {
	for _, source := range []string{
		"const Optional = Schema.optionalKey(Schema.Number)\nexport abstract schema error Parent { id: string; get label() { return this.id } }\nexport schema error Child extends Parent { value: readonly [Optional] }\n",
		"const Optional = Schema.optionalKey(Schema.Number)\n/** Alias */\nexport schema A = readonly [Optional, Optional]\n/** Struct */\nexport schema B { readonly value: readonly [Optional] }\n/** Error */\nexport schema error Problem { id: string; value: readonly [Optional]; get label() { return this.id } }\n",
		"import * as S from \"effect/Schema\"\nconst Optional = S.optionalKey(S.Number)\nconst Schema = 1\nexport schema R = readonly [Optional]\n",
		"const Optional = Schema.optionalKey(Schema.Number)\nnamespace N { const Schema = 1; export schema R = readonly [Optional] }\nexport const R = N.R\n",
	} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		configName := filepath.Join(dir, "tsconfig.json")
		if err := os.WriteFile(configName, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0600); err != nil {
			t.Fatal(err)
		}
		fs := bundled.WrapFS(osvfs.FS())
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatalf("config: %v", errors)
		}
		parsed := &fixParsedFiles{}
		declarations := func(texts map[tspath.RootedFilePath]string) map[string]string {
			program := fixProgram(fs, bundled.LibPath(), config, parsed, texts)
			out := map[string]string{}
			var mutex sync.Mutex
			program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if strings.HasSuffix(name.AsString(), ".d.ts") {
					mutex.Lock()
					out[filepath.Base(name.AsString())] = text
					mutex.Unlock()
				}
				return nil
			}})
			return out
		}
		before := declarations(nil)
		if before["main.d.ts"] == "" {
			t.Fatal("missing baseline declarations")
		}
		result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
		fixed := result.Files[file.FileName()]
		if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
			t.Fatalf("migration failed: %+v", result)
		}
		if after := declarations(map[tspath.RootedFilePath]string{file.FileName(): fixed.Text}); !reflect.DeepEqual(before, after) {
			t.Fatalf("declarations changed:\nbefore %v\nafter %v\n%s", before, after, fixed.Text)
		}
		if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
		again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			t.Fatalf("second migration changed source: %+v", again)
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
