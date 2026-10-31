package vibelangestree

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// schemaAlias converts schema Name = Type (D280), which the parser writes as
// const Name = <the type's schema> beside a synthesized type alias, to
// const Name: Type, so the type is read as the author wrote it, as
// schemaDeclaration does for the struct form. The synthesized type alias is
// left out (skipStatement).
func (c *converter) schemaAlias(n *ast.Node) *obj {
	declarations := listNodes(n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations)
	if len(declarations) != 1 || declarations[0].Flags&ast.NodeFlagsVibeLang == 0 {
		return nil
	}
	declaration := declarations[0]
	name := declaration.Name()
	equals, kind := c.tokenAfter(name.End())
	if kind != ast.KindEqualsToken {
		return nil
	}
	id := c.convertChild(name, declaration)
	if typeNode := c.reparseType(equals.end, declaration.End()); typeNode != nil {
		annotation := c.convertChild(typeNode, typeNode.Parent)
		schemaValues(annotation) // a reference reads its value (vibelang.go)
		id.set("typeAnnotation", c.nodeAt(c.rangeOf(typeNode), "TSTypeAnnotation").set("typeAnnotation", annotation))
	}
	declarator := c.nodeAt(span{c.start(name), declaration.End()}, "VariableDeclarator").
		set("definite", false).
		set("id", id).
		set("init", nil)
	result := c.node(n, "VariableDeclaration").
		set("declarations", []any{declarator}).
		set("declare", hasModifier(ast.KindDeclareKeyword, n)).
		set("kind", "const")
	return c.fixExports(n, result)
}

// reparseType parses the source text from pos to end again as a type, at the
// same offsets, since the parser keeps only the schema it wrote for an
// alias's type.
func (c *converter) reparseType(pos, end int) *ast.Node {
	start, _ := c.tokenAfter(pos)
	if start.start < len("type _=") || start.start >= end {
		return nil
	}
	var b strings.Builder
	b.Grow(len(c.text))
	b.WriteString(blank(c.text[:start.start-len("type _=")]))
	b.WriteString("type _=")
	b.WriteString(c.text[start.start:end])
	b.WriteString(blank(c.text[end:]))
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema.vibe", PathKey: "/schema.vibe"}, b.String(), core.ScriptKindTS)
	statements := listNodes(file.Statements)
	if len(file.Diagnostics()) != 0 || len(statements) != 1 || statements[0].Kind != ast.KindTypeAliasDeclaration {
		return nil
	}
	return statements[0].Type()
}
