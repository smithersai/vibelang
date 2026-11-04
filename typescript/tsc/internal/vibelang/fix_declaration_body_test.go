package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeclarationBodyMigration(t *testing.T) {
	for _, pair := range [][2]string{
		{"schema X\n", "schema X {}\n"},
		{"schema as\n", "schema as {}\n"},
		{"schema satisfies\n", "schema satisfies {}\n"},
		{"export schema X;\n", "export schema X {};\n"},
		{"const data=1;type T=number;data as T;\n", "const data=1;type T=number;(data as T);\n"},
		{"const schema=1;type T=number;schema satisfies T;\n", "const schema=1;type T=number;(schema satisfies T);\n"},
		{"const data=1; (data as number);\n", "const data=1; (data as number);\n"},
		{"schema X { value: string }\n", "schema X { value: string }\n"},
	} {
		source := pair[0]
		for range 8 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			edits := declarationBodyEdits(file)
			if len(edits) == 0 {
				break
			}
			source = applyEdits(source, edits)
		}
		if source != pair[1] {
			t.Errorf("migration: got %q; want %q", source, pair[1])
		}
	}
}

// The migration is an identity on the pre-existing compiler and app corpus:
// none of these programs used the accidentally accepted declaration spellings.
func TestDeclarationBodyCorpusIdentity(t *testing.T) {
	count := 0
	for _, root := range []string{"../../../vibelang/cases", "../../../../examples", "../../../../packages"} {
		err := filepath.WalkDir(root, func(name string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				switch entry.Name() {
				// The EK1503 and EK1604 fixtures write missing bodies on purpose.
				case "node_modules", "out", "dist", ".cache", "data-schema-bodies-r6.fail", "data-header-contextual-name.fail", "cov-ch900a-ek1503.fail", "cov-ch900a-ek1604.fail", "schema-declarations-missing-body.fail", "data-declarations-missing-body.fail":
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(name, ".vibe") {
				return nil
			}
			source, err := os.ReadFile(name)
			if err != nil {
				return err
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, string(source), core.ScriptKindTS)
			if edits := declarationBodyEdits(file); len(edits) > 0 {
				t.Errorf("existing program needs explicit migration: %s", name)
			}
			count++
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if count == 0 {
		t.Fatal("compiler/app corpus was not read")
	}
	t.Logf("preserved %d compiler/app programs byte for byte", count)
}

// Run through the project gate, not only the source-edit helper: syntax fixes
// must retain native diagnostic labels and be available in both CLI modes.
func TestFixProjectDeclarationBodies(t *testing.T) {
	for _, migration := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "migration-only"}[migration], func(t *testing.T) {
			source := "\"use client\";\nconst data=1;type T=number;\ndata as T;\ndata satisfies T;\nexport schema Empty\n"
			p, f, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			options := FixOptions{MigrationOnly: migration}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
			fixed := result.Files[f.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
				t.Fatalf("migration failed: %+v", result)
			}
			for _, want := range []string{"(data as T)", "(data satisfies T)", "schema Empty {}"} {
				if !strings.Contains(fixed.Text, want) {
					t.Errorf("missing %q in %s", want, fixed.Text)
				}
			}
			if !strings.HasPrefix(fixed.Text, "\"use client\";") {
				t.Fatalf("directive changed: %s", fixed.Text)
			}
			if fixed.Counts[1005] != 0 || fixed.Counts[1503]+fixed.Counts[1604] != 3 {
				t.Fatalf("syntax rewrites miscounted: %+v", fixed)
			}
			if err := os.WriteFile(f.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("non-idempotent: %+v", again)
			}
		})
	}
}
