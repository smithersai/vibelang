package vibelangestree

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func (c *converter) convertExpressionNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if result, ok := c.convertPrimaryExpression(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertLiteralExpression(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertCollectionExpression(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertTemplateAndAwaitExpression(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertOperatorExpression(n, parent); ok {
		return result, true
	}
	return c.convertMemberAndCallExpression(n, parent)
}

func (c *converter) convertPrimaryExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindIdentifier:
		if c.isThisInTypeQuery(n, parent) {
			return c.node(n, "ThisExpression"), true
		}
		identifier := identifierShape(c.node(n, "Identifier"), n.Text())
		// A hoisted concurrency limit keeps its source location for checking,
		// but its temporary name still belongs to the compiler.
		if c.synthesized(n) || c.vibe && n.Flags&ast.NodeFlagsVibeLangTemporary != 0 {
			identifier.set("synthesized", true) // a name the parser wrote, which eslint.mjs keeps out of scope analysis
		}
		return identifier, true
	case ast.KindPrivateIdentifier:
		return c.node(n, "PrivateIdentifier").set("name", strings.TrimPrefix(n.Text(), "#")), true
	case ast.KindThisKeyword:
		return c.node(n, "ThisExpression"), true
	case ast.KindSuperKeyword:
		return c.node(n, "Super"), true
	case ast.KindImportKeyword:
		// An import that starts no call, as in `import<A0`, which TypeScript
		// parses as `import < A0` and only its checker rejects: typescript-
		// estree copies the keyword as it copies any node it has no case for,
		// with TypeScript's node id, 0 in a tree no checker has visited.
		return c.node(n, "TSImportKeyword").set("id", 0), true
	case ast.KindParenthesizedExpression:
		return c.converter(n.Expression(), parent, c.allowPattern), true
	case ast.KindMetaProperty:
		meta := n.AsMetaProperty()
		keyword := tokenText(meta.KeywordToken)
		start := c.start(n)
		return c.node(n, "MetaProperty").
			set("meta", identifierShape(c.nodeAt(span{start, start + len(keyword)}, "Identifier"), keyword)).
			set("property", c.convertChild(meta.Name(), n)), true
	case ast.KindNonNullExpression:
		return c.convertChainExpression(c.node(n, "TSNonNullExpression").set("expression", c.convertChild(n.Expression(), n)), n), true
	}
	return nil, false
}

func (c *converter) convertLiteralExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindStringLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		if n.Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
			raw = strconv.Quote(n.Text()) // synthesized at another token: its own text
		}
		value := n.Text()
		if parent != nil && parent.Kind == ast.KindJsxAttribute {
			value = decodeJSXEntities(value)
		}
		return c.node(n, "Literal").set("raw", raw).set("value", value), true
	case ast.KindNumericLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		if n.Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
			raw = n.Text()
		}
		return c.node(n, "Literal").set("raw", raw).set("value", numberValue(raw)), true
	case ast.KindBigIntLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		digits := strings.ReplaceAll(strings.TrimSuffix(raw, "n"), "_", "")
		return c.node(n, "Literal").set("bigint", digits).set("raw", raw).set("value", nil), true
	case ast.KindRegularExpressionLiteral:
		text := n.Text()
		slash := strings.LastIndex(text, "/")
		return c.node(n, "Literal").
			set("raw", text).
			set("regex", (&obj{}).set("flags", text[slash+1:]).set("pattern", text[1:slash])).
			set("value", nil), true
	case ast.KindTrueKeyword:
		return c.node(n, "Literal").set("raw", "true").set("value", true), true
	case ast.KindFalseKeyword:
		return c.node(n, "Literal").set("raw", "false").set("value", false), true
	case ast.KindNullKeyword:
		return c.node(n, "Literal").set("raw", "null").set("value", nil), true
	}
	return nil, false
}

