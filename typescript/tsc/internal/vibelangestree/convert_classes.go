package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func (c *converter) convertClassMemberNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindPropertyDeclaration:
		property := n.AsPropertyDeclaration()
		isAbstract := hasModifier(ast.KindAbstractKeyword, n)
		isAccessor := hasModifier(ast.KindAccessorKeyword, n)
		typ := "PropertyDefinition"
		switch {
		case isAccessor && isAbstract:
			typ = "TSAbstractAccessorProperty"
		case isAccessor:
			typ = "AccessorProperty"
		case isAbstract:
			typ = "TSAbstractPropertyDefinition"
		}
		key := c.convertChild(n.Name(), n)
		name := n.Name()
		optional := (key.typ() == "Literal" || name.Kind == ast.KindIdentifier || name.Kind == ast.KindComputedPropertyName || name.Kind == ast.KindPrivateIdentifier) &&
			n.QuestionToken() != nil
		result := c.node(n, typ)
		setAccessibility(result, n)
		result.set("computed", isComputed(name)).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("decorators", c.convertChildren(decorators(n), n)).
			set("definite", property.PostfixToken != nil && property.PostfixToken.Kind == ast.KindExclamationToken).
			set("key", key).
			set("optional", optional).
			set("override", hasModifier(ast.KindOverrideKeyword, n)).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n))
		if property.Type != nil {
			result.set("typeAnnotation", c.convertTypeAnnotation(property.Type, n))
		}
		if isAbstract {
			result.set("value", nil)
		} else {
			result.set("value", c.convertChild(property.Initializer, n))
		}
		if c.synthesized(n) {
			result.set("synthesized", true)
		}
		return result, true
	case ast.KindGetAccessor, ast.KindSetAccessor:
		if parent != nil && (parent.Kind == ast.KindInterfaceDeclaration || parent.Kind == ast.KindTypeLiteral) {
			return c.convertMethodSignature(n), true
		}
		return c.convertMethod(n, parent), true
	case ast.KindMethodDeclaration:
		return c.convertMethod(n, parent), true
	case ast.KindConstructor:
		return c.convertConstructor(n), true
	}
	return nil, false
}

func (c *converter) convertMethodSignature(n *ast.Node) *obj {
	kind := "method"
	switch n.Kind {
	case ast.KindGetAccessor:
		kind = "get"
	case ast.KindSetAccessor:
		kind = "set"
	}
	result := c.node(n, "TSMethodSignature")
	setAccessibility(result, n)
	result.set("computed", isComputed(n.Name())).
		set("key", c.convertChild(n.Name(), n)).
		set("kind", kind).
		set("optional", n.QuestionToken() != nil).
		set("params", c.convertParameters(n.ParameterList(), n)).
		set("readonly", hasModifier(ast.KindReadonlyKeyword, n))
	setReturnType(result, c, n)
	result.set("static", hasModifier(ast.KindStaticKeyword, n))
	setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
	return result
}

func (c *converter) convertMethod(n *ast.Node, parent *ast.Node) *obj {
	body := n.Body()
	typ := "FunctionExpression"
	if body == nil {
		typ = "TSEmptyBodyFunctionExpression"
	}
	method := c.nodeAt(span{n.ParameterList().Pos() - 1, n.End()}, typ).
		set("async", hasModifier(ast.KindAsyncKeyword, n)).
		set("body", c.convertChild(body, n)).
		set("declare", false).
		set("expression", false).
		set("generator", asteriskOf(n)).
		set("id", nil).
		set("params", []any{})
	setReturnType(method, c, n)
	typeParameters := c.convertTypeParameters(n.TypeParameterList(), n)
	setTypeParameters(method, typeParameters)
	if typeParameters != nil {
		fixParentLocation(method, typeParameters.rng())
	}
	var result *obj
	if parent != nil && parent.Kind == ast.KindObjectLiteralExpression {
		method.set("params", c.convertChildren(n.Parameters(), n))
		result = c.node(n, "Property").
			set("computed", isComputed(n.Name())).
			set("key", c.convertChild(n.Name(), n)).
			set("kind", "init").
			set("method", n.Kind == ast.KindMethodDeclaration).
			set("optional", n.QuestionToken() != nil).
			set("shorthand", false).
			set("value", method)
	} else {
		method.set("params", c.convertParameters(n.ParameterList(), n))
		typ := "MethodDefinition"
		if hasModifier(ast.KindAbstractKeyword, n) {
			typ = "TSAbstractMethodDefinition"
		}
		result = c.node(n, typ)
		setAccessibility(result, n)
		result.set("computed", isComputed(n.Name())).
			set("decorators", c.convertChildren(decorators(n), n)).
			set("key", c.convertChild(n.Name(), n)).
			set("kind", "method").
			set("optional", n.QuestionToken() != nil).
			set("override", hasModifier(ast.KindOverrideKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n)).
			set("value", method)
	}
	switch {
	case n.Kind == ast.KindGetAccessor:
		result.set("kind", "get")
	case n.Kind == ast.KindSetAccessor:
		result.set("kind", "set")
	case result.get("static") == false && n.Name().Kind == ast.KindStringLiteral && n.Name().Text() == "constructor" && result.typ() != "Property":
		result.set("kind", "constructor")
	}
	if c.synthesized(n) {
		result.set("synthesized", true)
	}
	return result
}

