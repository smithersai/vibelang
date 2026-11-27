package vibelangestree

import (
	"math"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// ---------------------------------------------------------------- shared shapes

func identifierShape(o *obj, name string) *obj {
	return o.set("decorators", []any{}).set("name", name).set("optional", false)
}

func (c *converter) convertBindingNameWithTypeAnnotation(name *ast.Node, typeNode *ast.Node, parent *ast.Node) *obj {
	id := c.convertPattern(name, nil)
	if typeNode != nil && id != nil {
		annotation := c.convertTypeAnnotation(typeNode, parent)
		id.set("typeAnnotation", annotation)
		fixParentLocation(id, annotation.rng())
	}
	return id
}

// canContainDirective reports whether the statements of container, whose
// parent is containerParent, may begin with directives.
func canContainDirective(container *ast.Node, containerParent *ast.Node) bool {
	if container.Kind == ast.KindBlock {
		if containerParent == nil {
			return false
		}
		switch containerParent.Kind {
		case ast.KindConstructor, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindArrowFunction,
			ast.KindFunctionExpression, ast.KindFunctionDeclaration, ast.KindMethodDeclaration:
			return true
		}
		return false
	}
	return true
}

func (c *converter) convertBodyExpressions(statements []*ast.Node, container *ast.Node, containerParent *ast.Node) []any {
	allowDirectives := canContainDirective(container, containerParent)
	out := make([]any, 0, len(statements))
	for _, statement := range statements {
		if c.skipStatement(statement) {
			continue
		}
		child := c.convertChild(statement, container)
		if allowDirectives {
			if child != nil && statement.Kind == ast.KindExpressionStatement && statement.Expression().Kind == ast.KindStringLiteral {
				if expression, ok := child.get("expression").(*obj); ok {
					raw, _ := expression.get("raw").(string)
					if len(raw) >= 2 {
						child.set("directive", raw[1:len(raw)-1])
					}
					out = append(out, child)
					continue
				}
			}
			allowDirectives = false
		}
		if child != nil {
			out = append(out, child)
		}
	}
	return out
}

func (c *converter) convertChainExpression(result *obj, tsNode *ast.Node) *obj {
	var child *obj
	optional := false
	switch result.typ() {
	case "MemberExpression":
		child, _ = result.get("object").(*obj)
		optional, _ = result.get("optional").(bool)
	case "CallExpression":
		child, _ = result.get("callee").(*obj)
		optional, _ = result.get("optional").(bool)
	default:
		child, _ = result.get("expression").(*obj)
	}
	unwrappable := child.typ() == "ChainExpression" && tsNode.Expression().Kind != ast.KindParenthesizedExpression
	if !unwrappable && !optional {
		return result
	}
	if unwrappable {
		inner := child.get("expression")
		switch result.typ() {
		case "MemberExpression":
			result.set("object", inner)
		case "CallExpression":
			result.set("callee", inner)
		default:
			result.set("expression", inner)
		}
	}
	return c.node(tsNode, "ChainExpression").set("expression", result)
}

// convertTypeAnnotation wraps child in a TSTypeAnnotation whose range starts
// at the colon, or at the arrow of a function or constructor type.
func (c *converter) convertTypeAnnotation(child *ast.Node, parent *ast.Node) *obj {
	offset := 1
	if parent != nil && (parent.Kind == ast.KindFunctionType || parent.Kind == ast.KindConstructorType) {
		offset = 2
	}
	r := span{child.Pos() - offset, child.End()}
	if r.start < 0 || !c.annotationStartsAt(r.start, offset) {
		// A synthesized type has no colon before it.
		r = c.rangeOf(child)
	}
	return c.nodeAt(r, "TSTypeAnnotation").set("typeAnnotation", c.convertChild(child, parent))
}

func (c *converter) annotationStartsAt(pos int, offset int) bool {
	if pos+offset > len(c.text) {
		return false
	}
	if offset == 2 {
		return c.text[pos:pos+2] == "=>"
	}
	return c.text[pos] == ':'
}

// typeListRange returns the range of <list>, from the < before the list to
// the > after it.
func (c *converter) typeListRange(list *ast.NodeList) span {
	open := list.Pos() - 1
	closeRange, kind := c.tokenAfter(list.End())
	if open < 0 || open >= len(c.text) || c.text[open] != '<' || (kind != ast.KindGreaterThanToken && !strings.HasPrefix(c.text[closeRange.start:], ">")) {
		// A synthesized list: the range of its elements.
		r := span{math.MaxInt, 0}
		for _, n := range list.Nodes {
			nr := c.rangeOf(n)
			r.start = min(r.start, nr.start)
			r.end = max(r.end, nr.end)
		}
		if r.start == math.MaxInt {
			r = span{max(list.Pos(), 0), max(list.Pos(), 0)}
		}
		return r
	}
	return span{open, closeRange.start + 1}
}

func (c *converter) convertTypeArguments(list *ast.NodeList, parent *ast.Node) *obj {
	if list == nil {
		return nil
	}
	nodes := c.typeArgumentNodes(list)
	if len(nodes) == 0 {
		if len(list.Nodes) == 0 {
			return c.syntaxFail(max(list.Pos()-1, 0), "Type argument list cannot be empty.")
		}
		return nil
	}
	return c.nodeAt(c.typeListRange(list), "TSTypeParameterInstantiation").set("params", c.convertChildren(nodes, parent))
}

func (c *converter) convertTypeParameters(list *ast.NodeList, parent *ast.Node) *obj {
	if list == nil {
		return nil
	}
	if len(list.Nodes) == 0 {
		return c.syntaxFail(max(list.Pos()-1, 0), "Type parameter list cannot be empty.")
	}
	return c.nodeAt(c.typeListRange(list), "TSTypeParameterDeclaration").set("params", c.convertChildren(list.Nodes, parent))
}

func setTypeParameters(o *obj, typeParameters *obj) {
	if typeParameters != nil {
		o.set("typeParameters", typeParameters)
	}
}

func (c *converter) convertParameters(list *ast.NodeList, parent *ast.Node) []any {
	out := []any{}
	for _, param := range listNodes(list) {
		converted := c.convertChild(param, parent)
		if converted != nil {
			converted.set("decorators", c.convertChildren(decorators(param), param))
		}
		out = append(out, converted)
	}
	return out
}

func setReturnType(o *obj, c *converter, n *ast.Node) {
	if t := n.Type(); t != nil {
		o.set("returnType", c.convertTypeAnnotation(t, n))
	}
}

// fixExports wraps result in the export declaration its modifiers make.
func (c *converter) fixExports(n *ast.Node, result *obj) *obj {
	mods := modifiers(n)
	if n.Kind == ast.KindModuleDeclaration && n.Name() != nil && n.Name().Kind != ast.KindStringLiteral {
		mods = namespaceModifiers(n)
	}
	if len(mods) == 0 || mods[0].Kind != ast.KindExportKeyword {
		return result
	}
	exportKeyword := mods[0]
	isDefault := len(mods) > 1 && mods[1].Kind == ast.KindDefaultKeyword
	previous := exportKeyword
	if isDefault {
		previous = mods[1]
	}
	next, _ := c.tokenAfter(previous.End())
	r := result.rng()
	r.start = next.start
	result.setRange(r)
	exportStart := c.start(exportKeyword)
	if isDefault {
		return c.nodeAt(span{exportStart, r.end}, "ExportDefaultDeclaration").
			set("declaration", result).
			set("exportKind", "value")
	}
	exportKind := "value"
	switch result.typ() {
	case "TSInterfaceDeclaration", "TSTypeAliasDeclaration":
		exportKind = "type"
	}
	if declare, _ := result.get("declare").(bool); declare {
		exportKind = "type"
	}
	return c.nodeAt(span{exportStart, r.end}, "ExportNamedDeclaration").
		set("attributes", []any{}).
		set("declaration", result).
		set("exportKind", exportKind).
		set("source", nil).
		set("specifiers", []any{})
}

func namespaceModifiers(n *ast.Node) []*ast.Node {
	mods := modifiers(n)
	declaration := n
	for len(mods) == 0 && declaration.Parent != nil && declaration.Parent.Kind == ast.KindModuleDeclaration {
		if parentModifiers := modifiers(declaration.Parent); len(parentModifiers) != 0 {
			mods = parentModifiers
		}
		declaration = declaration.Parent
	}
	return mods
}

// ---------------------------------------------------------------- literals

// isValidEscape reports whether a tagged template's raw text has a cooked
// value, as typescript-estree's #isValidEscape decides: every \u is followed
// by four hex digits or {, and every \x by two hex digits.
func isValidEscape(text string) bool {
	hex := func(i int) bool {
		return i < len(text) && (text[i] >= '0' && text[i] <= '9' || text[i] >= 'a' && text[i] <= 'f' || text[i] >= 'A' && text[i] <= 'F')
	}
	for i := 0; i+1 < len(text); i++ {
		if text[i] != '\\' {
			continue
		}
		switch text[i+1] {
		case 'u':
			if !(i+2 < len(text) && text[i+2] == '{') && !(hex(i+2) && hex(i+3) && hex(i+4) && hex(i+5)) {
				return false
			}
		case 'x':
			if !(hex(i+2) && hex(i+3)) {
				return false
			}
		}
	}
	return true
}

func numberValue(text string) any {
	cleaned := strings.ReplaceAll(text, "_", "")
	var value float64
	var err error
	switch {
	case len(cleaned) > 2 && (cleaned[1] == 'x' || cleaned[1] == 'X') && cleaned[0] == '0':
		var u uint64
		u, err = strconv.ParseUint(cleaned[2:], 16, 64)
		value = float64(u)
		if err != nil {
			value, err = parseBigFloat(cleaned[2:], 16)
		}
	case len(cleaned) > 2 && (cleaned[1] == 'o' || cleaned[1] == 'O') && cleaned[0] == '0':
		value, err = parseBigFloat(cleaned[2:], 8)
	case len(cleaned) > 2 && (cleaned[1] == 'b' || cleaned[1] == 'B') && cleaned[0] == '0':
		value, err = parseBigFloat(cleaned[2:], 2)
	default:
		value, err = strconv.ParseFloat(cleaned, 64)
	}
	if err != nil && !math.IsInf(value, 0) {
		return nil
	}
	if math.IsInf(value, 0) || math.IsNaN(value) {
		// JSON has no Infinity; the JavaScript side recomputes it from raw.
		return nil
	}
	return value
}

func parseBigFloat(digits string, base int) (float64, error) {
	value := 0.0
	for _, d := range digits {
		var v int
		switch {
		case d >= '0' && d <= '9':
			v = int(d - '0')
		case d >= 'a' && d <= 'f':
			v = int(d-'a') + 10
		case d >= 'A' && d <= 'F':
			v = int(d-'A') + 10
		default:
			return 0, strconv.ErrSyntax
		}
		if v >= base {
			return 0, strconv.ErrSyntax
		}
		value = value*float64(base) + float64(v)
	}
	return value, nil
}

func tokenText(kind ast.Kind) string {
	return scanner.TokenToString(kind)
}

// ---------------------------------------------------------------- operators

func binaryType(operator ast.Kind) (string, bool) {
	switch operator {
	case ast.KindAmpersandAmpersandEqualsToken, ast.KindAmpersandEqualsToken, ast.KindAsteriskAsteriskEqualsToken,
		ast.KindAsteriskEqualsToken, ast.KindBarBarEqualsToken, ast.KindBarEqualsToken, ast.KindCaretEqualsToken,
		ast.KindEqualsToken, ast.KindGreaterThanGreaterThanEqualsToken, ast.KindGreaterThanGreaterThanGreaterThanEqualsToken,
		ast.KindLessThanLessThanEqualsToken, ast.KindMinusEqualsToken, ast.KindPercentEqualsToken, ast.KindPlusEqualsToken,
		ast.KindQuestionQuestionEqualsToken, ast.KindSlashEqualsToken:
		return "AssignmentExpression", true
	case ast.KindAmpersandAmpersandToken, ast.KindBarBarToken, ast.KindQuestionQuestionToken:
		return "LogicalExpression", true
	case ast.KindAmpersandToken, ast.KindAsteriskAsteriskToken, ast.KindAsteriskToken, ast.KindBarToken,
		ast.KindCaretToken, ast.KindEqualsEqualsEqualsToken, ast.KindEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken,
		ast.KindExclamationEqualsToken, ast.KindGreaterThanEqualsToken, ast.KindGreaterThanGreaterThanGreaterThanToken,
		ast.KindGreaterThanGreaterThanToken, ast.KindGreaterThanToken, ast.KindInKeyword, ast.KindInstanceOfKeyword,
		ast.KindLessThanEqualsToken, ast.KindLessThanLessThanToken, ast.KindLessThanToken, ast.KindMinusToken,
		ast.KindPercentToken, ast.KindPlusToken, ast.KindSlashToken:
		return "BinaryExpression", true
	}
	return "", false
}

var keywordTypes = map[ast.Kind]string{
	ast.KindAnyKeyword:       "TSAnyKeyword",
	ast.KindBigIntKeyword:    "TSBigIntKeyword",
	ast.KindBooleanKeyword:   "TSBooleanKeyword",
	ast.KindNeverKeyword:     "TSNeverKeyword",
	ast.KindNumberKeyword:    "TSNumberKeyword",
	ast.KindObjectKeyword:    "TSObjectKeyword",
	ast.KindStringKeyword:    "TSStringKeyword",
	ast.KindSymbolKeyword:    "TSSymbolKeyword",
	ast.KindUnknownKeyword:   "TSUnknownKeyword",
	ast.KindVoidKeyword:      "TSVoidKeyword",
	ast.KindUndefinedKeyword: "TSUndefinedKeyword",
	ast.KindIntrinsicKeyword: "TSIntrinsicKeyword",
}

// ---------------------------------------------------------------- nodes

func (c *converter) isThisInTypeQuery(n *ast.Node, parent *ast.Node) bool {
	if n.Kind != ast.KindIdentifier || n.Text() != "this" {
		return false
	}
	node, up := n, parent
	for up != nil && up.Kind == ast.KindQualifiedName && up.AsQualifiedName().Left == node {
		node, up = up, up.Parent
	}
	return up != nil && up.Kind == ast.KindTypeQuery
}

// variableKind is a declaration list's kind. A list the parser wrote for a
// pattern binding, such as when Exit.Success(let user), is const: the
// binding is part of a pattern, not a declaration prefer-const can rewrite. A
// list of only the parser's own names keeps its kind: a do expression assigns
// its `let $do1`, so const would read as an assignment to a constant.
func (c *converter) variableKind(statement *ast.Node, list *ast.Node) string {
	kind := declarationKind(list)
	if c.vibe && !c.startsWithWord(list, strings.Fields(kind)[0]) && !c.declaresOnlySynthesized(list) {
		return "const"
	}
	return kind
}

func (c *converter) declaresOnlySynthesized(list *ast.Node) bool {
	if list.Kind != ast.KindVariableDeclarationList {
		return false
	}
	for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
		if !c.synthesized(declaration.Name()) {
			return false
		}
	}
	return true
}

