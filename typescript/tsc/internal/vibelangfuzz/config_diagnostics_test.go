package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

// Configuration errors have a JSON location (VIP-30); this exception must
// never admit a language diagnostic in an ordinary TypeScript source.
func TestConfigDiagnosticsLocation(t *testing.T) {
	for _, test := range []struct {
		kind     core.ScriptKind
		code     int32
		category diagnostics.Category
		valid    bool
	}{
		{core.ScriptKindJSON, 3006, diagnostics.CategoryError, true},
		{core.ScriptKindJSON, 3007, diagnostics.CategoryError, true},
		{core.ScriptKindJSON, 3009, diagnostics.CategoryWarning, true},
		{core.ScriptKindJSON, 3009, diagnostics.CategoryError, false},
		{core.ScriptKindJSON, 3008, diagnostics.CategoryWarning, false},
		{core.ScriptKindJSON, 4409, diagnostics.CategoryWarning, false},
		{core.ScriptKindTS, 3006, diagnostics.CategoryError, false},
		{core.ScriptKindTS, 3007, diagnostics.CategoryError, false},
		{core.ScriptKindTS, 3009, diagnostics.CategoryWarning, false},
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/input.json", PathKey: "/project/input.json"}, `{"vibe":{}}`, test.kind)
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(1, 7), "EK", test.category, test.code, "configuration test")
		gaps := &Gaps{}
		CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, true)
		if gaps.Any() == test.valid {
			t.Errorf("kind=%v code=%d category=%v valid=%v gaps=%v", test.kind, test.code, test.category, test.valid, gaps.found)
		}
	}
}

func TestConfigDiagnosticChapterCells(t *testing.T) {
	text := "## Appendix B. Diagnostics\n| Code | VIP | Rule | Chapter |\n| --- | --- | --- | --- |\n| `EK3009` | 30 | warning: config | alternative | [Configuration](007-tooling.md#config-files) |\n| `EK4402` | 33 | ordinary error | [Services](005-services.md) |\n## Appendix C\n"
	rows := appendixBChapterRows(text)
	if len(rows) != 2 || rows["3009"].Chapter != "[Configuration](007-tooling.md#config-files)" || rows["3009"].Rule != "warning: config | alternative" || rows["4402"].Chapter != "[Services](005-services.md)" {
		t.Fatalf("wrong header cells: %+v", rows)
	}
}