func (c *converter) convertConstructor(n *ast.Node) *obj {
	mods := modifiers(n)
	var tokenRange span
	var tokenKind ast.Kind
	if len(mods) != 0 {
		tokenRange, tokenKind = c.tokenAfter(mods[len(mods)-1].End())
	} else {
		tokenRange, tokenKind = c.tokenAfter(n.Pos())
	}
	typ := "FunctionExpression"
	if n.Body() == nil {
		typ = "TSEmptyBodyFunctionExpression"
	}
	constructor := c.nodeAt(span{n.ParameterList().Pos() - 1, n.End()}, typ).
		set("async", false).
		set("body", c.convertChild(n.Body(), n)).
		set("declare", false).
		set("expression", false).
		set("generator", false).
		set("id", nil).
		set("params", c.convertParameters(n.ParameterList(), n))
	setReturnType(constructor, c, n)
	typeParameters := c.convertTypeParameters(n.TypeParameterList(), n)
	setTypeParameters(constructor, typeParameters)
	if typeParameters != nil {
		fixParentLocation(constructor, typeParameters.rng())
	}
	var key *obj
	if tokenKind == ast.KindStringLiteral {
		key = c.nodeAt(tokenRange, "Literal").set("raw", c.text[tokenRange.start:tokenRange.end]).set("value", "constructor")
	} else {
		key = identifierShape(c.nodeAt(tokenRange, "Identifier"), "constructor")
	}
	isStatic := hasModifier(ast.KindStaticKeyword, n)
	typ = "MethodDefinition"
	if hasModifier(ast.KindAbstractKeyword, n) {
		typ = "TSAbstractMethodDefinition"
	}
	kind := "constructor"
	if isStatic {
		kind = "method"
	}
	result := c.node(n, typ)
	if c.synthesized(n) {
		result.set("synthesized", true)
	}
	setAccessibility(result, n)
	return result.set("computed", false).
		set("decorators", []any{}).
		set("key", key).
		set("kind", kind).
		set("optional", false).
		set("override", false).
		set("static", isStatic).
		set("value", constructor)
}

func (c *converter) convertClassHeritage(n *ast.Node, data *ast.ClassLikeBase) (*ast.Node, []any) {
	var extendsType *ast.Node
	var implementsClause *ast.Node
	for _, clause := range listNodes(data.HeritageClauses) {
		heritage := clause.AsHeritageClause()
		switch heritage.Token {
		case ast.KindExtendsKeyword:
			if extendsType == nil {
				for _, t := range listNodes(heritage.Types) {
					extendsType = t
					break
				}
			}
		case ast.KindImplementsKeyword:
			if implementsClause == nil {
				implementsClause = clause
			}
		}
	}
	implements := []any{}
	if implementsClause != nil {
		for _, t := range listNodes(implementsClause.AsHeritageClause().Types) {
			implements = append(implements, c.convertHeritage(t, implementsClause, "TSClassImplements"))
		}
	}
	return extendsType, implements
}

func (c *converter) convertClassBodyAndSuper(n *ast.Node, data *ast.ClassLikeBase, extendsType *ast.Node) (*obj, *ast.Node, *ast.Node) {
	var members []*ast.Node
	for _, member := range listNodes(data.Members) {
		if member.Kind != ast.KindSemicolonClassElement {
			members = append(members, member)
		}
	}
	// service Search: SearchApi (D281) is class Search, whose superclass is
	// the Context key VibeLang derives, with the written shape as that
	// superclass's type argument, so scope analysis reads the shape's names.
	var shape *ast.Node
	if c.vibe && extendsType != nil && isSynthesizedIdentifier(extendsType.Expression(), parser.ServiceShapeFactory) {
		shape, extendsType = extendsType, nil
	}
	if fields, ok := c.errorFields(extendsType); ok {
		// error X { fields } is class X extends TaggedError("X")<{ fields }> {}
		// to the checker and class X { fields } to a rule.
		return c.errorBody(n, fields), nil, shape
	}
	if c.synthesized(extendsType) {
		extendsType = nil // control X's Control base
	}
	body := c.nodeAt(span{data.Members.Pos() - 1, n.End()}, "ClassBody").set("body", c.convertChildren(members, n))
	return body, extendsType, shape
}

func (c *converter) convertClass(n *ast.Node) *obj {
	if result := c.errorClass(n); result != nil {
		return result // an error written with a class's features (D278), or a schema error (D279)
	}
	data := n.ClassLikeData()
	typ := "ClassDeclaration"
	if n.Kind == ast.KindClassExpression {
		typ = "ClassExpression"
	}
	extendsType, implements := c.convertClassHeritage(n, data)
	body, extendsType, shape := c.convertClassBodyAndSuper(n, data, extendsType)
	result := c.node(n, typ).
		set("abstract", hasModifier(ast.KindAbstractKeyword, n)).
		set("body", body).
		set("declare", hasModifier(ast.KindDeclareKeyword, n)).
		set("decorators", c.convertChildren(decorators(n), n)).
		set("id", c.convertChild(n.Name(), n)).
		set("implements", implements)
	if extendsType != nil {
		result.set("superClass", c.convertChild(extendsType.Expression(), extendsType))
	} else {
		result.set("superClass", nil)
	}
	setTypeParameters(result, c.convertTypeParameters(data.TypeParameters, n))
	if extendsType == nil {
		extendsType = shape
	}
	if extendsType != nil {
		if typeArguments := c.convertTypeArguments(extendsType.AsExpressionWithTypeArguments().TypeArguments, extendsType); typeArguments != nil {
			result.set("superTypeArguments", typeArguments)
		}
	}
	return c.fixExports(n, result)
}