func (c *converter) convertCollectionExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindArrayLiteralExpression:
		elements := listNodes(n.AsArrayLiteralExpression().Elements)
		if c.allowPattern {
			converted := make([]any, 0, len(elements))
			for _, element := range elements {
				converted = append(converted, c.convertPattern(element, n))
			}
			return c.node(n, "ArrayPattern").
				set("decorators", []any{}).
				set("elements", converted).
				set("optional", false), true
		}
		return c.node(n, "ArrayExpression").set("elements", c.convertChildren(elements, n)), true
	case ast.KindObjectLiteralExpression:
		properties := listNodes(n.AsObjectLiteralExpression().Properties)
		if c.allowPattern {
			converted := make([]any, 0, len(properties))
			for _, property := range properties {
				converted = append(converted, c.convertPattern(property, n))
			}
			return c.node(n, "ObjectPattern").
				set("decorators", []any{}).
				set("optional", false).
				set("properties", converted), true
		}
		return c.node(n, "ObjectExpression").set("properties", c.convertChildren(properties, n)), true
	case ast.KindPropertyAssignment:
		assignment := n.AsPropertyAssignment()
		return c.node(n, "Property").
			set("computed", isComputed(n.Name())).
			set("key", c.convertChild(n.Name(), n)).
			set("kind", "init").
			set("method", false).
			set("optional", false).
			set("shorthand", false).
			set("value", c.converter(assignment.Initializer, n, c.allowPattern)), true
	case ast.KindShorthandPropertyAssignment:
		shorthand := n.AsShorthandPropertyAssignment()
		result := c.node(n, "Property").
			set("computed", false).
			set("key", c.convertChild(n.Name(), n)).
			set("kind", "init").
			set("method", false).
			set("optional", false).
			set("shorthand", true)
		if shorthand.ObjectAssignmentInitializer != nil {
			return result.set("value", c.node(n, "AssignmentPattern").
				set("decorators", []any{}).
				set("left", c.convertPattern(n.Name(), n)).
				set("optional", false).
				set("right", c.convertChild(shorthand.ObjectAssignmentInitializer, n))), true
		}
		return result.set("value", c.convertChild(n.Name(), n)), true
	case ast.KindComputedPropertyName:
		return c.convertChild(n.Expression(), n), true
	case ast.KindSpreadAssignment, ast.KindSpreadElement:
		if c.allowPattern {
			return c.node(n, "RestElement").
				set("argument", c.convertPattern(n.Expression(), n)).
				set("decorators", []any{}).
				set("optional", false), true
		}
		return c.node(n, "SpreadElement").set("argument", c.convertChild(n.Expression(), n)), true
	}
	return nil, false
}

func (c *converter) convertTemplateAndAwaitExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindYieldExpression:
		yield := n.AsYieldExpression()
		return c.node(n, "YieldExpression").
			set("argument", c.convertChild(yield.Expression, n)).
			set("delegate", yield.AsteriskToken != nil), true
	case ast.KindAwaitExpression:
		return c.node(n, "AwaitExpression").set("argument", c.convertChild(n.Expression(), n)), true
	case ast.KindNoSubstitutionTemplateLiteral:
		r := c.rangeOf(n)
		raw := c.text[min(r.start+1, r.end):max(r.end-1, r.start+1)]
		var cooked any = n.Text()
		if parent != nil && parent.Kind == ast.KindTaggedTemplateExpression && !isValidEscape(raw) {
			cooked = nil
		}
		element := c.node(n, "TemplateElement").
			set("tail", true).
			set("value", (&obj{}).set("cooked", cooked).set("raw", raw))
		return c.node(n, "TemplateLiteral").set("expressions", []any{}).set("quasis", []any{element}), true
	case ast.KindTemplateExpression:
		template := n.AsTemplateExpression()
		tagged := parent != nil && parent.Kind == ast.KindTaggedTemplateExpression
		expressions := []any{}
		quasis := []any{c.templateElement(template.Head, tagged)}
		for _, templateSpan := range listNodes(template.TemplateSpans) {
			s := templateSpan.AsTemplateSpan()
			expressions = append(expressions, c.convertChild(s.Expression, templateSpan))
			quasis = append(quasis, c.templateElement(s.Literal, tagged))
		}
		return c.node(n, "TemplateLiteral").set("expressions", expressions).set("quasis", quasis), true
	case ast.KindTaggedTemplateExpression:
		tagged := n.AsTaggedTemplateExpression()
		result := c.node(n, "TaggedTemplateExpression").
			set("quasi", c.convertChild(tagged.Template, n)).
			set("tag", c.convertChild(tagged.Tag, n))
		if typeArguments := c.convertTypeArguments(tagged.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result, true
	case ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail:
		return c.templateElement(n, false), true
	}
	return nil, false
}