func (c *converter) startsWithWord(n *ast.Node, word string) bool {
	start := c.start(n)
	if !strings.HasPrefix(c.text[start:], word) {
		return false
	}
	end := start + len(word)
	return end >= len(c.text) || !scanner.IsIdentifierPart(rune(c.text[end]))
}

func (c *converter) templateElement(n *ast.Node, tagged bool) *obj {
	tail := n.Kind == ast.KindTemplateTail
	r := c.rangeOf(n)
	endTrim := 2
	if tail {
		endTrim = 1
	}
	raw := c.text[min(r.start+1, r.end):max(r.end-endTrim, r.start+1)]
	if n.Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
		raw = n.RawText() // synthesized at another token: its own text
	}
	var cooked any = n.Text()
	if tagged && !isValidEscape(raw) {
		cooked = nil
	}
	return c.node(n, "TemplateElement").
		set("tail", tail).
		set("value", (&obj{}).set("cooked", cooked).set("raw", raw))
}

func asteriskOf(n *ast.Node) bool {
	data := n.BodyData()
	return data != nil && data.AsteriskToken != nil
}

func (c *converter) convertImportAttributes(attributes *ast.Node) []any {
	if attributes == nil {
		return []any{}
	}
	return c.convertChildren(listNodes(attributes.AsImportAttributes().Attributes), attributes)
}

// convertHeritage converts one type of a heritage clause. The parser writes
// an implements or an interface's extends type as a type reference, where
// TypeScript 5 writes an expression with type arguments, so its name becomes
// the expression typescript-estree expects.
func (c *converter) convertHeritage(n *ast.Node, parent *ast.Node, typ string) *obj {
	if n.Kind != ast.KindTypeReference {
		return c.convertChild(n, parent)
	}
	reference := n.AsTypeReferenceNode()
	result := c.node(n, typ).set("expression", c.entityNameExpression(reference.TypeName, n))
	if typeArguments := c.convertTypeArguments(reference.TypeArguments, n); typeArguments != nil {
		result.set("typeArguments", typeArguments)
	}
	return result
}

// entityNameExpression converts A.B.C, a qualified name, as the property
// access it would be in an expression.
func (c *converter) entityNameExpression(n *ast.Node, parent *ast.Node) *obj {
	if n.Kind != ast.KindQualifiedName {
		return c.convertChild(n, parent)
	}
	qualified := n.AsQualifiedName()
	return c.node(n, "MemberExpression").
		set("computed", false).
		set("object", c.entityNameExpression(qualified.Left, n)).
		set("optional", false).
		set("property", c.convertChild(qualified.Right, n))
}
