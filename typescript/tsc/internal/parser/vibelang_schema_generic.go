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
		if ref.InnerName != nil {
			ref.InnerName.Parent.Parent = scope
		}
		if ref.ReadonlyRecord != nil && ref.ReadonlyRecord != ref.Expression {
			ref.ReadonlyRecord.Parent = scope
		}
		if ref.MutableArray != nil && ref.MutableArray != ref.Expression {
			ref.MutableArray.Parent = scope
		}
		if ref.ReadonlyArray != nil && ref.ReadonlyArray != ref.Expression {
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

// Keep both written bindings and each admitted codec. Readonly<Record<K,V>>
// is selected only after resolving both names; an Array alias around the same
// inner Record retains the ordinary array mapping.
func (p *Parser) vibelangReadonlyRecordReference(outer, inner *ast.Node, parts []*ast.Node) *ast.Node {
	key, value := p.vibelangSchemaOf(parts[0]), p.vibelangSchemaOf(parts[1])
	readonlyRecord := p.vibelangSchemaCall("Record", outer.Loc, key, value)
	mutableRecord := p.vibelangSchemaCall("Record", inner.Loc, key, p.vibelangSchemaCall("mutableKey", parts[1].Loc, value))
	readonlyArray := p.vibelangSchemaCall("Array", outer.Loc, mutableRecord)
	mutableArray := p.vibelangSchemaCall("mutable", outer.Loc, p.vibelangSchemaCall("Array", outer.Loc, mutableRecord))
	kind, legacy := 2, false
	if ast.IsIdentifier(outer) {
		switch outer.Text() {
		case "Array":
			kind, legacy = 1, true
		case "ReadonlyArray":
			kind, legacy = 2, true
		case "Readonly":
			if ast.IsIdentifier(inner) && inner.Text() == "Record" {
				kind, legacy = 4, true
			}
		}
	}
	legacy = legacy && ast.IsIdentifier(inner) && inner.Text() == "Record"
	visible := readonlyArray
	if kind == 1 {
		visible = mutableArray
	}
	if kind == 4 {
		visible = readonlyRecord
	}
	// Shared mapped arguments keep their visible parents. Alternatives are
	// metadata, never bound independently or allowed to reparent those values.
	for _, root := range []*ast.Node{readonlyRecord, readonlyArray, mutableArray} {
		var link func(*ast.Node, *ast.Node)
		link = func(node, parent *ast.Node) {
			if node == key || node == value {
				return
			}
			node.Parent = parent
			node.ForEachChild(func(child *ast.Node) bool { link(child, node); return false })
		}
		link(root, visible)
	}
	ast.SetParentInChildren(visible)
	outerName, innerName := p.vibelangSchemaGenericName(outer), p.vibelangSchemaGenericName(inner)
	outerName.Parent.Parent, innerName.Parent.Parent = visible, visible
	p.vibelangSchemaGenerics = append(p.vibelangSchemaGenerics, ast.SchemaGenericReference{
		Arity: 1, Name: outerName, InnerName: innerName, Expression: visible,
		MutableArray: mutableArray, ReadonlyArray: readonlyArray, ReadonlyRecord: readonlyRecord,
		DefaultMutable: kind == 1, DefaultKind: kind, Legacy: legacy,
	})
	return visible
}
