package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	nativeFixCodes = append(nativeFixCodes, 2588)
	tsFormFixCodes = append(tsFormFixCodes, 2588)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 2588)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2588}, GetCodeActions: forHeadConstDestructuringActions})
}

// This list already lowered to let before the missing const diagnostic was
// restored. Writing let preserves that emitted program, including loop cells.
// Other const declarations and const pattern bindings have no such rewrite.
func forHeadConstDestructuringActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	if !file.IsVibeLang() {
		return nil, nil
	}
	name := astnav.GetTouchingPropertyName(file, fix.Span.Pos())
	if !ast.IsIdentifier(name) {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return nil, nil
	}
	declaration := ast.GetRootDeclaration(symbol.ValueDeclaration())
	if !ast.IsVariableDeclaration(declaration) || declaration.Flags&ast.NodeFlagsVibeLangConst == 0 || !ast.IsBindingPattern(declaration.Name()) {
		return nil, nil
	}
	list := declaration.Parent
	if !ast.IsVariableDeclarationList(list) || list.Parent == nil || list.Parent.Kind != ast.KindForStatement || list.Parent.AsForStatement().Initializer != list {
		return nil, nil
	}
	start := scanner.SkipTrivia(file.Text(), list.Pos())
	if start+5 > len(file.Text()) || file.Text()[start:start+5] != "const" {
		return nil, nil
	}
	return []*ls.CodeAction{{Description: "Write let for this mutable loop initializer", Changes: replaceRange(fix, start, start+5, "let")}}, nil
}
