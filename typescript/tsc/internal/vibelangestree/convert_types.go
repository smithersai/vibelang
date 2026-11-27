package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func (c *converter) convertTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if result, ok := c.convertBasicTypeNode(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertCompoundTypeNode(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertSignatureTypeNode(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertMappedAndPredicateTypeNode(n, parent); ok {
		return result, true
	}
	return c.convertTupleAndJSDocTypeNode(n, parent)
}

func (c *converter) convertBasicTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindQualifiedName:
		qualified := n.AsQualifiedName()
		return c.node(n, "TSQualifiedName").
			set("left", c.convertChild(qualified.Left, n)).
			set("right", c.convertChild(qualified.Right, n)), true
	case ast.KindTypeReference:
		reference := n.AsTypeReferenceNode()
		result := c.node(n, "TSTypeReference")
		if typeArguments := c.convertTypeArguments(reference.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result.set("typeName", c.convertChild(reference.TypeName, n)), true
	case ast.KindTypeParameter:
		parameter := n.AsTypeParameterDeclaration()
		result := c.node(n, "TSTypeParameter").
			set("const", hasModifier(ast.KindConstKeyword, n))
		if parameter.Constraint != nil {
			result.set("constraint", c.convertChild(parameter.Constraint, n))
		}
		if parameter.DefaultType != nil {
			result.set("default", c.convertChild(parameter.DefaultType, n))
		}
		return result.
			set("in", hasModifier(ast.KindInKeyword, n)).
			set("name", c.convertChild(n.Name(), n)).
			set("out", hasModifier(ast.KindOutKeyword, n)), true
	case ast.KindThisType:
		return c.node(n, "TSThisType"), true
	case ast.KindAnyKeyword, ast.KindBigIntKeyword, ast.KindBooleanKeyword, ast.KindNeverKeyword, ast.KindNumberKeyword,
		ast.KindObjectKeyword, ast.KindStringKeyword, ast.KindSymbolKeyword, ast.KindUnknownKeyword, ast.KindVoidKeyword,
		ast.KindUndefinedKeyword, ast.KindIntrinsicKeyword:
		return c.node(n, keywordTypes[n.Kind]), true
	case ast.KindAbstractKeyword:
		return c.node(n, "TSAbstractKeyword"), true
	case ast.KindParenthesizedType:
		return c.convertChild(n.Type(), n), true
	case ast.KindLiteralType:
		literal := n.AsLiteralTypeNode().Literal
		if literal.Kind == ast.KindNullKeyword {
			return c.node(literal, "TSNullKeyword"), true
		}
		return c.node(n, "TSLiteralType").set("literal", c.convertChild(literal, n)), true
	case ast.KindInferType:
		return c.node(n, "TSInferType").set("typeParameter", c.convertChild(n.AsInferTypeNode().TypeParameter, n)), true
	}
	return nil, false
}

func (c *converter) convertCompoundTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindTypeOperator:
		operator := n.AsTypeOperatorNode()
		return c.node(n, "TSTypeOperator").
			set("operator", tokenText(operator.Operator)).
			set("typeAnnotation", c.convertChild(operator.Type, n)), true
	case ast.KindTypeLiteral:
		return c.node(n, "TSTypeLiteral").set("members", c.convertChildren(n.Members(), n)), true
	case ast.KindArrayType:
		return c.node(n, "TSArrayType").set("elementType", c.convertChild(n.AsArrayTypeNode().ElementType, n)), true
	case ast.KindIndexedAccessType:
		access := n.AsIndexedAccessTypeNode()
		return c.node(n, "TSIndexedAccessType").
			set("indexType", c.convertChild(access.IndexType, n)).
			set("objectType", c.convertChild(access.ObjectType, n)), true
	case ast.KindConditionalType:
		conditional := n.AsConditionalTypeNode()
		return c.node(n, "TSConditionalType").
			set("checkType", c.convertChild(conditional.CheckType, n)).
			set("extendsType", c.convertChild(conditional.ExtendsType, n)).
			set("falseType", c.convertChild(conditional.FalseType, n)).
			set("trueType", c.convertChild(conditional.TrueType, n)), true
	case ast.KindTypeQuery:
		query := n.AsTypeQueryNode()
		result := c.node(n, "TSTypeQuery").set("exprName", c.convertChild(query.ExprName, n))
		if typeArguments := c.convertTypeArguments(query.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result, true
	case ast.KindUnionType:
		return c.node(n, "TSUnionType").set("types", c.convertChildren(listNodes(n.AsUnionTypeNode().Types), n)), true
	case ast.KindIntersectionType:
		return c.node(n, "TSIntersectionType").set("types", c.convertChildren(listNodes(n.AsIntersectionTypeNode().Types), n)), true
	case ast.KindImportType:
		return c.convertImportType(n), true
	}
	return nil, false
}

