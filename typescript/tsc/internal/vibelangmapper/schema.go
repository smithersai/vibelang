package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// isSchemaDeclaration recognizes the parser's D133 struct initializer, so
// ordinary Schema.Struct calls retain their ordinary expression lowering, and
// a D280 alias, whose declaration the parser flags.
func isSchemaDeclaration(node *ast.Node) bool {
	if node.Kind != ast.KindVariableStatement {
		return false
	}
	declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	return len(declarations) == 1 && declarations[0].Initializer() != nil &&
		(isSchemaAlias(declarations[0]) || declarations[0].Initializer().Kind == ast.KindCallExpression && declarations[0].Initializer().Flags&ast.NodeFlagsVibeLang != 0)
}

// isSchemaAlias reports whether declaration is the constant of a schema alias,
// schema Name = Type (D280), which the parser flags NodeFlagsVibeLang.
func isSchemaAlias(declaration *ast.Node) bool {
	return declaration.Kind == ast.KindVariableDeclaration && declaration.Flags&ast.NodeFlagsVibeLang != 0
}

// isSchemaAliasType identifies a schema alias's synthesized type alias,
// type Name = typeof Name.Type, which is written with the constant.
func isSchemaAliasType(node *ast.Node) bool {
	if node.Kind != ast.KindTypeAliasDeclaration || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	query := node.Type()
	return query != nil && query.Kind == ast.KindTypeQuery && query.AsTypeQueryNode().ExprName.Kind == ast.KindQualifiedName &&
		query.AsTypeQueryNode().ExprName.AsQualifiedName().Right.Text() == "Type"
}

// isSchemaInterface identifies the parser's preceding decoded-type declaration.
// Its text is written together with the constant rather than visited twice.
func isSchemaInterface(node *ast.Node) bool {
	if node.Kind != ast.KindInterfaceDeclaration || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	clauses := node.AsInterfaceDeclaration().HeritageClauses
	if clauses == nil || len(clauses.Nodes) != 1 {
		return false
	}
	types := clauses.Nodes[0].AsHeritageClause().Types.Nodes
	if len(types) != 1 {
		return false
	}
	expression := types[0].Expression()
	return expression.Kind == ast.KindPropertyAccessExpression && expression.Name().Text() == "Type" && expression.Expression().Kind == ast.KindPropertyAccessExpression && expression.Expression().Name().Text() == "Schema"
}

// schemaDeclaration prints the parser's schema expressions in both renderings.
// The decoded interface is a checking witness; deriving it from the value keeps
// optional and mutable keys consistent with the runtime schema.
func (p *projector) schemaDeclaration(node *ast.Node) {
	if isSchemaInterface(node) || isSchemaAliasType(node) {
		return
	}
	declaration := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	name := declaration.Name()
	start, ok := p.keywordBefore(name, "schema")
	if !ok {
		p.unprojected(node)
		return
	}
	schema := p.names.prelude("Schema")
	exported := ""
	if ast.HasSyntacticModifier(node, ast.ModifierFlagsExport) {
		exported = "export "
	}
	// Export already precedes the replaced keyword, so it belongs to the
	// interface, with a second export preceding the value declaration.
	if isSchemaAlias(declaration) {
		// D280: the type is the schema's decoded type.
		p.plan.witness(start, "type "+name.Text()+" = typeof "+name.Text()+".Type;\n"+exported)
	} else {
		p.plan.witness(start, "interface "+name.Text()+" extends "+schema+".Schema.Type<typeof "+name.Text()+"> {}\n"+exported)
	}
	value := p.schemaExpression(declaration.Initializer(), schema)
	p.plan.replace(start, node.End(), "const "+name.Text()+" = "+value+";")
}

// schemaExpression serializes only expressions the schema parser creates.
// Unsupported forms and undecidable names are diagnosed at their source span.
func (p *projector) schemaExpression(node *ast.Node, schema string) string {
	if node.Kind == ast.KindPropertyAccessExpression && node.Flags&ast.NodeFlagsVibeLang != 0 {
		p.schemaDiagnostic(node, "This field type has no schema form (EK2109); use an explicit Schema value.")
	}
	switch node.Kind {
	case ast.KindCallExpression:
		args := make([]string, len(node.Arguments()))
		for i, arg := range node.Arguments() {
			args[i] = p.schemaExpression(arg, schema)
		}
		return p.schemaExpression(node.Expression(), schema) + "(" + strings.Join(args, ", ") + ")"
	case ast.KindPropertyAccessExpression:
		if node.Flags&ast.NodeFlagsReparsed != 0 {
			return schema + "." + node.Name().Text()
		}
		p.checkSchemaName(node)
		return p.text[p.tokenStart(node):node.End()]
	case ast.KindObjectLiteralExpression:
		var fields []string
		for _, field := range node.AsObjectLiteralExpression().Properties.Nodes {
			name := field.Name()
			if name.Kind == ast.KindComputedPropertyName {
				p.schemaDiagnostic(name, "A computed schema key requires an explicit Schema value.")
			}
			key := "\"\""
			if name.Flags&ast.NodeFlagsReparsed == 0 {
				key = p.text[p.tokenStart(name):name.End()]
			}
			fields = append(fields, key+": "+p.schemaExpression(field.Initializer(), schema))
		}
		return "{ " + strings.Join(fields, ", ") + " }"
	case ast.KindArrayLiteralExpression:
		var values []string
		for _, value := range node.AsArrayLiteralExpression().Elements.Nodes {
			values = append(values, p.schemaExpression(value, schema))
		}
		return "[" + strings.Join(values, ", ") + "]"
	case ast.KindIdentifier:
		p.checkSchemaName(node)
	}
	return p.text[p.tokenStart(node):node.End()]
}

// checkSchemaName accepts locally evident schema values and diagnoses names
// whose schema nature requires type information unavailable to the projector.
func (p *projector) checkSchemaName(node *ast.Node) {
	name := p.text[p.tokenStart(node):node.End()]
	known, found := false, false
	// Search lexical scopes from the field outward; a declaration in an
	// unrelated block cannot establish the value of this reference.
	for scope := node.Parent; scope != nil && !found; scope = scope.Parent {
		if ast.IsFunctionLike(scope) {
			for _, parameter := range scope.Parameters() {
				if parameter.Name() != nil && ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == name {
					found = true
				}
			}
		}
		if found {
			break
		}
		if scope.Kind != ast.KindSourceFile && scope.Kind != ast.KindBlock && scope.Kind != ast.KindModuleBlock {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if isSchemaDeclaration(n) {
				d := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
				if d.Name().Text() == name {
					known, found = true, true
				}
				return false
			}
			if n.Kind == ast.KindVariableDeclaration && n.Name() != nil && ast.IsIdentifier(n.Name()) && n.Name().Text() == name {
				found = true
				known = explicitSchemaValue(n.Initializer()) || annotatedSchemaValue(n.Type())
				return false
			}
			if n.Name() != nil && ast.IsIdentifier(n.Name()) && n.Name().Text() == name {
				found = true
			}
			if ast.IsFunctionLike(n) || ast.IsClassLike(n) || n.Kind == ast.KindBlock || n.Kind == ast.KindModuleDeclaration {
				return false
			}
			n.ForEachChild(visit)
			return false
		}
		scope.ForEachChild(visit)
	}
	if !known {
		p.schemaDiagnostic(node, "Cannot establish that "+name+" is a schema (EK2109); provide a schema annotation or an explicit Schema value.")
	}
}

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
		case "Struct", "Array", "Tuple", "Record", "Union", "Literal", "Literals", "optional", "mutableKey", "mutable":
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
