package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix A: declaration keywords follow TypeScript contextual type.
// Stock TypeScript 5.9.3 rejects escaped type with TS1260, not escaped names.
func TestVibeLangEscapedDeclarationKeywords(t *testing.T) {
	for _, row := range []struct{ word, format string }{
		{"error", "export %s Entry { value: number }"},
		{"schema", "export %s error Entry { value: number }"},
		{"error", "export schema %s Entry { value: number }"},
		{"schema", "export %s Entry { value: number }"},
		{"service", "export %s Entry { value: number }"},
		{"data", "export %s Entry { EntryValue { value: number } }"},
	} {
		for i, r := range row.word {
			for _, escaped := range []string{fmt.Sprintf("\\u%04x", r), fmt.Sprintf("\\u{%x}", r)} {
				word := row.word[:i] + escaped + row.word[i+1:]
				source := fmt.Sprintf(row.format, word)
				t.Run(source, func(t *testing.T) {
					file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
					ds := file.Diagnostics()
					if len(ds) != 1 || ds[0].Source() != "" || ds[0].Code() != 1260 {
						t.Fatalf("want one native TS1260, got %v", ds)
					}
					if got := source[ds[0].Pos():ds[0].End()]; got != word {
						t.Fatalf("span %q, want escaped keyword %q", got, word)
					}
				})
			}
		}
	}
}

func TestVibeLangEscapedDeclarationKeywordControls(t *testing.T) {
	for _, word := range []string{"error", "schema", "service", "data"} {
		escaped := fmt.Sprintf("\\u%04x", []rune(word)[0]) + word[1:]
		for _, source := range []string{
			"const " + escaped + " = 1; export default " + escaped + " as number",
			"const " + word + " = 1; export default " + escaped + " satisfies number",
		} {
			t.Run(source, func(t *testing.T) {
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("identifier expression rejected: %v", file.Diagnostics())
				}
			})
		}
	}
	for _, source := range []string{`export error \u0045ntry { value: number }`, `export schema error \u{0045}ntry { value: number }`, `export error Entry { value: number }`} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(file.Diagnostics()) != 0 {
			t.Fatalf("name/control rejected: %v", file.Diagnostics())
		}
	}
	// Two independently escaped keyword tokens each own one diagnostic.
	source := `export sc\u0068ema er\u0072or Entry { value: number }`
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if len(file.Diagnostics()) != 2 {
		t.Fatalf("want two keyword errors: %v", file.Diagnostics())
	}
	for _, d := range file.Diagnostics() {
		if d.Code() != 1260 || !strings.Contains(source[d.Pos():d.End()], `\u`) {
			t.Fatal(d.String())
		}
	}
}
