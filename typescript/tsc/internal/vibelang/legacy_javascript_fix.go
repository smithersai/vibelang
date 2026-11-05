package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK0107.Code},
		GetCodeActions: legacyJavaScriptActions,
	})
}

// VIP-40 gives a closed native module its TypeScript semantics. Keep the entire
// lexical scope together: replacing var or extracting a direct eval alone can
// change hoisting, captured cells and the names visible to evaluated code.
func legacyJavaScriptActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: file.FileName(), PathKey: file.PathKey()}, file.Text())
	if len(forms) != 0 || strings.HasPrefix(file.Text(), "#!") {
		return nil, nil
	}
	native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "legacy.ts", PathKey: "legacy.ts"}, file.Text(), core.ScriptKindTS)
	if len(native.Diagnostics()) != 0 {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	safe, hasDefault := true, false
	var emptyWith *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if !safe {
			return true
		}
		switch n.Kind {
		case ast.KindImportDeclaration, ast.KindImportEqualsDeclaration, ast.KindImportKeyword,
			ast.KindMetaProperty, ast.KindDecorator, ast.KindAwaitExpression, ast.KindThisKeyword:
			safe = false
			return true
		case ast.KindExportDeclaration:
			if n.ModuleSpecifier() != nil || n.AsExportDeclaration().IsTypeOnly {
				safe = false
				return true
			}
		case ast.KindExportSpecifier:
			if n.AsExportSpecifier().IsTypeOnly {
				safe = false
				return true
			}
			if n.Name().Text() == "default" {
				hasDefault = true
			}
		case ast.KindExportAssignment:
			if n.AsExportAssignment().IsExportEquals {
				safe = false
				return true
			}
			hasDefault = true
		case ast.KindWithStatement:
			w := n.AsWithStatement()
			object := ast.SkipParentheses(w.Expression)
			if object.Kind != ast.KindObjectLiteralExpression || len(object.AsObjectLiteralExpression().Properties.Nodes) != 0 ||
				w.Statement.Kind != ast.KindBlock || len(w.Statement.AsBlock().Statements.Nodes) != 0 ||
				n.Pos() > fix.Span.Pos() || n.End() < fix.Span.End() ||
				strings.Contains(nodeText(file, n), "/*") || strings.Contains(nodeText(file, n), "//") {
				safe = false
				return true
			}
			emptyWith = n
		}
		if ast.HasSyntacticModifier(n, ast.ModifierFlagsDefault) {
			hasDefault = true
		}
		if ast.IsIdentifier(n) && n.Parent != nil {
			parent := n.Parent
			if ast.IsDeclarationName(n) && parent.Kind != ast.KindShorthandPropertyAssignment ||
				ast.IsRightSideOfQualifiedNameOrPropertyAccess(n) ||
				parent.Kind == ast.KindPropertyAssignment && parent.Name() == n {
				return n.ForEachChild(visit)
			}
			symbol := c.GetSymbolAtLocation(n)
			if parent.Kind == ast.KindShorthandPropertyAssignment {
				symbol = c.GetShorthandAssignmentValueSymbol(parent)
			}
			if symbol == nil {
				safe = false
				return true
			}
			if len(symbol.Declarations()) == 0 && n.Text() != "arguments" && n.Text() != "undefined" && n.Text() != "NaN" && n.Text() != "Infinity" {
				safe = false
				return true
			}
			for _, declaration := range symbol.Declarations() {
				source := ast.GetSourceFileOfNode(declaration)
				if source != file && (source == nil || !fix.Program.IsSourceFileDefaultLibrary(source.PathKey())) {
					safe = false
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !safe {
		return nil, nil
	}
	if emptyWith != nil {
		// There are no property reads or observable object construction here.
		// Keep an empty block's completion rather than inventing a value.
		return []*ls.CodeAction{{Description: "Write an empty block instead of with", Changes: replaceRange(fix, nodeStart(file, emptyWith), emptyWith.End(), "{}")}}, nil
	}
	name := freshName(file, "$legacy$ts")
	text := "module " + name + " {\n" + file.Text() + "\n}\nexport * from " + name + "\n"
	if hasDefault {
		text += "export { default } from " + name + "\n"
	}
	return []*ls.CodeAction{{Description: "Write a TypeScript module for legacy JavaScript", Changes: replaceRange(fix, 0, len(file.Text()), text)}}, nil
}
