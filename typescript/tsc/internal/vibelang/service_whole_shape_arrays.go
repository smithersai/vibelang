package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// TypeScript normalizes the built-in array types when inferring a Service
// base or Reference result. A named user alias keeps its written identity.
func wholeShapeArraySpellings(c *checker.Checker, shape *ast.Node) map[*ast.Node]bool {
	if shape == nil {
		return nil
	}
	arrays := map[*ast.Node]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsTypeReferenceNode(node) && len(node.TypeArguments()) == 1 {
			symbol := c.GetSymbolAtLocation(node.AsTypeReferenceNode().TypeName)
			if symbol != nil && symbol.Flags()&ast.SymbolFlagsInterface != 0 && c.IsArrayType(c.GetTypeFromTypeNode(node)) {
				arrays[node] = symbol.Name() == "ReadonlyArray"
			}
		}
		return node.ForEachChild(visit)
	}
	visit(shape)
	return arrays
}

type wholeShapeArrayTypes struct {
	transformers.Transformer
	arrays map[*ast.Node]bool
}

func (e *serviceEmitter) wholeShapeArrays(shape *ast.Node, arrays map[*ast.Node]bool) *ast.Node {
	tx := &wholeShapeArrayTypes{arrays: arrays}
	tx.NewTransformer(tx.visit, e.ec)
	return tx.Visitor().VisitNode(shape)
}
func (tx *wholeShapeArrayTypes) visit(node *ast.Node) *ast.Node {
	original := tx.EmitContext().MostOriginal(node)
	node = tx.Visitor().VisitEachChild(node)
	readonly, ok := tx.arrays[original]
	if !ok || !ast.IsTypeReferenceNode(node) || len(node.TypeArguments()) != 1 {
		return node
	}
	f := tx.EmitContext().Factory
	array := f.NewArrayTypeNode(node.TypeArguments()[0])
	if readonly {
		return f.NewTypeOperatorNode(ast.KindReadonlyKeyword, array)
	}
	return array
}
