package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestRetainedNestedErrorMigration(t *testing.T) {
	for _, source := range []string{
		"import * as M from \"effect/encoding/Csv\"\n/** KEEP */\nexport function test(s:unknown){return match(s){when M.CsvError:true;when M.CsvError(let e):e===s;default:false;}}\n",
		"\"use client\";\nimport * as M from \"effect/encoding/Csv\"\nconst $legacyError=0;\nnamespace N { /** KEEP */ export function test(s:unknown){return match(s){when M.CsvError(let e):e===s;default:false;}} }\n",
		"import * as M from \"effect/encoding/Csv\"\nexport function test(s:unknown){if(s is M.CsvError(let e)){return e===s;} return false;}\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		p := retainedErrorMigrationFixes(t.Context(), program, file, map[string]bool{})
		if len(p.fixes) != 1 {
			t.Fatalf("want one atomic statement migration, got %d", len(p.fixes))
		}
		fixed := p.text()
		t.Log(fixed)
		if strings.Contains(fixed, "when M.CsvError") || strings.Contains(fixed, "is M.CsvError") || !strings.Contains(fixed, " = M.CsvError;") {
			t.Fatal("did not retain the constructor through a bare local alias")
		}
		if strings.HasPrefix(source, "\"use client\"") && !strings.HasPrefix(fixed, "\"use client\"") {
			t.Fatal("lost directive prologue")
		}
		if strings.Count(fixed, "KEEP") != strings.Count(source, "KEEP") {
			t.Fatal("lost or duplicated JSDoc")
		}
		next, nextFile, _, _ := editorProgram(t, fixed)
		for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed: %s", d.String())
			}
		}
		if again := retainedErrorMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
			t.Fatalf("not idempotent:\n%s", again.text())
		}
	}
}

func TestRetainedNestedErrorMigrationLeavesLocalMatchers(t *testing.T) {
	source := "const M={CsvError: class CsvError {}};\nexport function test(s:unknown){return match(s){when M.CsvError:true;default:false;}}\n"
	program, file, _, _ := editorProgram(t, source)
	if p := retainedErrorMigrationFixes(t.Context(), program, file, map[string]bool{}); len(p.fixes) != 0 {
		t.Fatalf("rewrote a shadowed SDK module:\n%s", p.text())
	}
}

// The preserving rewrite is opt-in, even when the ordinary fixer visits the file.
func TestRetainedNestedErrorMigrationProject(t *testing.T) {
	source := "import * as M from \"effect/encoding/Csv\"\nexport function test(s:unknown){return match(s){when M.CsvError(let e):e===s;default:false;}}\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	configName := filepath.Join(dir, "tsconfig.json")
	configText := "{\"compilerOptions\":{\"target\":\"ESNext\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\"]}"
	if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) > 0 {
		t.Fatalf("config: %v", errors)
	}
	ordinary := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if ordinary.Err != nil || len(ordinary.Files) != 0 {
		t.Fatalf("ordinary fix rewrote a retained guard: %+v", ordinary)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("preserving migration: %+v", result)
	}
	for _, fixed := range result.Files {
		if !strings.Contains(fixed.Text, "= M.CsvError;") || strings.Contains(fixed.Text, "when M.CsvError") {
			t.Fatalf("constructor alias missing: %s", fixed.Text)
		}
		if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("migration is not idempotent: %+v", again)
	}
}
