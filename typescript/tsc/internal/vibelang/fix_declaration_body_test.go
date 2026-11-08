package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
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
