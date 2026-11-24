package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The checker runs the schema-modifier filter on every file, TypeScript and
// library files included. Where it can drop nothing it returns the slice it
// was given, without walking the file or parsing a schema body (#455).
func TestSchemaModifierFilterKeepsUnrelatedDiagnostics(t *testing.T) {
	for _, tc := range []struct{ name, code string }{
		{"/a.ts", "interface A { readonly readonly a: string }"},
		{"/a.vibe", "schema A { a: string }\nconst x: number = 1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(tc.name), PathKey: tspath.PathKey(tc.name)}, tc.code, core.ScriptKindTS)
			all := []*ast.Diagnostic{ast.NewDiagnostic(file, core.NewTextRange(0, 1), diagnostics.Cannot_find_name_0, "x")}
			if tc.name == "/a.ts" {
				all = append(all, ast.NewDiagnostic(file, core.NewTextRange(14, 22), diagnostics.X_0_modifier_already_seen, "readonly"))
			}
			// A nil checker: the filter must not need one to keep these.
			got := filterSchemaTypeMemberModifierDiagnostics(nil, file, all)
			if len(got) != len(all) || &got[0] != &all[0] {
				t.Fatalf("filter returned a new slice %v for %v", got, all)
			}
		})
	}
}