func (c *converter) convertSignatureTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindMethodSignature:
		return c.convertMethodSignature(n), true
	case ast.KindPropertySignature:
		signature := n.AsPropertySignatureDeclaration()
		result := c.node(n, "TSPropertySignature")
		setAccessibility(result, n)
		result.set("computed", isComputed(n.Name())).
			set("key", c.convertChild(n.Name(), n)).
			set("optional", n.QuestionToken() != nil).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n))
		if signature.Type != nil {
			result.set("typeAnnotation", c.convertTypeAnnotation(signature.Type, n))
		}
		return result, true
	case ast.KindIndexSignature:
		result := c.node(n, "TSIndexSignature")
		setAccessibility(result, n)
		result.set("parameters", c.convertChildren(n.Parameters(), n)).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n))
		if t := n.Type(); t != nil {
			result.set("typeAnnotation", c.convertTypeAnnotation(t, n))
		}
		return result, true
	case ast.KindConstructorType:
		result := c.node(n, "TSConstructorType").
			set("abstract", hasModifier(ast.KindAbstractKeyword, n)).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result, true
	case ast.KindFunctionType, ast.KindConstructSignature, ast.KindCallSignature:
		typ := map[ast.Kind]string{ast.KindFunctionType: "TSFunctionType", ast.KindConstructSignature: "TSConstructSignatureDeclaration", ast.KindCallSignature: "TSCallSignatureDeclaration"}[n.Kind]
		result := c.node(n, typ).set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result, true
	case ast.KindExpressionWithTypeArguments:
		typ := "TSInstantiationExpression"
		if parent != nil {
			switch parent.Kind {
			case ast.KindInterfaceDeclaration:
				typ = "TSInterfaceHeritage"
			case ast.KindHeritageClause:
				typ = "TSClassImplements"
			}
		}
		withArguments := n.AsExpressionWithTypeArguments()
		result := c.node(n, typ).set("expression", c.convertChild(withArguments.Expression, n))
		if typeArguments := c.convertTypeArguments(withArguments.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result, true
	}
	return nil, false
}

func (c *converter) convertMappedAndPredicateTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindMappedType:
		mapped := n.AsMappedTypeNode()
		parameter := mapped.TypeParameter.AsTypeParameterDeclaration()
		result := c.node(n, "TSMappedType").
			set("constraint", c.convertChild(parameter.Constraint, mapped.TypeParameter)).
			set("key", c.convertChild(mapped.TypeParameter.Name(), mapped.TypeParameter)).
			set("nameType", c.convertChild(mapped.NameType, n))
		if mapped.QuestionToken != nil {
			if mapped.QuestionToken.Kind == ast.KindQuestionToken {
				result.set("optional", true)
			} else {
				result.set("optional", tokenText(mapped.QuestionToken.Kind))
			}
		} else {
			result.set("optional", false)
		}
		if mapped.ReadonlyToken != nil {
			if mapped.ReadonlyToken.Kind == ast.KindReadonlyKeyword {
				result.set("readonly", true)
			} else {
				result.set("readonly", tokenText(mapped.ReadonlyToken.Kind))
			}
		}
		if mapped.Type != nil {
			result.set("typeAnnotation", c.convertChild(mapped.Type, n))
		}
		return result, true
	case ast.KindTypePredicate:
		predicate := n.AsTypePredicateNode()
		result := c.node(n, "TSTypePredicate").
			set("asserts", predicate.AssertsModifier != nil).
			set("parameterName", c.convertChild(predicate.ParameterName, n)).
			set("typeAnnotation", nil)
		if predicate.Type != nil {
			annotation := c.convertTypeAnnotation(predicate.Type, n)
			inner := annotation.get("typeAnnotation").(*obj)
			annotation.setRange(inner.rng())
			result.set("typeAnnotation", annotation)
		}
		return result, true
	}
	return nil, false
}

