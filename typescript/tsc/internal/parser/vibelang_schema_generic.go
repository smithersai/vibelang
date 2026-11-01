package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Alternatives are detached expressions. Their arguments retain the parents
// the binder gives the visible codec; none of the shared AST is mutated by a
// checker or an emitter.
func (p *Parser) vibelangArraySchemaReference(name, value, visible *ast.Node, mutable, legacy bool) *ast.Node {
	argument := value.Arguments()[0]
	if mutable {
		argument = value.Arguments()[0].Arguments()[0]
	}
	readonly := p.vibelangSchemaCall("Array", name.Loc, argument)
	mutableValue := p.vibelangSchemaCall("mutable", name.Loc, p.vibelangSchemaCall("Array", name.Loc, argument))
	link := func(root *ast.Node) {
		var visit func(*ast.Node, *ast.Node)
		visit = func(node, parent *ast.Node) {
			if node == argument {
				return
			}
			node.Parent = parent
			node.ForEachChild(func(child *ast.Node) bool { visit(child, node); return false })
		}
		visit(root, visible)
	}
	link(readonly)
	link(mutableValue)
	// Codec construction reparents its arguments. Restore the visible tree
	// before the binder sees it; detached alternatives share only the argument.
	ast.SetParentInChildren(visible)
	clonedName := p.vibelangSchemaGenericName(name)
	clonedName.Parent.Parent = visible
	p.vibelangSchemaGenerics = append(p.vibelangSchemaGenerics, ast.SchemaGenericReference{
		Arity: 1, Name: clonedName, Expression: visible, MutableArray: mutableValue, ReadonlyArray: readonly,
		DefaultMutable: mutable, Legacy: legacy,
	})
	return visible
}

func (p *Parser) attachVibeLangSchemaGenericScopes(file *ast.SourceFile) {
	for i := range file.VibeLangSchemaGenerics {
		ref := &file.VibeLangSchemaGenerics[i]
		scope := ref.Expression.Parent
		for scope != nil && scope.Kind != ast.KindBlock && scope.Kind != ast.KindModuleBlock &&
			scope.Kind != ast.KindSourceFile && !ast.IsClassLike(scope) {
			scope = scope.Parent
		}
		if scope == nil {
			continue
		} // a discarded speculative parse
		ref.Name.Parent.Parent = scope
		if ref.MutableArray != nil {
			ref.MutableArray.Parent = scope
		}
		if ref.ReadonlyArray != nil {
			ref.ReadonlyArray.Parent = scope
		}
	}
}

// A two-argument candidate is a Record only when its source name resolves to
// the library's type alias. Unknown spellings have no previous codec to keep.
func (p *Parser) vibelangRecordSchemaReference(name, value *ast.Node, legacy bool) *ast.Node {
	clonedName := p.vibelangSchemaGenericName(name)
	clonedName.Parent.Parent = value
	p.vibelangSchemaGenerics = append(p.vibelangSchemaGenerics, ast.SchemaGenericReference{
		Arity: 2, Name: clonedName, Expression: value, Legacy: legacy,
	})
	return value
}

// A detached name still has ordinary type-reference context for editor
// symbol lookup. The holder is metadata only and is never bound or emitted.
func (p *Parser) vibelangSchemaGenericName(name *ast.Node) *ast.Node {
	cloned := p.factory.DeepCloneReparse(name)
	holder := p.vibelangSpanning(p.factory.NewTypeReferenceNode(cloned, nil), name.Loc)
	ast.SetParentInChildren(holder)
	return cloned
}
