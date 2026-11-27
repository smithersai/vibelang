package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func (c *converter) convertPatternOrParamNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindArrayBindingPattern:
		elements := listNodes(n.AsBindingPattern().Elements)
		converted := make([]any, 0, len(elements))
		for _, element := range elements {
			converted = append(converted, c.convertPattern(element, n))
		}
		return c.node(n, "ArrayPattern").
			set("decorators", []any{}).
			set("elements", converted).
			set("optional", false), true
	case ast.KindOmittedExpression:
		return nil, true
	case ast.KindObjectBindingPattern:
		elements := listNodes(n.AsBindingPattern().Elements)
		converted := make([]any, 0, len(elements))
		for _, element := range elements {
			converted = append(converted, c.convertPattern(element, n))
		}
		return c.node(n, "ObjectPattern").
			set("decorators", []any{}).
			set("optional", false).
			set("properties", converted), true
	case ast.KindBindingElement:
		return c.convertBindingElement(n, parent), true
	case ast.KindParameter:
		return c.convertParameter(n, parent), true
	}
	return nil, false
}

func (c *converter) convertBindingElement(n *ast.Node, parent *ast.Node) *obj {
	element := n.AsBindingElement()
	if parent != nil && parent.Kind == ast.KindArrayBindingPattern {
		item := c.convertChild(n.Name(), parent)
		if element.Initializer != nil {
			return c.node(n, "AssignmentPattern").
				set("decorators", []any{}).
				set("left", item).
				set("optional", false).
				set("right", c.convertChild(element.Initializer, n))
		}
		if element.DotDotDotToken != nil {
			return c.node(n, "RestElement").
				set("argument", item).
				set("decorators", []any{}).
				set("optional", false)
		}
		return item
	}
	var result *obj
	if element.DotDotDotToken != nil {
		argument := element.PropertyName
		if argument == nil {
			argument = n.Name()
		}
		result = c.node(n, "RestElement").
			set("argument", c.convertChild(argument, n)).
			set("decorators", []any{}).
			set("optional", false)
	} else {
		key := element.PropertyName
		if key == nil {
			key = n.Name()
		}
		result = c.node(n, "Property").
			set("computed", element.PropertyName != nil && element.PropertyName.Kind == ast.KindComputedPropertyName).
			set("key", c.convertChild(key, n)).
			set("kind", "init").
			set("method", false).
			set("optional", false).
			set("shorthand", element.PropertyName == nil).
			set("value", c.convertChild(n.Name(), n))
	}
	if element.Initializer != nil {
		result.set("value", c.nodeAt(span{c.start(n.Name()), element.Initializer.End()}, "AssignmentPattern").
			set("decorators", []any{}).
			set("left", c.convertChild(n.Name(), n)).
			set("optional", false).
			set("right", c.convertChild(element.Initializer, n)))
	}
	return result
}

func (c *converter) convertParameter(n *ast.Node, parent *ast.Node) *obj {
	parameter := n.AsParameterDeclaration()
	var param, result *obj
	switch {
	case parameter.DotDotDotToken != nil:
		param = c.node(n, "RestElement").
			set("argument", c.convertChild(n.Name(), n)).
			set("decorators", []any{}).
			set("optional", false)
		result = param
	case parameter.Initializer != nil:
		param = c.convertChild(n.Name(), n)
		result = c.nodeAt(span{c.start(n.Name()), parameter.Initializer.End()}, "AssignmentPattern").
			set("decorators", []any{}).
			set("left", param).
			set("optional", false).
			set("right", c.convertChild(parameter.Initializer, n))
		if len(modifiers(n)) != 0 {
			r := result.rng()
			r.start = param.rng().start
			result.setRange(r)
		}
	default:
		param = c.convertChild(n.Name(), parent)
		result = param
	}
	if parameter.Type != nil {
		annotation := c.convertTypeAnnotation(parameter.Type, n)
		param.set("typeAnnotation", annotation)
		fixParentLocation(param, annotation.rng())
	}
	if parameter.QuestionToken != nil {
		if end := parameter.QuestionToken.End(); end > param.rng().end {
			r := param.rng()
			r.end = end
			param.setRange(r)
		}
		param.set("optional", true)
	}
	if len(modifiers(n)) != 0 {
		property := c.node(n, "TSParameterProperty")
		setAccessibility(property, n)
		return property.set("decorators", []any{}).
			set("override", hasModifier(ast.KindOverrideKeyword, n)).
			set("parameter", result).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n))
	}
	return result
}
