package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// vibelangSchemaTypeQuery recognizes exactly the written alias admitted by
// VIP-15/VIP-27's foldkit-9 amendment. Parenthesized, generic and other types
// keep the companion and therefore the ordinary duplicate-name diagnostics.
func vibelangSchemaTypeQuery(node *ast.Node) bool {
	if node.Kind != ast.KindTypeAliasDeclaration || node.AsTypeAliasDeclaration().TypeParameters != nil {
		return false
	}
	query := node.Type()
	if query == nil || query.Kind != ast.KindTypeQuery || query.AsTypeQueryNode().TypeArguments != nil {
		return false
	}
	name := query.AsTypeQueryNode().ExprName
	return name.Kind == ast.KindQualifiedName &&
		name.AsQualifiedName().Left.Kind == ast.KindIdentifier &&
		name.AsQualifiedName().Left.Text() == node.Name().Text() &&
		name.AsQualifiedName().Right.Text() == "Type"
}

func (p *Parser) vibelangSynthesizedSchemaType(node *ast.Node) bool {
	return p.vibelangSchemaTypes[node]
}

// Work on the completed lexical statement list, so a written alias before or
// after the schema has the same effect. Removing only the synthesized node
// leaves each written declaration's location, JSDoc and modifiers untouched.
// A second schema or written alias keeps the existing duplicate-name errors.
func (p *Parser) vibelangWrittenSchemaTypes(statements []*ast.Node) []*ast.Node {
	var companions map[string]int
	for _, node := range statements {
		if p.vibelangSynthesizedSchemaType(node) {
			if companions == nil {
				companions = make(map[string]int)
			}
			companions[node.Name().Text()]++
		}
	}
	if companions == nil {
		return statements
	}
	written := make(map[string]int)
	for _, node := range statements {
		if !p.vibelangSynthesizedSchemaType(node) && vibelangSchemaTypeQuery(node) {
			written[node.Name().Text()]++
		}
	}
	out := statements[:0]
	for _, node := range statements {
		if p.vibelangSynthesizedSchemaType(node) && companions[node.Name().Text()] == 1 && written[node.Name().Text()] == 1 {
			continue
		}
		out = append(out, node)
	}
	return out
}

// All case clauses of a switch share one lexical scope. A brace block inside
// a clause is handled separately and must not supply an alias for this scope.
func (p *Parser) vibelangWrittenSchemaSwitchTypes(clauses *ast.NodeList) {
	var statements []*ast.Node
	for _, clause := range clauses.Nodes {
		statements = append(statements, clause.Statements()...)
	}
	kept := p.vibelangWrittenSchemaTypes(statements)
	if len(kept) == len(statements) {
		return
	}
	present := make(map[*ast.Node]bool, len(kept))
	for _, node := range kept {
		present[node] = true
	}
	for _, clause := range clauses.Nodes {
		list := clause.StatementList()
		out := list.Nodes[:0]
		for _, node := range list.Nodes {
			if present[node] {
				out = append(out, node)
			}
		}
		list.Nodes = out
	}
}
