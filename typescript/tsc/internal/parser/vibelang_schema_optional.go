package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Keep source spans rather than printing mapped codecs back as source types.
// Data.TaggedEnum payloads already use native TypeScript optional properties.
func (p *Parser) vibelangOptionalSchema(typ *ast.Node, anchor core.TextRange, value *ast.Node, tuple bool) *ast.Node {
	call := p.vibelangSchemaCall("optional", anchor, value)
	p.vibelangSchemaOptionals = append(p.vibelangSchemaOptionals, ast.SchemaOptionalReference{
		Expression: call, TypeRange: typ.Loc, AllowsUndefined: schemaTypeAllowsUndefined(typ), Parenthesize: tuple,
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
