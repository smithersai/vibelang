package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCommonJSKnownCallRepair(t *testing.T) {
	source := "import { parse } from \"./foreign.cjs\"\nexport function read(value: string): number { return parse(value) }\nexport const number: number = read(\"ok\")\n"
	lib := "/**\n * @param {string} value\n * @returns {number}\n * @throws {RangeError}\n */\nexports.parse = function(value) { if (!value) throw new RangeError(\"empty\"); return value.length }\n"
	p, f, _, _ := editorProgramAt(t, "main.vibe", `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowJs":true,"checkJs":false}`, source, editorPackageJSON, editorPackages)
	dir := filepath.Dir(f.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "foreign.cjs"), []byte(lib), 0600); err != nil {
		t.Fatal(err)
	}
	p = compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: p.Host()})
	f = p.GetSourceFile(f.FileName())
	before := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			if d.Source() != diagnosticSource || d.Code() != 401 {
				t.Fatalf("unexpected: %s", d.String())
			}
			before++
		}
	}
	if before != 1 {
		t.Fatalf("want EK0401, got %d", before)
	}
	result := fixCase(t, dir)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if len(result.Sites) != 0 {
		t.Fatalf("repair refused: %+v", result.Sites)
	}
	fixed := result.Files[f.FileName()]
	if fixed == nil {
		t.Fatal("no repair")
	}
	t.Logf("fixed:\n%s", fixed.Text)
}
