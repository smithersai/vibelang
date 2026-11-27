package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// annotatedSchemaValue accepts a written schema contract, leaving TypeScript
// to verify the initializer against that explicit contract.
func annotatedSchemaValue(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindTypeReference {
		return false
	}
	name := node.AsTypeReferenceNode().TypeName
	if name.Kind != ast.KindQualifiedName {
		return false
	}
	q := name.AsQualifiedName()
	return ast.IsIdentifier(q.Left) && q.Left.Text() == "Schema" && (q.Right.Text() == "Schema" || q.Right.Text() == "Top" || q.Right.Text() == "Codec")
}

// explicitSchemaValue recognizes schema constants with a directly written
// schema constructor. Other calls need an annotation because their return
// values cannot be determined by spelling alone.
func explicitSchemaValue(node *ast.Node) bool {
	if node == nil {
		return false
	}
	call := node.Kind == ast.KindCallExpression
	if call {
		node = node.Expression()
	}
	if node.Kind != ast.KindPropertyAccessExpression || !ast.IsIdentifier(node.Expression()) || node.Expression().Text() != "Schema" {
		return false
	}
	name := node.Name().Text()
	if call {
		switch name {
		case "Struct", "TaggedUnion", "TaggedStruct", "Array", "Tuple", "Record", "Union", "Literal", "Literals", "optional", "mutableKey", "mutable":
			return true
		}
	} else {
		switch name {
		case "String", "Number", "Boolean", "BigInt", "Symbol", "Undefined", "Unknown", "Any", "Never", "ObjectKeyword", "Void", "Null", "DateTimeUtc":
			return true
		}
	}
	return false
}

// schemaDiagnostic keeps failed schema decisions visible instead of silently
// accepting the parser's recovery Schema.Unknown or an unchecked named value.
func (p *projector) schemaDiagnostic(node *ast.Node, message string) {
	start := p.tokenStart(node)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: node.End() - start, Code: 2109, Message: message})
}

// schemaDataKeywordStart finds the start of `schema` in `schema data Name`.
func (p *projector) schemaDataKeywordStart(statement *ast.Node) (int, bool) {
	after := statement.Pos()
	if mods := statement.ModifierNodes(); len(mods) != 0 {
		after = mods[len(mods)-1].End()
	}
	start := scanner.SkipTrivia(p.text, after)
	return start, start+len("schema") <= len(p.text) && p.text[start:start+len("schema")] == "schema"
}

// schemaHasSynthesizedType reports whether this schema still needs the
// projection's type witness. A written alias replaces that companion in the
// parser and must keep its own source position, docs and export status.
func schemaHasSynthesizedType(statement *ast.Node) bool {
	if statement.Parent == nil || !statement.Parent.CanHaveStatements() {
		return true
	}
	name := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name().Text()
	for _, sibling := range statement.Parent.Statements() {
		if isSchemaAliasType(sibling) && sibling.Name().Text() == name {
			return true
		}
	}
	return false
}
