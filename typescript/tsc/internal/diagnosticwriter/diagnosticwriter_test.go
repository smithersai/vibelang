package diagnosticwriter

import (
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// plain is text without its color escapes.
func plain(text string) string {
	return strings.TrimSpace(regexp.MustCompile("\x1b\\[[0-9;]*m").ReplaceAllString(text, ""))
}

// The error summary counts each file once, whatever reported its errors: a
// diagnostic from an external source, such as VibeLang's EK codes, and the
// compiler's own diagnostic in one file name the same file.
func TestErrorSummaryCountsEachFileOnce(t *testing.T) {
	t.Parallel()
	parse := func(name, text string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name)}, text, core.ScriptKindTS)
	}
	text := "export function main() {\n  console.log(1)\n  console.log(2)\n}\n"
	a := parse("/p/src/a.vibe", text)
	b := parse("/p/src/b.vibe", text)
	at := func(file *ast.SourceFile, line int) core.TextRange {
		pos := strings.Index(file.Text(), "console.log("+string(rune('0'+line-1))+")")
		return core.NewTextRange(pos, pos+len("console.log"))
	}
	ek := func(file *ast.SourceFile, line int) Diagnostic {
		return WrapASTDiagnostic(ast.NewExternalDiagnostic(file, at(file, line), "EK", diagnostics.CategoryError, 4402, "console.log is a platform API."))
	}
	ts := func(file *ast.SourceFile, line int) Diagnostic {
		return WrapASTDiagnostic(ast.NewDiagnostic(file, at(file, line), diagnostics.Type_0_is_not_assignable_to_type_1, "string", "number"))
	}
	options := &FormattingOptions{CurrentDirectory: tspath.RootedDirectoryPathFromAbsolute("/p"), NewLine: "\n"}
	summary := func(diags ...Diagnostic) string {
		var out strings.Builder
		WriteErrorSummaryText(&out, diags, options)
		return plain(out.String())
	}
	for _, test := range []struct {
		name  string
		diags []Diagnostic
		want  string
	}{
		{"external", []Diagnostic{ek(a, 2), ek(a, 3)}, "Found 2 errors in the same file, starting at: src/a.vibe:2"},
		{"external and compiler", []Diagnostic{ts(a, 3), ek(a, 2)}, "Found 2 errors in the same file, starting at: src/a.vibe:3"},
		{"two files", []Diagnostic{ek(b, 2), ek(a, 2), ek(a, 3), ts(b, 3)}, "Found 4 errors in 2 files.\n\nErrors  Files\n     2  src/a.vibe:2\n     2  src/b.vibe:2"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := summary(test.diags...); got != test.want {
				t.Errorf("summary\n%s\nwant\n%s", got, test.want)
			}
		})
	}
}

// A content-mapped file's diagnostics render against its original text, and
// two of them still name one file.
func TestErrorSummaryCountsAMappedFileOnce(t *testing.T) {
	t.Parallel()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/p/a.ts")}, "export const x = 1\n", core.ScriptKindTS)
	file.SetContentMapperInfo(ast.ContentMapperSourceFileInfo{ContentMapper: "test", OriginalText: "first\nsecond\nthird\n"})
	d := func(pos int) Diagnostic {
		return WrapASTDiagnostic(ast.NewExternalDiagnostic(file, core.NewTextRange(pos, pos+1), "EK", diagnostics.CategoryError, 1, "bad"))
	}
	one, two := d(6), d(13)
	if one.File() != two.File() {
		t.Fatalf("two diagnostics of one file have files %v and %v", one.File(), two.File())
	}
	if lines := one.File().ECMALineMap(); len(lines) != 4 {
		t.Fatalf("line map of the original text %v, want 4 lines", lines)
	}
	var out strings.Builder
	WriteErrorSummaryText(&out, []Diagnostic{one, two}, &FormattingOptions{CurrentDirectory: tspath.RootedDirectoryPathFromAbsolute("/p"), NewLine: "\n"})
	if got, want := plain(out.String()), "Found 2 errors in the same file, starting at: a.ts:2"; got != want {
		t.Fatalf("summary %q, want %q", got, want)
	}
}

// VIP-34's hundred-block codes retain leading zeros in both CLI renderers.
func TestEKCodeLeadingZeros(t *testing.T) {
	for _, tc := range []struct{ source, want string }{{"EK", "EK0103"}, {"other", "other103"}, {"", "TS103"}} {
		d := WrapASTDiagnostic(ast.NewExternalDiagnostic(nil, core.TextRange{}, tc.source, diagnostics.CategoryError, 103, "bad"))
		opts := &FormattingOptions{NewLine: "\n"}
		for _, pretty := range []bool{false, true} {
			var out strings.Builder
			if pretty {
				FormatDiagnosticWithColorAndContext(&out, d, opts)
			} else {
				WriteFormatDiagnostic(&out, d, opts)
			}
			if got := plain(out.String()); !strings.Contains(got, tc.want+":") {
				t.Errorf("pretty=%v: %q, want %s", pretty, got, tc.want)
			}
		}
	}
}
