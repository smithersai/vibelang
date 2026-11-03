package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

const serviceKeyWidenTitle = "Keep the mutable service key binding as string"

func init() {
	nativeFixCodes = append(nativeFixCodes, 2322)
	tsFormFixCodes = append(tsFormFixCodes, 2322)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 2322)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2322}, GetCodeActions: serviceKeyWidenActions})
}

// A mutable local initialized from a service key used to infer string.
// Preserve that intent on reassignment by writing the local's type explicitly;
// the service itself retains its precise native key type.
func serviceKeyWidenActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	var local *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if nodeStart(fix.SourceFile, node) > fix.Span.Pos() || node.End() < fix.Span.End() {
			return false
		}
		if ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
			if !c.IsTypeAssignableTo(c.GetTypeAtLocation(node.AsBinaryExpression().Right), c.GetStringType()) {
				return false
			}
			left := node.AsBinaryExpression().Left
			if ast.IsIdentifier(left) {
				if symbol := c.GetSymbolAtLocation(left); symbol != nil {
					local = symbol.ValueDeclaration()
				}
			}
		}
		return node.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if local == nil || !ast.IsVariableDeclaration(local) || ast.GetCombinedNodeFlags(local)&ast.NodeFlagsLet == 0 || local.Type() != nil || !ast.IsIdentifier(local.Name()) || local.Initializer() == nil || ast.GetSourceFileOfNode(local) != fix.SourceFile || enclosingFunction(local) == nil {
		return nil, nil
	}
	read := ast.SkipParentheses(local.Initializer())
	keyRead := ast.IsPropertyAccessExpression(read) && read.Name().Text() == serviceKeyName
	if ast.IsElementAccessExpression(read) {
		argument := read.AsElementAccessExpression().ArgumentExpression
		keyRead = argument != nil && ast.IsStringLiteral(argument) && argument.Text() == serviceKeyName
	}
	if !keyRead {
		return nil, nil
	}
	class := serviceNamedBy(c, read.Expression())
	if class == nil || hasDefaultValue(class) {
		return nil, nil
	}
	if _, key := writtenKey(class); key == nil || key.Type() != nil {
		return nil, nil
	}
	at := local.Name().End()
	return []*ls.CodeAction{{Description: serviceKeyWidenTitle, Changes: replaceRange(fix, at, at, ": string")}}, nil
}