func (c *converter) convertTupleAndJSDocTypeNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindTupleType:
		return c.node(n, "TSTupleType").set("elementTypes", c.convertChildren(listNodes(n.AsTupleTypeNode().Elements), n)), true
	case ast.KindNamedTupleMember:
		named := n.AsNamedTupleMember()
		member := c.node(n, "TSNamedTupleMember").
			set("elementType", c.convertChild(named.Type, n)).
			set("label", c.convertChild(n.Name(), n)).
			set("optional", named.QuestionToken != nil)
		if named.DotDotDotToken != nil {
			r := member.rng()
			r.start = member.get("label").(*obj).rng().start
			member.setRange(r)
			return c.node(n, "TSRestType").set("typeAnnotation", member), true
		}
		return member, true
	case ast.KindJSDocAllType:
		location := span{scanner.SkipTriviaEx(c.text, n.Pos(), &scanner.SkipTriviaOptions{StopAtComments: true}), n.End()}
		return c.nodeAt(location, "TSJSDocAllType").set("id", 0), true
	case ast.KindJSDocNullableType, ast.KindJSDocNonNullableType:
		kind := "TSJSDocNullableType"
		if n.Kind == ast.KindJSDocNonNullableType {
			kind = "TSJSDocNonNullableType"
		}
		child := n.Type()
		// Match the stock parser's generic JSDoc-node ranges.
		location := span{scanner.SkipTriviaEx(c.text, n.Pos(), &scanner.SkipTriviaOptions{StopAtComments: true}), n.End()}
		annotation := c.nodeAt(span{child.Pos() - 1, child.End()}, "TSTypeAnnotation").set("typeAnnotation", c.convertChild(child, n))
		return c.nodeAt(location, kind).set("id", 0).set("postfix", c.rangeOf(n).start == c.rangeOf(child).start).set("typeAnnotation", annotation), true
	case ast.KindOptionalType:
		return c.node(n, "TSOptionalType").set("typeAnnotation", c.convertChild(n.Type(), n)), true
	case ast.KindRestType:
		return c.node(n, "TSRestType").set("typeAnnotation", c.convertChild(n.Type(), n)), true
	case ast.KindTemplateLiteralType:
		template := n.AsTemplateLiteralTypeNode()
		quasis := []any{c.templateElement(template.Head, false)}
		types := []any{}
		for _, templateSpan := range listNodes(template.TemplateSpans) {
			s := templateSpan.AsTemplateLiteralTypeSpan()
			types = append(types, c.convertChild(s.Type, templateSpan))
			quasis = append(quasis, c.templateElement(s.Literal, false))
		}
		return c.node(n, "TSTemplateLiteralType").set("quasis", quasis).set("types", types), true
	}
	return nil, false
}

func (c *converter) convertImportType(n *ast.Node) *obj {
	importType := n.AsImportTypeNode()
	r := c.rangeOf(n)
	if importType.IsTypeOf {
		first, _ := c.tokenAfter(n.Pos())
		next, _ := c.tokenAfter(first.end)
		r.start = next.start
	}
	var options any
	if importType.Attributes != nil {
		attributes := importType.Attributes.AsImportAttributes()
		properties := []any{}
		for _, attribute := range listNodes(attributes.Attributes) {
			a := attribute.AsImportAttribute()
			properties = append(properties, c.node(attribute, "Property").
				set("computed", false).
				set("key", c.convertChild(a.Name(), attribute)).
				set("kind", "init").
				set("method", false).
				set("optional", false).
				set("shorthand", false).
				set("value", c.convertChild(a.Value, attribute)))
		}
		value := c.node(importType.Attributes, "ObjectExpression").set("properties", properties)
		comma, _ := c.tokenAfter(importType.Argument.End())
		openBrace, _ := c.tokenAfter(comma.end)
		withToken, withKind := c.tokenAfter(openBrace.end)
		afterAttributes, afterKind := c.tokenAfter(importType.Attributes.End())
		closeBrace := afterAttributes
		if afterKind == ast.KindCommaToken {
			closeBrace, _ = c.tokenAfter(afterAttributes.end)
		}
		name := "with"
		if withKind == ast.KindAssertKeyword {
			name = "assert"
		}
		options = c.nodeAt(span{openBrace.start, closeBrace.end}, "ObjectExpression").set("properties", []any{
			c.nodeAt(span{withToken.start, importType.Attributes.End()}, "Property").
				set("computed", false).
				set("key", identifierShape(c.nodeAt(withToken, "Identifier"), name)).
				set("kind", "init").
				set("method", false).
				set("optional", false).
				set("shorthand", false).
				set("value", value),
		})
	}
	argument := c.convertChild(importType.Argument, n)
	var source any
	if argument != nil {
		source = argument.get("literal")
	}
	var typeArguments any
	if t := c.convertTypeArguments(importType.TypeArguments, n); t != nil {
		typeArguments = t
	}
	result := c.nodeAt(r, "TSImportType").
		set("options", options).
		set("qualifier", c.convertChild(importType.Qualifier, n)).
		set("source", source).
		set("typeArguments", typeArguments)
	if importType.IsTypeOf {
		return c.node(n, "TSTypeQuery").set("exprName", result)
	}
	return result
}
