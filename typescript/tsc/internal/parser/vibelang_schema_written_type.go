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
// after the schema (or a written Data.taggedEnum<Name>() constant before or
// after a nongeneric data declaration, #179) has the same effect. Removing only
// the synthesized node leaves each written declaration's location, JSDoc and
// modifiers untouched. A second declaration or written companion keeps the
// existing duplicate-name errors.
func (p *Parser) vibelangWrittenSchemaTypes(statements []*ast.Node) []*ast.Node {
	isNongenericDataCompanion := func(node *ast.Node) (string, bool) {
		if !IsDataConstructors(node) {
			return "", false
		}
		decl := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
		if decl.Type() != nil || !ast.IsIdentifier(decl.Name()) {
			return "", false
		}
		return decl.Name().Text(), true
	}
	isWrittenDataConstructors := func(node *ast.Node) (string, bool) {
		if IsDataConstructors(node) || node.Kind != ast.KindVariableStatement || ast.HasSyntacticModifier(node, ast.ModifierFlagsAmbient) {
			return "", false
		}
		list := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
		if list.Flags&ast.NodeFlagsConst == 0 || len(list.Declarations.Nodes) != 1 {
			return "", false
		}
		decl := list.Declarations.Nodes[0]
		if !ast.IsIdentifier(decl.Name()) || decl.AsVariableDeclaration().ExclamationToken != nil || decl.Type() != nil {
			return "", false
		}
		call := decl.Initializer()
		if call == nil || call.Kind != ast.KindCallExpression || call.AsCallExpression().QuestionDotToken != nil || len(call.Arguments()) != 0 {
			return "", false
		}
		typeArgs := call.TypeArguments()
		if len(typeArgs) != 1 || typeArgs[0].Kind != ast.KindTypeReference {
			return "", false
		}
		ref := typeArgs[0].AsTypeReferenceNode()
		if ref.TypeArguments != nil || !ast.IsIdentifier(ref.TypeName) || ref.TypeName.Text() != decl.Name().Text() {
			return "", false
		}
		callee := call.Expression()
		if !ast.IsPropertyAccessExpression(callee) || callee.AsPropertyAccessExpression().QuestionDotToken != nil {
			return "", false
		}
		if !ast.IsIdentifier(callee.Expression()) || callee.Expression().Text() != "Data" || !ast.IsIdentifier(callee.Name()) || callee.Name().Text() != "taggedEnum" {
			return "", false
		}
		return decl.Name().Text(), true
	}
	var companions map[string]int
	var dataCompanions map[string]int
	for _, node := range statements {
		if p.vibelangSynthesizedSchemaType(node) {
			if companions == nil {
				companions = make(map[string]int)
			}
			companions[node.Name().Text()]++
		} else if name, ok := isNongenericDataCompanion(node); ok {
			if dataCompanions == nil {
				dataCompanions = make(map[string]int)
			}
			dataCompanions[name]++
		}
	}
	if companions == nil && dataCompanions == nil {
		return statements
	}
	var written map[string]int
	var writtenData map[string]int
	for _, node := range statements {
		if companions != nil && !p.vibelangSynthesizedSchemaType(node) && vibelangSchemaTypeQuery(node) {
			if written == nil {
				written = make(map[string]int)
			}
			written[node.Name().Text()]++
		} else if dataCompanions != nil {
			if name, ok := isWrittenDataConstructors(node); ok {
				if writtenData == nil {
					writtenData = make(map[string]int)
				}
				writtenData[name]++
			}
		}
	}
	out := statements[:0]
	for _, node := range statements {
		if companions != nil && p.vibelangSynthesizedSchemaType(node) && companions[node.Name().Text()] == 1 && written[node.Name().Text()] == 1 {
			continue
		}
		if dataCompanions != nil {
			if name, ok := isNongenericDataCompanion(node); ok && dataCompanions[name] == 1 && writtenData[name] == 1 {
				continue
			}
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
