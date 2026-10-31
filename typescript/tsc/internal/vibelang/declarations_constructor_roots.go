package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// AsyncFiberError's inferred constructor parameter can reach Fiber through
// either the runtime matcher or the SDK itself. Keep the same public namespace
// type in both cases, independently of whether a nearby pattern uses a guard.
type constructorFiberTypes struct {
	transformers.Transformer
	source *ast.SourceFile
	record func(*ast.Node)
}

func newConstructorFiberTypes(c *checker.Checker, source *ast.SourceFile) *constructorFiberTypes {
	imported, written := false, false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && node.Text() == "Fiber" {
			written = true // also protects nested type parameters and local shadows
		}
		if ast.IsImportSpecifier(node) {
			symbol := c.GetSymbolAtLocation(node.Name())
			if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
				symbol = c.GetAliasedSymbol(symbol)
				if symbol != nil {
					for _, declaration := range symbol.Declarations() {
						for module, constructors := range fixedErrorGuards {
							if constructors[symbol.Name()] != "" && isEffectModuleFile(ast.GetSourceFileOfNode(declaration), module) {
								imported = true
							}
						}
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	source.AsNode().ForEachChild(visit)
	if !imported || written {
		return nil
	}
	return &constructorFiberTypes{source: source, record: func(name *ast.Node) { recordTypeUse(preludeStateOf(c), source, name) }}
}

func (tx *constructorFiberTypes) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	if node.Kind != ast.KindImportType {
		return node
	}
	t := node.AsImportTypeNode()
	if t.IsTypeOf || t.Attributes != nil || t.Argument == nil || !ast.IsLiteralTypeNode(t.Argument) || t.Qualifier == nil || !ast.IsIdentifier(t.Qualifier) || t.Qualifier.Text() != "Fiber" {
		return node
	}
	literal := t.Argument.AsLiteralTypeNode().Literal
	if !ast.IsStringLiteral(literal) || literal.Text() != "effect/Fiber" {
		return node
	}
	original := tx.EmitContext().MostOriginal(node)
	if original.Kind == ast.KindImportType && ast.GetSourceFileOfNode(original) == tx.source {
		return node // preserve an explicitly written import type
	}
	f := tx.Factory()
	namespace := f.NewIdentifier("Fiber")
	tx.record(namespace)
	return f.NewTypeReferenceNode(f.NewQualifiedName(namespace, f.NewIdentifier("Fiber")), t.TypeArguments)
}
