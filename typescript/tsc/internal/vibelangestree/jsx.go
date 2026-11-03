package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// JSX shapes follow typescript-estree's convertJSXTagName and Jsx* cases.
// Names are JSX identifiers only in tag/attribute positions; expressions
// inside containers retain their ordinary TypeScript or VibeLang shapes.
func (c *converter) jsxName(n *ast.Node) *obj {
	switch n.Kind {
	case ast.KindPropertyAccessExpression:
		return c.node(n, "JSXMemberExpression").
			set("object", c.jsxName(n.Expression())).
			set("property", c.jsxName(n.Name()))
	case ast.KindJsxNamespacedName:
		return c.node(n, "JSXNamespacedName").
			set("namespace", c.jsxName(n.AsJsxNamespacedName().Namespace)).
			set("name", c.jsxName(n.Name()))
	default:
		r := c.rangeOf(n)
		return c.node(n, "JSXIdentifier").set("name", c.text[r.start:r.end])
	}
}

func (c *converter) jsxOpening(n *ast.Node, selfClosing bool) *obj {
	var arguments *ast.NodeList
	if selfClosing {
		arguments = n.AsJsxSelfClosingElement().TypeArguments
	} else {
		arguments = n.AsJsxOpeningElement().TypeArguments
	}
	opening := c.node(n, "JSXOpeningElement").
		set("attributes", c.convertChildren(n.Attributes().Properties(), n.Attributes())).
		set("name", c.jsxName(n.TagName())).
		set("selfClosing", selfClosing)
	if args := c.convertTypeArguments(arguments, n); args != nil {
		opening.set("typeArguments", args)
	}
	return opening
}

func (c *converter) convertJSX(n *ast.Node) *obj {
	switch n.Kind {
	case ast.KindJsxElement:
		el := n.AsJsxElement()
		return c.node(n, "JSXElement").
			set("children", c.convertChildren(listNodes(el.Children), n)).
			set("closingElement", c.convertChild(el.ClosingElement, n)).
			set("openingElement", c.convertChild(el.OpeningElement, n))
	case ast.KindJsxSelfClosingElement:
		return c.node(n, "JSXElement").
			set("children", []any{}).
			set("closingElement", nil).
			set("openingElement", c.jsxOpening(n, true))
	case ast.KindJsxOpeningElement:
		return c.jsxOpening(n, false)
	case ast.KindJsxClosingElement:
		return c.node(n, "JSXClosingElement").set("name", c.jsxName(n.TagName()))
	case ast.KindJsxFragment:
		el := n.AsJsxFragment()
		return c.node(n, "JSXFragment").
			set("children", c.convertChildren(listNodes(el.Children), n)).
			set("closingFragment", c.convertChild(el.ClosingFragment, n)).
			set("openingFragment", c.convertChild(el.OpeningFragment, n))
	case ast.KindJsxOpeningFragment:
		return c.node(n, "JSXOpeningFragment")
	case ast.KindJsxClosingFragment:
		return c.node(n, "JSXClosingFragment")
	case ast.KindJsxAttribute:
		return c.node(n, "JSXAttribute").
			set("name", c.jsxName(n.Name())).
			set("value", c.convertChild(n.Initializer(), n))
	case ast.KindJsxSpreadAttribute:
		return c.node(n, "JSXSpreadAttribute").set("argument", c.convertChild(n.Expression(), n))
	case ast.KindJsxExpression:
		jsx := n.AsJsxExpression()
		expression := c.convertChild(jsx.Expression, n)
		if expression == nil {
			expression = c.nodeAt(span{c.start(n) + 1, n.End() - 1}, "JSXEmptyExpression")
		}
		typ := "JSXExpressionContainer"
		if jsx.DotDotDotToken != nil {
			typ = "JSXSpreadChild"
		}
		return c.node(n, typ).set("expression", expression)
	case ast.KindJsxText, ast.KindJsxTextAllWhiteSpaces:
		r := span{n.Pos(), n.End()}
		raw := c.text[r.start:r.end]
		return c.nodeAt(r, "JSXText").set("raw", raw).set("value", decodeJSXEntities(raw))
	}
	return nil
}
