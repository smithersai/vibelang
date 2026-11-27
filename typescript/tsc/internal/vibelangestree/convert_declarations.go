package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func (c *converter) convertDeclarationNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if result, ok := c.convertFunctionAndClassNode(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertImportNode(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertExportNode(n, parent); ok {
		return result, true
	}
	return c.convertTypeAndModuleDecl(n, parent)
}

func (c *converter) convertFunctionAndClassNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindFunctionDeclaration:
		function := n.AsFunctionDeclaration()
		typ := "FunctionDeclaration"
		if function.Body == nil {
			typ = "TSDeclareFunction"
		}
		result := c.node(n, typ).set("async", hasModifier(ast.KindAsyncKeyword, n))
		if function.Body != nil {
			result.set("body", c.convertChild(function.Body, n))
		}
		result.set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("expression", false).
			set("generator", function.AsteriskToken != nil).
			set("id", c.convertChild(n.Name(), n)).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return c.fixExports(n, result), true
	case ast.KindFunctionExpression:
		function := n.AsFunctionExpression()
		result := c.node(n, "FunctionExpression").
			set("async", hasModifier(ast.KindAsyncKeyword, n)).
			set("body", c.convertChild(function.Body, n)).
			set("declare", false).
			set("expression", false).
			set("generator", function.AsteriskToken != nil).
			set("id", c.convertChild(n.Name(), n)).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result, true
	case ast.KindArrowFunction:
		arrow := n.AsArrowFunction()
		body := c.convertChild(arrow.Body, n)
		result := c.node(n, "ArrowFunctionExpression").
			set("async", hasModifier(ast.KindAsyncKeyword, n)).
			set("body", body).
			set("expression", arrow.Body.Kind != ast.KindBlock).
			set("generator", false).
			set("id", nil).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		if c.vibe && body != nil {
			fixParentLocation(result, body.rng())
		}
		if c.vibe && n.Flags&ast.NodeFlagsVibeLangEffect != 0 && isProgramArrow(n) {
			return c.effectBlockValue(n, result), true
		}
		return result, true
	case ast.KindClassDeclaration, ast.KindClassExpression:
		return c.convertClass(n), true
	case ast.KindClassStaticBlockDeclaration:
		body := n.AsClassStaticBlockDeclaration().Body
		result := c.node(n, "StaticBlock").set("body", c.convertBodyExpressions(body.Statements(), n, parent))
		if c.synthesized(n) {
			result.set("synthesized", true)
		}
		return result, true
	case ast.KindDecorator:
		return c.node(n, "Decorator").set("expression", c.convertChild(n.Expression(), n)), true
	}
	return nil, false
}

func (c *converter) convertImportNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindImportDeclaration:
		return c.convertImportDeclaration(n), true
	case ast.KindNamespaceImport:
		return c.node(n, "ImportNamespaceSpecifier").set("local", c.convertChild(n.Name(), n)), true
	case ast.KindImportSpecifier:
		specifier := n.AsImportSpecifier()
		imported := specifier.PropertyName
		if imported == nil {
			imported = n.Name()
		}
		importKind := "value"
		if specifier.IsTypeOnly {
			importKind = "type"
		}
		return c.node(n, "ImportSpecifier").
			set("imported", c.convertChild(imported, n)).
			set("importKind", importKind).
			set("local", c.convertChild(n.Name(), n)), true
	case ast.KindImportClause:
		local := c.convertChild(n.Name(), n)
		return c.nodeAt(local.rng(), "ImportDefaultSpecifier").set("local", local), true
	case ast.KindImportEqualsDeclaration:
		declaration := n.AsImportEqualsDeclaration()
		importKind := "value"
		if declaration.IsTypeOnly {
			importKind = "type"
		}
		return c.fixExports(n, c.node(n, "TSImportEqualsDeclaration").
			set("id", c.convertChild(n.Name(), n)).
			set("importKind", importKind).
			set("moduleReference", c.convertChild(declaration.ModuleReference, n))), true
	case ast.KindExternalModuleReference:
		return c.node(n, "TSExternalModuleReference").set("expression", c.convertChild(n.Expression(), n)), true
	case ast.KindImportAttribute:
		attribute := n.AsImportAttribute()
		return c.node(n, "ImportAttribute").
			set("key", c.convertChild(attribute.Name(), n)).
			set("value", c.convertChild(attribute.Value, n)), true
	}
	return nil, false
}

