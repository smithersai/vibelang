package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestErrorStaticMemberFixPreservesReferences(t *testing.T) {
	for _, declaration := range []struct {
		name, shadow, field string
	}{
		{"error", "Data", "GlobalId"},
		{"schema error", "Schema", "GlobalSchema"},
	} {
		for _, prefix := range []struct {
			name, before, directive string
		}{
			{"reference", "", ""},
			{"shebang", "#!/usr/bin/env node\n", ""},
			{"bom-directive", "\ufeff", "\"use strict\";\n"},
		} {
			t.Run(declaration.name+"/"+prefix.name, func(t *testing.T) {
				source := prefix.before + "/// <reference path=\"./globals.d.ts\" />\n" + prefix.directive +
					"const " + declaration.shadow + " = 0\nexport " + declaration.name + " E { id: " + declaration.field + "; static x = 1 }\n" +
					"const id: GlobalId = new E({ id: \"x\" }).id\nconst value: number = E.x\n"
				_, file, _, _ := editorProgram(t, source)
				dir := filepath.Dir(file.FileName().AsString())
				globals := "type GlobalId = string\ndeclare const GlobalSchema: typeof import(\"effect/Schema\").String\n"
				if err := os.WriteFile(filepath.Join(dir, "globals.d.ts"), []byte(globals), 0600); err != nil {
					t.Fatal(err)
				}
				fs := bundled.WrapFS(osvfs.FS())
				config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 {
					t.Fatal(errors)
				}
				check := func(allowStatic bool) {
					t.Helper()
					program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(bundled.WrapFS(osvfs.FS()), bundled.LibPath(), nil, nil, nil)})
					checked := program.GetSourceFile(file.FileName())
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), checked), program.GetSemanticDiagnostics(t.Context(), checked)...) {
						if d.Category() == diagnostics.CategoryError && !(allowStatic && d.Code() == 1302) {
							t.Fatalf("unexpected compiler error: %s", d.String())
						}
					}
				}
				check(true)
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
				fixed := result.Files[file.FileName()]
				if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[1302] == 0 {
					t.Fatalf("reference-preserving migration failed: error %v, refused %v, fixed %+v", result.Err, result.Refused, fixed)
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				check(false)
			})
		}
	}
}
