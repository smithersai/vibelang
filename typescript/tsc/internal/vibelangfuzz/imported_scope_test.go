package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"testing"
)

func TestImportedDiagnosticScope(t *testing.T) {
	tooling := currentSpecText(toolingChapter)
	requireQuote(tooling, importedFileScopeQuote)
	requireQuote(tooling, ownFileScopeQuote)
	check := func(name string, kind core.ScriptKind, code int32, category diagnostics.Category, defaults bool, want string) {
		t.Helper()
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name),
		}, "1", kind)
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "scope")
		g := &Gaps{}
		CheckDiagnostics(g, "/project", []*ast.Diagnostic{d}, defaults)
		if want == "" {
			if g.Any() {
				t.Errorf("%s %s: unexpected gaps %+v", name, specCodeName(code), g.found)
			}
		} else if len(g.found) != 1 || g.found[0].key != want {
			t.Errorf("%s %s: gaps %+v, want %s", name, specCodeName(code), g.found, want)
		}
	}
	for code := range Facts().Imported {
		for _, name := range []string{"/project/main.ts", "/project/main.vibe"} {
			// Every imported code is adjustable; an explicit error setting separates
			// file eligibility from the table's error/warning/suggestion/off default.
			check(name, core.ScriptKindTS, code, diagnostics.CategoryError, false, "")
		}
	}
	for _, tc := range []struct {
		code     int32
		category diagnostics.Category
	}{
		{101, diagnostics.CategoryError}, {508, diagnostics.CategoryWarning}, {4701, diagnostics.CategoryError},
	} {
		check("/project/main.vibe", core.ScriptKindTS, tc.code, tc.category, true, "")
		check("/project/main.ts", core.ScriptKindTS, tc.code, tc.category, true, "feature:d266")
	}
	for _, name := range []string{"/project/main.ts", "/project/main.vibe"} {
		check(name, core.ScriptKindTS, 38131, diagnostics.CategoryError, true, "registry:EK38131")
	}
	check("/project/main.ts", core.ScriptKindTS, 3801, diagnostics.CategoryWarning, true, "ek:EK3801")
	check("/project/tsconfig.json", core.ScriptKindJSON, 3006, diagnostics.CategoryError, true, "")
	check("/project/tsconfig.json", core.ScriptKindJSON, 3006, diagnostics.CategoryWarning, true, "config:category:EK3006")
	check("/project/tsconfig.json", core.ScriptKindJSON, 4701, diagnostics.CategoryError, true, "feature:d266")
}
