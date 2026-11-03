package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// parseByName parses source with the script kind its file name selects, as
// the program does.
func parseByName(name string, source string) *ast.SourceFile {
	kind := core.GetScriptKindFromFileName(tspath.RootedFilePathFromAbsolute(name))
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name)}, source, kind)
}

// VIP-39: a .vibex file is VibeLang read as .tsx (ScriptKindTSX, so the JSX
// language variant), with every VibeLang hook on.
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#d4ce11ce87592ed3
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#f0d79f16ef52c2d3
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#bd3ce56e08b34d94
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#e231dfdbbf588c68
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#e9e85afa59d96dc3
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#534503077346cdc6
// VIP-39 file kind and ordinary TSX parsing: docs/design/vips/0039-vibex.md#a61bc18e5a967663
func TestVibexFileKind(t *testing.T) {
	t.Parallel()
	if kind := core.GetScriptKindFromFileName(tspath.RootedFilePathFromAbsolute("/a.vibex")); kind != core.ScriptKindTSX {
		t.Fatalf("/a.vibex script kind = %v, want ScriptKindTSX", kind)
	}
	const source = "const el = <p>{x |> f(%)}</p>"
	file := parseByName("/a.vibex", source)
	if file.LanguageVariant != core.LanguageVariantJSX {
		t.Fatalf("/a.vibex language variant = %v, want JSX", file.LanguageVariant)
	}
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("/a.vibex: unexpected diagnostics %v", ds)
	}
	element := file.Statements.Nodes[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
	if element.Kind != ast.KindJsxElement {
		t.Fatalf("initializer = %v, want JsxElement", element.Kind)
	}
	children := element.AsJsxElement().Children.Nodes
	if len(children) != 1 || children[0].Kind != ast.KindJsxExpression {
		t.Fatalf("children = %v, want one JsxExpression", children)
	}
	pipe := children[0].Expression()
	if pipe == nil || pipe.Kind != ast.KindBinaryExpression || pipe.Flags&ast.NodeFlagsVibeLang == 0 || pipe.AsBinaryExpression().OperatorToken.Kind != ast.KindBarToken {
		t.Fatalf("container expression is not a VibeLang pipe: %v", pipe)
	}

	// The same text in .vibe is not JSX: < starts a type assertion or a comparison.
	if ds := parseByName("/a.vibe", source).Diagnostics(); len(ds) == 0 {
		t.Fatal("/a.vibe: want TypeScript syntax errors for JSX text, got none")
	}
	// In .tsx it is JSX without VibeLang: |> is not an operator.
	if ds := parseByName("/a.tsx", source).Diagnostics(); len(ds) == 0 {
		t.Fatal("/a.tsx: want TypeScript syntax errors for |>, got none")
	}
}

// ParseVibeLangSyntax reads a file with the kind its name selects, so the
// syntax walk of a .vibex sees JSX.
func TestVibexParseVibeLangSyntaxUsesFileKind(t *testing.T) {
	t.Parallel()
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/a.vibex", PathKey: "/a.vibex"}, "const el = <p>{x |> f(%)}</p>")
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("unexpected diagnostics %v", ds)
	}
	if file.LanguageVariant != core.LanguageVariantJSX {
		t.Fatalf("language variant = %v, want JSX", file.LanguageVariant)
	}
}

// VIP-30: every source .vibe is a module; so is every .vibex.
func TestVibexIsModule(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"/a.vibe", "/a.vibex"} {
		file := parseByName(name, "const x = 1")
		if file.ExternalModuleIndicator == nil {
			t.Errorf("%s: no external module indicator", name)
		}
	}
}