func (c *converter) convertExportNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindExportDeclaration:
		export := n.AsExportDeclaration()
		exportKind := "value"
		if export.IsTypeOnly {
			exportKind = "type"
		}
		if export.ExportClause != nil && export.ExportClause.Kind == ast.KindNamedExports {
			return c.node(n, "ExportNamedDeclaration").
				set("attributes", c.convertImportAttributes(export.Attributes)).
				set("declaration", nil).
				set("exportKind", exportKind).
				set("source", c.convertChild(export.ModuleSpecifier, n)).
				set("specifiers", c.convertChildren(listNodes(export.ExportClause.AsNamedExports().Elements), n)), true
		}
		var exported any
		if export.ExportClause != nil && export.ExportClause.Kind == ast.KindNamespaceExport {
			exported = c.convertChild(export.ExportClause.Name(), export.ExportClause)
		}
		return c.node(n, "ExportAllDeclaration").
			set("attributes", c.convertImportAttributes(export.Attributes)).
			set("exported", exported).
			set("exportKind", exportKind).
			set("source", c.convertChild(export.ModuleSpecifier, n)), true
	case ast.KindExportSpecifier:
		specifier := n.AsExportSpecifier()
		local := specifier.PropertyName
		if local == nil {
			local = n.Name()
		}
		exportKind := "value"
		if specifier.IsTypeOnly {
			exportKind = "type"
		}
		return c.node(n, "ExportSpecifier").
			set("exported", c.convertChild(n.Name(), n)).
			set("exportKind", exportKind).
			set("local", c.convertChild(local, n)), true
	case ast.KindExportAssignment:
		assignment := n.AsExportAssignment()
		if assignment.IsExportEquals {
			return c.node(n, "TSExportAssignment").set("expression", c.convertChild(assignment.Expression, n)), true
		}
		return c.node(n, "ExportDefaultDeclaration").
			set("declaration", c.convertChild(assignment.Expression, n)).
			set("exportKind", "value"), true
	case ast.KindNamespaceExportDeclaration:
		return c.node(n, "TSNamespaceExportDeclaration").set("id", c.convertChild(n.Name(), n)), true
	}
	return nil, false
}

func (c *converter) convertTypeAndModuleDecl(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindTypeAliasDeclaration:
		alias := n.AsTypeAliasDeclaration()
		result := c.node(n, "TSTypeAliasDeclaration").
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("id", c.convertChild(n.Name(), n)).
			set("typeAnnotation", c.convertChild(alias.Type, n))
		setTypeParameters(result, c.convertTypeParameters(alias.TypeParameters, n))
		return c.fixExports(n, result), true
	case ast.KindInterfaceDeclaration:
		declaration := n.AsInterfaceDeclaration()
		extends := []any{}
		for _, clause := range listNodes(declaration.HeritageClauses) {
			if clause.AsHeritageClause().Token != ast.KindExtendsKeyword {
				continue
			}
			for _, heritageType := range listNodes(clause.AsHeritageClause().Types) {
				if c.synthesized(heritageType) {
					continue
				}
				extends = append(extends, c.convertHeritage(heritageType, n, "TSInterfaceHeritage"))
			}
		}
		members := declaration.Members
		result := c.node(n, "TSInterfaceDeclaration").
			set("body", c.nodeAt(span{members.Pos() - 1, n.End()}, "TSInterfaceBody").set("body", c.convertChildren(members.Nodes, n))).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("extends", extends).
			set("id", c.convertChild(n.Name(), n))
		setTypeParameters(result, c.convertTypeParameters(declaration.TypeParameters, n))
		return c.fixExports(n, result), true
	case ast.KindEnumDeclaration:
		enum := n.AsEnumDeclaration()
		members := enum.Members
		result := c.node(n, "TSEnumDeclaration").
			set("body", c.nodeAt(span{members.Pos() - 1, n.End()}, "TSEnumBody").set("members", c.convertChildren(members.Nodes, n))).
			set("const", hasModifier(ast.KindConstKeyword, n)).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("id", c.convertChild(n.Name(), n))
		return c.fixExports(n, result), true
	case ast.KindEnumMember:
		member := n.AsEnumMember()
		result := c.node(n, "TSEnumMember").set("id", c.convertChild(n.Name(), n))
		if member.Initializer != nil {
			result.set("initializer", c.convertChild(member.Initializer, n))
		}
		return result, true
	case ast.KindModuleDeclaration:
		return c.convertModule(n), true
	}
	return nil, false
}