func (c *converter) convertOperatorExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindPrefixUnaryExpression, ast.KindPostfixUnaryExpression:
		var operator ast.Kind
		var operand *ast.Node
		if n.Kind == ast.KindPrefixUnaryExpression {
			operator, operand = n.AsPrefixUnaryExpression().Operator, n.AsPrefixUnaryExpression().Operand
		} else {
			operator, operand = n.AsPostfixUnaryExpression().Operator, n.AsPostfixUnaryExpression().Operand
		}
		text := tokenText(operator)
		if text == "++" || text == "--" {
			return c.node(n, "UpdateExpression").
				set("argument", c.convertChild(operand, n)).
				set("operator", text).
				set("prefix", n.Kind == ast.KindPrefixUnaryExpression), true
		}
		return c.node(n, "UnaryExpression").
			set("argument", c.convertChild(operand, n)).
			set("operator", text).
			set("prefix", true), true
	case ast.KindDeleteExpression, ast.KindVoidExpression, ast.KindTypeOfExpression:
		operator := map[ast.Kind]string{ast.KindDeleteExpression: "delete", ast.KindVoidExpression: "void", ast.KindTypeOfExpression: "typeof"}[n.Kind]
		return c.node(n, "UnaryExpression").
			set("argument", c.convertChild(n.Expression(), n)).
			set("operator", operator).
			set("prefix", true), true
	case ast.KindBinaryExpression:
		return c.convertBinary(n), true
	case ast.KindConditionalExpression:
		conditional := n.AsConditionalExpression()
		return c.node(n, "ConditionalExpression").
			set("alternate", c.convertChild(conditional.WhenFalse, n)).
			set("consequent", c.convertChild(conditional.WhenTrue, n)).
			set("test", c.convertChild(conditional.Condition, n)), true
	case ast.KindAsExpression:
		as := n.AsAsExpression()
		return c.node(n, "TSAsExpression").
			set("expression", c.convertChild(as.Expression, n)).
			set("typeAnnotation", c.convertChild(as.Type, n)), true
	case ast.KindTypeAssertionExpression:
		assertion := n.AsTypeAssertion()
		return c.node(n, "TSTypeAssertion").
			set("expression", c.convertChild(assertion.Expression, n)).
			set("typeAnnotation", c.convertChild(assertion.Type, n)), true
	case ast.KindSatisfiesExpression:
		satisfies := n.AsSatisfiesExpression()
		return c.node(n, "TSSatisfiesExpression").
			set("expression", c.convertChild(satisfies.Expression, n)).
			set("typeAnnotation", c.convertChild(satisfies.Type, n)), true
	}
	return nil, false
}

func (c *converter) convertMemberAndCallExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindPropertyAccessExpression:
		access := n.AsPropertyAccessExpression()
		object := c.convertChild(access.Expression, n)
		property := c.convertChild(access.Name(), n)
		result := c.node(n, "MemberExpression").
			set("computed", false).
			set("object", object).
			set("optional", access.QuestionDotToken != nil).
			set("property", property)
		if c.synthesized(n) || (c.vibe && access.Expression != nil && (synthesized(access.Expression) || access.Expression.Flags&ast.NodeFlagsVibeLangTemporary != 0)) {
			result.set("synthesized", true)
		}
		return c.convertChainExpression(result, n), true
	case ast.KindElementAccessExpression:
		access := n.AsElementAccessExpression()
		object := c.convertChild(access.Expression, n)
		property := c.convertChild(access.ArgumentExpression, n)
		result := c.node(n, "MemberExpression").
			set("computed", true).
			set("object", object).
			set("optional", access.QuestionDotToken != nil).
			set("property", property)
		if c.synthesized(n) || (c.vibe && access.Expression != nil && (synthesized(access.Expression) || access.Expression.Flags&ast.NodeFlagsVibeLangTemporary != 0)) {
			result.set("synthesized", true)
		}
		return c.convertChainExpression(result, n), true
	case ast.KindCallExpression:
		return c.convertCall(n), true
	case ast.KindNewExpression:
		newExpression := n.AsNewExpression()
		typeArguments := c.convertTypeArguments(newExpression.TypeArguments, n)
		result := c.node(n, "NewExpression").
			set("arguments", c.convertChildren(listNodes(newExpression.Arguments), n)).
			set("callee", c.convertChild(newExpression.Expression, n))
		if typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result, true
	}
	return nil, false
}

