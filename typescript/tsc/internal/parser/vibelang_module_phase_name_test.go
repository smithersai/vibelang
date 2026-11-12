package parser

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-40: an identifier module specifier names a module declaration of the
// same file. A default import named defer or source from one is an ordinary
// import, as TypeScript reads `import defer from "./text"`; the phase reading
// needs its own `from` after the binding.
func TestVibeLangModuleImportDefaultNamedPhase(t *testing.T) {
	for _, tc := range []struct {
		source string
		phase  ast.Kind
		name   string
	}{
		{"module text { }\nimport defer from text\n", ast.KindUnknown, "defer"},
		{"module text { }\nimport source from text;\n", ast.KindUnknown, "source"},
		{"module text { }\nimport defer, { x } from text\n", ast.KindUnknown, "defer"},
		{"module text { }\nimport defer from from text\n", ast.KindDeferKeyword, "from"},
		{"module text { }\nimport source from from text\n", ast.KindSourceKeyword, "from"},
		{"module text { }\nimport defer * as ns from text\n", ast.KindDeferKeyword, ""},
	} {
		t.Run(tc.source, func(t *testing.T) {
			name := "/main.vibe"
			file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, tc.source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("parse diagnostics: %v", ds)
			}
			var declaration *ast.ImportDeclaration
			for _, s := range file.Statements.Nodes {
				if ast.IsImportDeclaration(s) {
					declaration = s.AsImportDeclaration()
				}
			}
			if declaration == nil || declaration.ImportClause == nil {
				t.Fatal("no import declaration with a clause")
			}
			clause := declaration.ImportClause.AsImportClause()
			if got := ast.Kind(clause.PhaseModifier); got != tc.phase {
				t.Fatalf("phase modifier %v, want %v", got, tc.phase)
			}
			got := ""
			if clause.Name() != nil {
				got = clause.Name().Text()
			}
			if got != tc.name {
				t.Fatalf("default binding %q, want %q", got, tc.name)
			}
			if !IsVibeLangModuleReference(declaration.ModuleSpecifier) {
				t.Fatalf("module specifier %v, want the module reference text", declaration.ModuleSpecifier)
			}
		})
	}
	// `import defer;` and `import source` at the end of the file import the
	// module declaration of that name for its effects; a line break alone
	// keeps TypeScript's phase reading.
	for _, tc := range []struct {
		source string
		module bool
	}{
		{"module defer { }\nimport defer;\n", true},
		{"module source { }\nimport source", true},
		{"module text { }\nimport defer\n* as ns from text\n", false},
	} {
		t.Run(tc.source, func(t *testing.T) {
			name := "/main.vibe"
			file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, tc.source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("parse diagnostics: %v", ds)
			}
			var declaration *ast.ImportDeclaration
			for _, s := range file.Statements.Nodes {
				if ast.IsImportDeclaration(s) {
					declaration = s.AsImportDeclaration()
				}
			}
			if declaration == nil {
				t.Fatal("no import declaration")
			}
			if tc.module {
				if declaration.ImportClause != nil {
					t.Fatalf("module import got a clause: %v", declaration.ImportClause)
				}
				return
			}
			if declaration.ImportClause == nil || ast.Kind(declaration.ImportClause.AsImportClause().PhaseModifier) != ast.KindDeferKeyword {
				t.Fatalf("line break lost the phase reading: %v", declaration.ImportClause)
			}
		})
	}
	// A TypeScript file keeps TypeScript's reading: with no string literal after
	// from, `import defer from x` is a deferred import missing its from.
	name := "/main.ts"
	file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, "import defer from x\n", core.ScriptKindTS)
	if len(file.Diagnostics()) == 0 {
		t.Fatal("TypeScript's phase reading lost its native diagnostic")
	}
}