func (c *converter) convertImportDeclaration(n *ast.Node) *obj {
	declaration := n.AsImportDeclaration()
	var phase any
	clause := declaration.ImportClause
	if clause != nil && clause.AsImportClause().PhaseModifier == ast.KindDeferKeyword {
		phase = "defer"
	}
	result := c.node(n, "ImportDeclaration").
		set("attributes", c.convertImportAttributes(declaration.Attributes)).
		set("importKind", "value").
		set("phase", phase).
		set("source", c.convertChild(declaration.ModuleSpecifier, n))
	specifiers := []any{}
	if clause != nil {
		importClause := clause.AsImportClause()
		if importClause.PhaseModifier == ast.KindTypeKeyword {
			result.set("importKind", "type")
		}
		if clause.Name() != nil {
			specifiers = append(specifiers, c.convertChild(clause, n))
		}
		if bindings := importClause.NamedBindings; bindings != nil {
			switch bindings.Kind {
			case ast.KindNamespaceImport:
				specifiers = append(specifiers, c.convertChild(bindings, clause))
			case ast.KindNamedImports:
				specifiers = append(specifiers, c.convertChildren(listNodes(bindings.AsNamedImports().Elements), bindings)...)
			}
		}
	}
	return result.set("specifiers", specifiers)
}

func (c *converter) convertModule(n *ast.Node) *obj {
	declaration := n.AsModuleDeclaration()
	isDeclare := hasModifier(ast.KindDeclareKeyword, n)
	result := c.node(n, "TSModuleDeclaration")
	name := n.Name()
	switch {
	case declaration.Keyword == ast.KindGlobalKeyword:
		result.set("body", c.convertChild(declaration.Body, n)).
			set("declare", false).
			set("global", true).
			set("id", c.convertChild(name, n)).
			set("kind", "global")
	case name.Kind == ast.KindStringLiteral:
		result.set("kind", "module")
		if body := c.convertChild(declaration.Body, n); body != nil {
			result.set("body", body)
		}
		result.set("declare", false).set("global", false).set("id", c.convertChild(name, n))
	default:
		id := identifierShape(c.nodeAt(c.rangeOf(name), "Identifier"), name.Text())
		node := n
		for node.Body() != nil && node.Body().Kind == ast.KindModuleDeclaration && node.Body().Name() != nil {
			node = node.Body()
			isDeclare = isDeclare || hasModifier(ast.KindDeclareKeyword, node)
			nextName := node.Name()
			right := identifierShape(c.nodeAt(c.rangeOf(nextName), "Identifier"), nextName.Text())
			id = c.nodeAt(span{id.rng().start, right.rng().end}, "TSQualifiedName").set("left", id).set("right", right)
		}
		kind := "module"
		if node.AsModuleDeclaration().Keyword == ast.KindNamespaceKeyword {
			kind = "namespace"
		}
		result.set("body", c.convertChild(node.Body(), node)).
			set("declare", false).
			set("global", false).
			set("id", id).
			set("kind", kind)
	}
	result.set("declare", isDeclare)
	return c.fixExports(n, result)
}