func (c *converter) convertBinary(n *ast.Node) *obj {
	binary := n.AsBinaryExpression()
	operator := binary.OperatorToken.Kind
	if operator == ast.KindCommaToken {
		result := c.node(n, "SequenceExpression")
		expressions := []any{}
		left := c.convertChild(binary.Left, n)
		if left.typ() == "SequenceExpression" && binary.Left.Kind != ast.KindParenthesizedExpression {
			expressions = append(expressions, left.get("expressions").([]any)...)
		} else {
			expressions = append(expressions, left)
		}
		expressions = append(expressions, c.convertChild(binary.Right, n))
		result.set("expressions", expressions)
		if c.vibe {
			for _, item := range expressions {
				if expr, ok := item.(*obj); ok && !expr.isSynthesized() {
					fixParentLocation(result, expr.rng())
				}
			}
		}
		return result
	}
	typ, ok := binaryType(operator)
	if !ok {
		return c.fail(binary.OperatorToken)
	}
	if c.allowPattern && typ == "AssignmentExpression" {
		return c.node(n, "AssignmentPattern").
			set("decorators", []any{}).
			set("left", c.convertPattern(binary.Left, n)).
			set("optional", false).
			set("right", c.convertChild(binary.Right, n))
	}
	left := c.converter(binary.Left, n, typ == "AssignmentExpression")
	right := c.convertChild(binary.Right, n)
	result := c.node(n, typ).
		set("operator", tokenText(operator)).
		set("left", left).
		set("right", right)
	if c.vibe {
		if left != nil && !left.isSynthesized() {
			fixParentLocation(result, left.rng())
		}
		if right != nil && !right.isSynthesized() {
			fixParentLocation(result, right.rng())
		}
	}
	return result
}

func (c *converter) convertCall(n *ast.Node) *obj {
	call := n.AsCallExpression()
	arguments := listNodes(call.Arguments)
	var phase any
	isImport := false
	switch call.Expression.Kind {
	case ast.KindImportKeyword:
		isImport = true
	case ast.KindMetaProperty:
		meta := call.Expression.AsMetaProperty()
		if meta.KeywordToken == ast.KindImportKeyword && meta.Name().Text() == "defer" {
			isImport = true
			phase = "defer"
		}
	}
	if isImport {
		var options, source any
		if len(arguments) > 1 {
			options = c.convertChild(arguments[1], n)
		}
		if len(arguments) > 0 {
			source = c.convertChild(arguments[0], n)
		}
		return c.node(n, "ImportExpression").set("options", options).set("phase", phase).set("source", source)
	}
	callee := c.convertChild(call.Expression, n)
	args := c.convertChildren(arguments, n)
	typeArguments := c.convertTypeArguments(call.TypeArguments, n)
	result := c.node(n, "CallExpression").
		set("arguments", args).
		set("callee", callee).
		set("optional", call.QuestionDotToken != nil)
	if typeArguments != nil {
		result.set("typeArguments", typeArguments)
	}
	if c.vibe {
		if callee != nil && !callee.isSynthesized() {
			fixParentLocation(result, callee.rng())
		}
		for _, item := range args {
			if arg, ok := item.(*obj); ok && !arg.isSynthesized() {
				fixParentLocation(result, arg.rng())
			}
		}
	}
	return c.convertChainExpression(result, n)
}
