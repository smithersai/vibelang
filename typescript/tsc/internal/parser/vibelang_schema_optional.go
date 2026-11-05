package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Keep source spans rather than printing mapped codecs back as source types.
// Data.TaggedEnum payloads already use native TypeScript optional properties.
func (p *Parser) vibelangOptionalSchema(typ *ast.Node, anchor core.TextRange, tuple bool) *ast.Node {
	value := p.vibelangSchemaOf(p.vibelangOptionalSchemaType(typ))
	call := p.vibelangSchemaCall("optional", anchor, value)
	exact := p.vibelangSchemaCall("optionalKey", anchor, value)
	// Alternatives share only the argument. Keep its visible parent intact.
	var link func(*ast.Node, *ast.Node)
	link = func(node, parent *ast.Node) {
		if node == value {
			return
		}
		node.Parent = parent
		node.ForEachChild(func(child *ast.Node) bool { link(child, node); return false })
	}
	link(exact, call)
	ast.SetParentInChildren(call)
	p.vibelangSchemaOptionals = append(p.vibelangSchemaOptionals, ast.SchemaOptionalReference{
		Expression: call, Exact: exact, TypeRange: typ.Loc, AllowsUndefined: schemaTypeAllowsUndefined(typ), Parenthesize: tuple,
	})
	return call
}

// Select by explicit source undefined; Unknown/Any codecs can already accept
// undefined without changing the wrapper selected by their source spelling.
func schemaTypeAllowsUndefined(typ *ast.Node) bool {
	switch typ.Kind {
	case ast.KindUndefinedKeyword:
		return true
	case ast.KindParenthesizedType:
		return schemaTypeAllowsUndefined(typ.AsParenthesizedTypeNode().Type)
	case ast.KindUnionType:
		return core.Some(typ.AsUnionTypeNode().Types.Nodes, schemaTypeAllowsUndefined)
	}
	return false
}

// An optional wrapper already supplies present undefined. Remove only explicit
// top-level undefined union arms before mapping its value codec, so optional
// fields and slots retain the same public codec type as Schema.optional(S).
// Required positions and undefined inside arrays or nested fields map normally.
func (p *Parser) vibelangOptionalSchemaType(typ *ast.Node) *ast.Node {
	members := vibelangSchemaUnionMembers(typ)
	var kept []*ast.Node
	for _, member := range members {
		if member.Kind != ast.KindUndefinedKeyword {
			kept = append(kept, member)
		}
	}
	if len(kept) == 0 || len(kept) == len(members) {
		return typ
	}
	if len(kept) == 1 {
		return kept[0]
	}
	return p.vibelangSpanning(p.factory.NewUnionTypeNode(p.newNodeList(typ.Loc, kept)), typ.Loc)
}
