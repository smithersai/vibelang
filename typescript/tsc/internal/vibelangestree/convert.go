package vibelangestree

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The conversion follows @typescript-eslint/typescript-estree 8 (convert.ts)
// node for node, so ESLint rules written for TypeScript read a .vibe file's
// TypeScript forms exactly as they read a .ts file's. The differential test
// (packages/compiler/test/eslint) holds the two to the same output on a
// TypeScript corpus. VibeLang's own forms are in vibelang.go.

// converter holds the state of one conversion.
type converter struct {
	file *ast.SourceFile
	text string
	vibe bool
	// allowPattern reports that the node being converted is an assignment
	// target, where an array or object literal is a pattern.
	allowPattern bool
	scan         *scanner.Scanner
	// identifiers holds the start of each source identifier, which makes
	// the token there an Identifier whatever word it spells.
	identifiers map[int]bool
	// pipes holds the start of each pipe operator, |>, one token for ESLint.
	pipes map[int]bool
	// modules holds the source file of each module declaration's body (D283).
	modules map[*ast.Node]*ast.SourceFile
}

// unsupported is a node the converter has no ESTree form for.
type unsupported struct {
	node *ast.Node
	pos  int
}

func (u unsupported) Error() string {
	return fmt.Sprintf("VibeLang's ESLint parser has no ESTree form for %s", strings.TrimPrefix(u.node.Kind.String(), "Kind"))
}

func (c *converter) fail(n *ast.Node) {
	panic(unsupported{node: n, pos: c.start(n)})
}

// ---------------------------------------------------------------- positions

// start returns the start of n's first token, as getStart does.
func (c *converter) start(n *ast.Node) int {
	pos := n.Pos()
	if pos < 0 {
		return 0
	}
	start := scanner.SkipTrivia(c.text, pos)
	if end := n.End(); end >= pos && start > end {
		return end
	}
	return start
}

func (c *converter) rangeOf(n *ast.Node) span {
	return span{c.start(n), max(n.End(), 0)}
}

// node makes an ESTree node of type typ at n's range.
func (c *converter) node(n *ast.Node, typ string) *obj {
	return (&obj{}).set("type", typ).set("range", c.rangeOf(n))
}

func (c *converter) nodeAt(r span, typ string) *obj {
	return (&obj{}).set("type", typ).set("range", r)
}

// tokenAfter returns the range of the first token at or after pos.
func (c *converter) tokenAfter(pos int) (span, ast.Kind) {
	c.scan.ResetPos(pos)
	kind := c.scan.Scan()
	return span{c.scan.TokenStart(), c.scan.TokenEnd()}, kind
}

// fixParentLocation widens result's range to childRange.
func fixParentLocation(result *obj, childRange span) {
	r := result.rng()
	if childRange.start < r.start {
		r.start = childRange.start
	}
	if childRange.end > r.end {
		r.end = childRange.end
	}
	result.setRange(r)
}

// ---------------------------------------------------------------- children

func (c *converter) converter(n *ast.Node, parent *ast.Node, allowPattern bool) *obj {
	if n == nil {
		return nil
	}
	saved := c.allowPattern
	c.allowPattern = allowPattern
	if parent == nil {
		parent = n.Parent
	}
	result := c.convertNode(n, parent)
	c.allowPattern = saved
	return result
}

func (c *converter) convertChild(n *ast.Node, parent *ast.Node) *obj {
	return c.converter(n, parent, false)
}

func (c *converter) convertPattern(n *ast.Node, parent *ast.Node) *obj {
	return c.converter(n, parent, true)
}

func (c *converter) convertChildren(nodes []*ast.Node, parent *ast.Node) []any {
	out := make([]any, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, c.converter(n, parent, false))
	}
	return out
}

func listNodes(list *ast.NodeList) []*ast.Node {
	if list == nil {
		return nil
	}
	return list.Nodes
}

// ---------------------------------------------------------------- modifiers

// modifiers returns n's modifiers without its decorators, as getModifiers does.
func modifiers(n *ast.Node) []*ast.Node {
	var out []*ast.Node
	for _, m := range n.ModifierNodes() {
		if !ast.IsDecorator(m) {
			out = append(out, m)
		}
	}
	return out
}

func decorators(n *ast.Node) []*ast.Node {
	var out []*ast.Node
	for _, m := range n.ModifierNodes() {
		if ast.IsDecorator(m) {
			out = append(out, m)
		}
	}
	return out
}

func hasModifier(kind ast.Kind, n *ast.Node) bool {
	for _, m := range modifiers(n) {
		if m.Kind == kind {
			return true
		}
	}
	return false
}

func accessibility(n *ast.Node) any {
	for _, m := range modifiers(n) {
		switch m.Kind {
		case ast.KindPublicKeyword:
			return "public"
		case ast.KindProtectedKeyword:
			return "protected"
		case ast.KindPrivateKeyword:
			return "private"
		}
	}
	return nil
}

func setAccessibility(o *obj, n *ast.Node) {
	if a := accessibility(n); a != nil {
		o.set("accessibility", a)
	}
}

func isComputed(name *ast.Node) bool {
	return name != nil && name.Kind == ast.KindComputedPropertyName
}

func declarationKind(list *ast.Node) string {
	flags := list.Flags
	switch {
	case flags&ast.NodeFlagsLet != 0:
		return "let"
	case flags&ast.NodeFlagsAwaitUsing == ast.NodeFlagsAwaitUsing:
		return "await using"
	case flags&ast.NodeFlagsConst != 0:
		return "const"
	case flags&ast.NodeFlagsUsing != 0:
		return "using"
	}
	return "var"
}

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
			panic(syntaxError{pos: max(list.Pos()-1, 0), message: "Type argument list cannot be empty."})
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
		panic(syntaxError{pos: max(list.Pos()-1, 0), message: "Type parameter list cannot be empty."})
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

func (c *converter) convertNode(n *ast.Node, parent *ast.Node) *obj {
	if result, ok := c.convertVibeLang(n, parent); ok {
		return result
	}
	switch n.Kind {
	case ast.KindSourceFile:
		file := n.AsSourceFile()
		sourceType := "script"
		if file.ExternalModuleIndicator != nil {
			sourceType = "module"
		}
		return c.nodeAt(span{scanner.SkipTrivia(c.text, 0), file.EndOfFileToken.End()}, "Program").
			set("body", c.convertBodyExpressions(listNodes(file.Statements), n, nil)).
			set("sourceType", sourceType)

	case ast.KindBlock:
		return c.node(n, "BlockStatement").set("body", c.convertBodyExpressions(n.Statements(), n, parent))

	case ast.KindIdentifier:
		if c.isThisInTypeQuery(n, parent) {
			return c.node(n, "ThisExpression")
		}
		identifier := identifierShape(c.node(n, "Identifier"), n.Text())
		if c.synthesized(n) {
			identifier.set("synthesized", true) // a name the parser wrote, which eslint.mjs keeps out of scope analysis
		}
		return identifier

	case ast.KindPrivateIdentifier:
		return c.node(n, "PrivateIdentifier").set("name", strings.TrimPrefix(n.Text(), "#"))

	case ast.KindWithStatement:
		with := n.AsWithStatement()
		return c.node(n, "WithStatement").set("body", c.convertChild(with.Statement, n)).set("object", c.convertChild(with.Expression, n))

	case ast.KindReturnStatement:
		return c.node(n, "ReturnStatement").set("argument", c.convertChild(n.Expression(), n))

	case ast.KindLabeledStatement:
		labeled := n.AsLabeledStatement()
		return c.node(n, "LabeledStatement").set("body", c.convertChild(labeled.Statement, n)).set("label", c.convertChild(labeled.Label, n))

	case ast.KindContinueStatement:
		return c.node(n, "ContinueStatement").set("label", c.convertChild(n.AsContinueStatement().Label, n))

	case ast.KindBreakStatement:
		return c.node(n, "BreakStatement").set("label", c.convertChild(n.AsBreakStatement().Label, n))

	case ast.KindIfStatement:
		ifStatement := n.AsIfStatement()
		return c.node(n, "IfStatement").
			set("alternate", c.convertChild(ifStatement.ElseStatement, n)).
			set("consequent", c.convertChild(ifStatement.ThenStatement, n)).
			set("test", c.convertChild(ifStatement.Expression, n))

	case ast.KindSwitchStatement:
		switchStatement := n.AsSwitchStatement()
		caseBlock := switchStatement.CaseBlock
		return c.node(n, "SwitchStatement").
			set("cases", c.convertChildren(listNodes(caseBlock.AsCaseBlock().Clauses), caseBlock)).
			set("discriminant", c.convertChild(switchStatement.Expression, n))

	case ast.KindCaseClause, ast.KindDefaultClause:
		clause := n.AsCaseOrDefaultClause()
		result := c.node(n, "SwitchCase").set("consequent", c.convertChildren(listNodes(clause.Statements), n))
		if n.Kind == ast.KindCaseClause {
			result.set("test", c.convertChild(clause.Expression, n))
		} else {
			result.set("test", nil)
		}
		return result

	case ast.KindThrowStatement:
		return c.node(n, "ThrowStatement").set("argument", c.convertChild(n.Expression(), n))

	case ast.KindTryStatement:
		try := n.AsTryStatement()
		return c.node(n, "TryStatement").
			set("block", c.convertChild(try.TryBlock, n)).
			set("finalizer", c.convertChild(try.FinallyBlock, n)).
			set("handler", c.convertChild(try.CatchClause, n))

	case ast.KindCatchClause:
		clause := n.AsCatchClause()
		result := c.node(n, "CatchClause").set("body", c.convertChild(clause.Block, n))
		if declaration := clause.VariableDeclaration; declaration != nil && !c.synthesized(declaration.Name()) {
			result.set("param", c.convertBindingNameWithTypeAnnotation(declaration.Name(), declaration.Type(), declaration))
		} else {
			result.set("param", nil)
		}
		return result

	case ast.KindWhileStatement:
		while := n.AsWhileStatement()
		return c.node(n, "WhileStatement").set("body", c.convertChild(while.Statement, n)).set("test", c.convertChild(while.Expression, n))

	case ast.KindDoStatement:
		do := n.AsDoStatement()
		return c.node(n, "DoWhileStatement").set("body", c.convertChild(do.Statement, n)).set("test", c.convertChild(do.Expression, n))

	case ast.KindForStatement:
		forStatement := n.AsForStatement()
		return c.node(n, "ForStatement").
			set("body", c.convertChild(forStatement.Statement, n)).
			set("init", c.convertChild(forStatement.Initializer, n)).
			set("test", c.convertChild(forStatement.Condition, n)).
			set("update", c.convertChild(forStatement.Incrementor, n))

	case ast.KindForInStatement:
		forIn := n.AsForInOrOfStatement()
		return c.node(n, "ForInStatement").
			set("body", c.convertChild(forIn.Statement, n)).
			set("left", c.convertPattern(forIn.Initializer, n)).
			set("right", c.convertChild(forIn.Expression, n))

	case ast.KindForOfStatement:
		forOf := n.AsForInOrOfStatement()
		return c.node(n, "ForOfStatement").
			set("await", forOf.AwaitModifier != nil && forOf.AwaitModifier.Kind == ast.KindAwaitKeyword).
			set("body", c.convertChild(forOf.Statement, n)).
			set("left", c.convertPattern(forOf.Initializer, n)).
			set("right", c.convertChild(forOf.Expression, n))

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
		return c.fixExports(n, result)

	case ast.KindVariableDeclaration:
		declaration := n.AsVariableDeclaration()
		init := c.convertChild(declaration.Initializer, n)
		id := c.convertBindingNameWithTypeAnnotation(n.Name(), declaration.Type, n)
		return c.node(n, "VariableDeclarator").
			set("definite", declaration.ExclamationToken != nil).
			set("id", id).
			set("init", init)

	case ast.KindVariableStatement:
		list := n.AsVariableStatement().DeclarationList
		result := c.node(n, "VariableDeclaration").
			set("declarations", c.convertChildren(listNodes(list.AsVariableDeclarationList().Declarations), list)).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("kind", c.variableKind(n, list))
		return c.fixExports(n, result)

	case ast.KindVariableDeclarationList:
		return c.node(n, "VariableDeclaration").
			set("declarations", c.convertChildren(listNodes(n.AsVariableDeclarationList().Declarations), n)).
			set("declare", false).
			set("kind", c.variableKind(n, n))

	case ast.KindExpressionStatement:
		return c.node(n, "ExpressionStatement").set("expression", c.convertChild(n.Expression(), n))

	case ast.KindThisKeyword:
		return c.node(n, "ThisExpression")

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
				set("optional", false)
		}
		return c.node(n, "ArrayExpression").set("elements", c.convertChildren(elements, n))

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
				set("properties", converted)
		}
		return c.node(n, "ObjectExpression").set("properties", c.convertChildren(properties, n))

	case ast.KindPropertyAssignment:
		assignment := n.AsPropertyAssignment()
		return c.node(n, "Property").
			set("computed", isComputed(n.Name())).
			set("key", c.convertChild(n.Name(), n)).
			set("kind", "init").
			set("method", false).
			set("optional", false).
			set("shorthand", false).
			set("value", c.converter(assignment.Initializer, n, c.allowPattern))

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
				set("right", c.convertChild(shorthand.ObjectAssignmentInitializer, n)))
		}
		return result.set("value", c.convertChild(n.Name(), n))

	case ast.KindComputedPropertyName:
		return c.convertChild(n.Expression(), n)

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
		return result

	case ast.KindGetAccessor, ast.KindSetAccessor:
		if parent != nil && (parent.Kind == ast.KindInterfaceDeclaration || parent.Kind == ast.KindTypeLiteral) {
			return c.convertMethodSignature(n)
		}
		return c.convertMethod(n, parent)

	case ast.KindMethodDeclaration:
		return c.convertMethod(n, parent)

	case ast.KindConstructor:
		return c.convertConstructor(n)

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
		return result

	case ast.KindSuperKeyword:
		return c.node(n, "Super")

	case ast.KindImportKeyword:
		// An import that starts no call, as in `import<A0`, which TypeScript
		// parses as `import < A0` and only its checker rejects: typescript-
		// estree copies the keyword as it copies any node it has no case for,
		// with TypeScript's node id, 0 in a tree no checker has visited.
		return c.node(n, "TSImportKeyword").set("id", 0)

	case ast.KindArrayBindingPattern:
		elements := listNodes(n.AsBindingPattern().Elements)
		converted := make([]any, 0, len(elements))
		for _, element := range elements {
			converted = append(converted, c.convertPattern(element, n))
		}
		return c.node(n, "ArrayPattern").
			set("decorators", []any{}).
			set("elements", converted).
			set("optional", false)

	case ast.KindOmittedExpression:
		return nil

	case ast.KindObjectBindingPattern:
		elements := listNodes(n.AsBindingPattern().Elements)
		converted := make([]any, 0, len(elements))
		for _, element := range elements {
			converted = append(converted, c.convertPattern(element, n))
		}
		return c.node(n, "ObjectPattern").
			set("decorators", []any{}).
			set("optional", false).
			set("properties", converted)

	case ast.KindBindingElement:
		return c.convertBindingElement(n, parent)

	case ast.KindArrowFunction:
		arrow := n.AsArrowFunction()
		result := c.node(n, "ArrowFunctionExpression").
			set("async", hasModifier(ast.KindAsyncKeyword, n)).
			set("body", c.convertChild(arrow.Body, n)).
			set("expression", arrow.Body.Kind != ast.KindBlock).
			set("generator", false).
			set("id", nil).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result

	case ast.KindYieldExpression:
		yield := n.AsYieldExpression()
		return c.node(n, "YieldExpression").
			set("argument", c.convertChild(yield.Expression, n)).
			set("delegate", yield.AsteriskToken != nil)

	case ast.KindAwaitExpression:
		return c.node(n, "AwaitExpression").set("argument", c.convertChild(n.Expression(), n))

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
		return c.node(n, "TemplateLiteral").set("expressions", []any{}).set("quasis", []any{element})

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
		return c.node(n, "TemplateLiteral").set("expressions", expressions).set("quasis", quasis)

	case ast.KindTaggedTemplateExpression:
		tagged := n.AsTaggedTemplateExpression()
		result := c.node(n, "TaggedTemplateExpression").
			set("quasi", c.convertChild(tagged.Template, n)).
			set("tag", c.convertChild(tagged.Tag, n))
		if typeArguments := c.convertTypeArguments(tagged.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result

	case ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail:
		return c.templateElement(n, false)

	case ast.KindSpreadAssignment, ast.KindSpreadElement:
		if c.allowPattern {
			return c.node(n, "RestElement").
				set("argument", c.convertPattern(n.Expression(), n)).
				set("decorators", []any{}).
				set("optional", false)
		}
		return c.node(n, "SpreadElement").set("argument", c.convertChild(n.Expression(), n))

	case ast.KindParameter:
		return c.convertParameter(n, parent)

	case ast.KindClassDeclaration, ast.KindClassExpression:
		return c.convertClass(n)

	case ast.KindModuleBlock:
		return c.node(n, "TSModuleBlock").set("body", c.convertBodyExpressions(n.Statements(), n, parent))

	case ast.KindImportDeclaration:
		return c.convertImportDeclaration(n)

	case ast.KindNamespaceImport:
		return c.node(n, "ImportNamespaceSpecifier").set("local", c.convertChild(n.Name(), n))

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
			set("local", c.convertChild(n.Name(), n))

	case ast.KindImportClause:
		local := c.convertChild(n.Name(), n)
		return c.nodeAt(local.rng(), "ImportDefaultSpecifier").set("local", local)

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
				set("specifiers", c.convertChildren(listNodes(export.ExportClause.AsNamedExports().Elements), n))
		}
		var exported any
		if export.ExportClause != nil && export.ExportClause.Kind == ast.KindNamespaceExport {
			exported = c.convertChild(export.ExportClause.Name(), export.ExportClause)
		}
		return c.node(n, "ExportAllDeclaration").
			set("attributes", c.convertImportAttributes(export.Attributes)).
			set("exported", exported).
			set("exportKind", exportKind).
			set("source", c.convertChild(export.ModuleSpecifier, n))

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
			set("local", c.convertChild(local, n))

	case ast.KindExportAssignment:
		assignment := n.AsExportAssignment()
		if assignment.IsExportEquals {
			return c.node(n, "TSExportAssignment").set("expression", c.convertChild(assignment.Expression, n))
		}
		return c.node(n, "ExportDefaultDeclaration").
			set("declaration", c.convertChild(assignment.Expression, n)).
			set("exportKind", "value")

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
				set("prefix", n.Kind == ast.KindPrefixUnaryExpression)
		}
		return c.node(n, "UnaryExpression").
			set("argument", c.convertChild(operand, n)).
			set("operator", text).
			set("prefix", true)

	case ast.KindDeleteExpression, ast.KindVoidExpression, ast.KindTypeOfExpression:
		operator := map[ast.Kind]string{ast.KindDeleteExpression: "delete", ast.KindVoidExpression: "void", ast.KindTypeOfExpression: "typeof"}[n.Kind]
		return c.node(n, "UnaryExpression").
			set("argument", c.convertChild(n.Expression(), n)).
			set("operator", operator).
			set("prefix", true)

	case ast.KindTypeOperator:
		operator := n.AsTypeOperatorNode()
		return c.node(n, "TSTypeOperator").
			set("operator", tokenText(operator.Operator)).
			set("typeAnnotation", c.convertChild(operator.Type, n))

	case ast.KindBinaryExpression:
		return c.convertBinary(n)

	case ast.KindPropertyAccessExpression:
		access := n.AsPropertyAccessExpression()
		object := c.convertChild(access.Expression, n)
		property := c.convertChild(access.Name(), n)
		result := c.node(n, "MemberExpression").
			set("computed", false).
			set("object", object).
			set("optional", access.QuestionDotToken != nil).
			set("property", property)
		return c.convertChainExpression(result, n)

	case ast.KindElementAccessExpression:
		access := n.AsElementAccessExpression()
		object := c.convertChild(access.Expression, n)
		property := c.convertChild(access.ArgumentExpression, n)
		result := c.node(n, "MemberExpression").
			set("computed", true).
			set("object", object).
			set("optional", access.QuestionDotToken != nil).
			set("property", property)
		return c.convertChainExpression(result, n)

	case ast.KindCallExpression:
		return c.convertCall(n)

	case ast.KindNewExpression:
		newExpression := n.AsNewExpression()
		typeArguments := c.convertTypeArguments(newExpression.TypeArguments, n)
		result := c.node(n, "NewExpression").
			set("arguments", c.convertChildren(listNodes(newExpression.Arguments), n)).
			set("callee", c.convertChild(newExpression.Expression, n))
		if typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result

	case ast.KindConditionalExpression:
		conditional := n.AsConditionalExpression()
		return c.node(n, "ConditionalExpression").
			set("alternate", c.convertChild(conditional.WhenFalse, n)).
			set("consequent", c.convertChild(conditional.WhenTrue, n)).
			set("test", c.convertChild(conditional.Condition, n))

	case ast.KindMetaProperty:
		meta := n.AsMetaProperty()
		keyword := tokenText(meta.KeywordToken)
		start := c.start(n)
		return c.node(n, "MetaProperty").
			set("meta", identifierShape(c.nodeAt(span{start, start + len(keyword)}, "Identifier"), keyword)).
			set("property", c.convertChild(meta.Name(), n))

	case ast.KindDecorator:
		return c.node(n, "Decorator").set("expression", c.convertChild(n.Expression(), n))

	case ast.KindStringLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		if n.Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
			raw = strconv.Quote(n.Text()) // synthesized at another token: its own text
		}
		return c.node(n, "Literal").set("raw", raw).set("value", n.Text())

	case ast.KindNumericLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		if n.Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
			raw = n.Text()
		}
		return c.node(n, "Literal").set("raw", raw).set("value", numberValue(raw))

	case ast.KindBigIntLiteral:
		r := c.rangeOf(n)
		raw := c.text[r.start:r.end]
		digits := strings.ReplaceAll(strings.TrimSuffix(raw, "n"), "_", "")
		return c.node(n, "Literal").set("bigint", digits).set("raw", raw).set("value", nil)

	case ast.KindRegularExpressionLiteral:
		text := n.Text()
		slash := strings.LastIndex(text, "/")
		return c.node(n, "Literal").
			set("raw", text).
			set("regex", (&obj{}).set("flags", text[slash+1:]).set("pattern", text[1:slash])).
			set("value", nil)

	case ast.KindTrueKeyword:
		return c.node(n, "Literal").set("raw", "true").set("value", true)

	case ast.KindFalseKeyword:
		return c.node(n, "Literal").set("raw", "false").set("value", false)

	case ast.KindNullKeyword:
		return c.node(n, "Literal").set("raw", "null").set("value", nil)

	case ast.KindEmptyStatement:
		return c.node(n, "EmptyStatement")

	case ast.KindDebuggerStatement:
		return c.node(n, "DebuggerStatement")

	case ast.KindQualifiedName:
		qualified := n.AsQualifiedName()
		return c.node(n, "TSQualifiedName").
			set("left", c.convertChild(qualified.Left, n)).
			set("right", c.convertChild(qualified.Right, n))

	case ast.KindTypeReference:
		reference := n.AsTypeReferenceNode()
		result := c.node(n, "TSTypeReference")
		if typeArguments := c.convertTypeArguments(reference.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result.set("typeName", c.convertChild(reference.TypeName, n))

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
			set("out", hasModifier(ast.KindOutKeyword, n))

	case ast.KindThisType:
		return c.node(n, "TSThisType")

	case ast.KindAnyKeyword, ast.KindBigIntKeyword, ast.KindBooleanKeyword, ast.KindNeverKeyword, ast.KindNumberKeyword,
		ast.KindObjectKeyword, ast.KindStringKeyword, ast.KindSymbolKeyword, ast.KindUnknownKeyword, ast.KindVoidKeyword,
		ast.KindUndefinedKeyword, ast.KindIntrinsicKeyword:
		return c.node(n, keywordTypes[n.Kind])

	case ast.KindNonNullExpression:
		return c.convertChainExpression(c.node(n, "TSNonNullExpression").set("expression", c.convertChild(n.Expression(), n)), n)

	case ast.KindTypeLiteral:
		return c.node(n, "TSTypeLiteral").set("members", c.convertChildren(n.Members(), n))

	case ast.KindArrayType:
		return c.node(n, "TSArrayType").set("elementType", c.convertChild(n.AsArrayTypeNode().ElementType, n))

	case ast.KindIndexedAccessType:
		access := n.AsIndexedAccessTypeNode()
		return c.node(n, "TSIndexedAccessType").
			set("indexType", c.convertChild(access.IndexType, n)).
			set("objectType", c.convertChild(access.ObjectType, n))

	case ast.KindConditionalType:
		conditional := n.AsConditionalTypeNode()
		return c.node(n, "TSConditionalType").
			set("checkType", c.convertChild(conditional.CheckType, n)).
			set("extendsType", c.convertChild(conditional.ExtendsType, n)).
			set("falseType", c.convertChild(conditional.FalseType, n)).
			set("trueType", c.convertChild(conditional.TrueType, n))

	case ast.KindTypeQuery:
		query := n.AsTypeQueryNode()
		result := c.node(n, "TSTypeQuery").set("exprName", c.convertChild(query.ExprName, n))
		if typeArguments := c.convertTypeArguments(query.TypeArguments, n); typeArguments != nil {
			result.set("typeArguments", typeArguments)
		}
		return result

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
		return result

	case ast.KindParenthesizedExpression:
		return c.converter(n.Expression(), parent, c.allowPattern)

	case ast.KindTypeAliasDeclaration:
		alias := n.AsTypeAliasDeclaration()
		result := c.node(n, "TSTypeAliasDeclaration").
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("id", c.convertChild(n.Name(), n)).
			set("typeAnnotation", c.convertChild(alias.Type, n))
		setTypeParameters(result, c.convertTypeParameters(alias.TypeParameters, n))
		return c.fixExports(n, result)

	case ast.KindMethodSignature:
		return c.convertMethodSignature(n)

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
		return result

	case ast.KindIndexSignature:
		result := c.node(n, "TSIndexSignature")
		setAccessibility(result, n)
		result.set("parameters", c.convertChildren(n.Parameters(), n)).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, n)).
			set("static", hasModifier(ast.KindStaticKeyword, n))
		if t := n.Type(); t != nil {
			result.set("typeAnnotation", c.convertTypeAnnotation(t, n))
		}
		return result

	case ast.KindConstructorType:
		result := c.node(n, "TSConstructorType").
			set("abstract", hasModifier(ast.KindAbstractKeyword, n)).
			set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result

	case ast.KindFunctionType, ast.KindConstructSignature, ast.KindCallSignature:
		typ := map[ast.Kind]string{ast.KindFunctionType: "TSFunctionType", ast.KindConstructSignature: "TSConstructSignatureDeclaration", ast.KindCallSignature: "TSCallSignatureDeclaration"}[n.Kind]
		result := c.node(n, typ).set("params", c.convertParameters(n.ParameterList(), n))
		setReturnType(result, c, n)
		setTypeParameters(result, c.convertTypeParameters(n.TypeParameterList(), n))
		return result

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
		return result

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
		return c.fixExports(n, result)

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
		return result

	case ast.KindImportType:
		return c.convertImportType(n)

	case ast.KindEnumDeclaration:
		enum := n.AsEnumDeclaration()
		members := enum.Members
		result := c.node(n, "TSEnumDeclaration").
			set("body", c.nodeAt(span{members.Pos() - 1, n.End()}, "TSEnumBody").set("members", c.convertChildren(members.Nodes, n))).
			set("const", hasModifier(ast.KindConstKeyword, n)).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("id", c.convertChild(n.Name(), n))
		return c.fixExports(n, result)

	case ast.KindEnumMember:
		member := n.AsEnumMember()
		result := c.node(n, "TSEnumMember").set("id", c.convertChild(n.Name(), n))
		if member.Initializer != nil {
			result.set("initializer", c.convertChild(member.Initializer, n))
		}
		return result

	case ast.KindModuleDeclaration:
		return c.convertModule(n)

	case ast.KindParenthesizedType:
		return c.convertChild(n.Type(), n)

	case ast.KindUnionType:
		return c.node(n, "TSUnionType").set("types", c.convertChildren(listNodes(n.AsUnionTypeNode().Types), n))

	case ast.KindIntersectionType:
		return c.node(n, "TSIntersectionType").set("types", c.convertChildren(listNodes(n.AsIntersectionTypeNode().Types), n))

	case ast.KindAsExpression:
		as := n.AsAsExpression()
		return c.node(n, "TSAsExpression").
			set("expression", c.convertChild(as.Expression, n)).
			set("typeAnnotation", c.convertChild(as.Type, n))

	case ast.KindInferType:
		return c.node(n, "TSInferType").set("typeParameter", c.convertChild(n.AsInferTypeNode().TypeParameter, n))

	case ast.KindLiteralType:
		literal := n.AsLiteralTypeNode().Literal
		if literal.Kind == ast.KindNullKeyword {
			return c.node(literal, "TSNullKeyword")
		}
		return c.node(n, "TSLiteralType").set("literal", c.convertChild(literal, n))

	case ast.KindTypeAssertionExpression:
		assertion := n.AsTypeAssertion()
		return c.node(n, "TSTypeAssertion").
			set("expression", c.convertChild(assertion.Expression, n)).
			set("typeAnnotation", c.convertChild(assertion.Type, n))

	case ast.KindImportEqualsDeclaration:
		declaration := n.AsImportEqualsDeclaration()
		importKind := "value"
		if declaration.IsTypeOnly {
			importKind = "type"
		}
		return c.fixExports(n, c.node(n, "TSImportEqualsDeclaration").
			set("id", c.convertChild(n.Name(), n)).
			set("importKind", importKind).
			set("moduleReference", c.convertChild(declaration.ModuleReference, n)))

	case ast.KindExternalModuleReference:
		return c.node(n, "TSExternalModuleReference").set("expression", c.convertChild(n.Expression(), n))

	case ast.KindNamespaceExportDeclaration:
		return c.node(n, "TSNamespaceExportDeclaration").set("id", c.convertChild(n.Name(), n))

	case ast.KindAbstractKeyword:
		return c.node(n, "TSAbstractKeyword")

	case ast.KindTupleType:
		return c.node(n, "TSTupleType").set("elementTypes", c.convertChildren(listNodes(n.AsTupleTypeNode().Elements), n))

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
			return c.node(n, "TSRestType").set("typeAnnotation", member)
		}
		return member

	case ast.KindOptionalType:
		return c.node(n, "TSOptionalType").set("typeAnnotation", c.convertChild(n.Type(), n))

	case ast.KindRestType:
		return c.node(n, "TSRestType").set("typeAnnotation", c.convertChild(n.Type(), n))

	case ast.KindTemplateLiteralType:
		template := n.AsTemplateLiteralTypeNode()
		quasis := []any{c.templateElement(template.Head, false)}
		types := []any{}
		for _, templateSpan := range listNodes(template.TemplateSpans) {
			s := templateSpan.AsTemplateLiteralTypeSpan()
			types = append(types, c.convertChild(s.Type, templateSpan))
			quasis = append(quasis, c.templateElement(s.Literal, false))
		}
		return c.node(n, "TSTemplateLiteralType").set("quasis", quasis).set("types", types)

	case ast.KindClassStaticBlockDeclaration:
		body := n.AsClassStaticBlockDeclaration().Body
		return c.node(n, "StaticBlock").set("body", c.convertBodyExpressions(body.Statements(), n, parent))

	case ast.KindImportAttribute:
		attribute := n.AsImportAttribute()
		return c.node(n, "ImportAttribute").
			set("key", c.convertChild(attribute.Name(), n)).
			set("value", c.convertChild(attribute.Value, n))

	case ast.KindSatisfiesExpression:
		satisfies := n.AsSatisfiesExpression()
		return c.node(n, "TSSatisfiesExpression").
			set("expression", c.convertChild(satisfies.Expression, n)).
			set("typeAnnotation", c.convertChild(satisfies.Type, n))
	}
	c.fail(n)
	return nil
}

// variableKind is a declaration list's kind. A list the parser wrote for a
// pattern binding, such as when Exit.Success(let user), is const: the
// binding is part of a pattern, not a declaration prefer-const can rewrite.
func (c *converter) variableKind(statement *ast.Node, list *ast.Node) string {
	kind := declarationKind(list)
	if c.vibe && !c.startsWithWord(list, strings.Fields(kind)[0]) {
		return "const"
	}
	return kind
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
	var cooked any = n.Text()
	if tagged && !isValidEscape(raw) {
		cooked = nil
	}
	return c.node(n, "TemplateElement").
		set("tail", tail).
		set("value", (&obj{}).set("cooked", cooked).set("raw", raw))
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

func asteriskOf(n *ast.Node) bool {
	data := n.BodyData()
	return data != nil && data.AsteriskToken != nil
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

func (c *converter) convertClass(n *ast.Node) *obj {
	if result := c.errorClass(n); result != nil {
		return result // an error written with a class's features (D278), or a schema error (D279)
	}
	data := n.ClassLikeData()
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
	typ := "ClassDeclaration"
	if n.Kind == ast.KindClassExpression {
		typ = "ClassExpression"
	}
	var members []*ast.Node
	for _, member := range listNodes(data.Members) {
		if member.Kind != ast.KindSemicolonClassElement {
			members = append(members, member)
		}
	}
	implements := []any{}
	if implementsClause != nil {
		for _, t := range listNodes(implementsClause.AsHeritageClause().Types) {
			implements = append(implements, c.convertHeritage(t, implementsClause, "TSClassImplements"))
		}
	}
	var body *obj
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
		extendsType = nil
		body = c.errorBody(n, fields)
	} else {
		if c.synthesized(extendsType) {
			extendsType = nil // control X's Control base
		}
		body = c.nodeAt(span{data.Members.Pos() - 1, n.End()}, "ClassBody").set("body", c.convertChildren(members, n))
	}
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

func (c *converter) convertImportAttributes(attributes *ast.Node) []any {
	if attributes == nil {
		return []any{}
	}
	return c.convertChildren(listNodes(attributes.AsImportAttributes().Attributes), attributes)
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
		return result.set("expressions", expressions)
	}
	typ, ok := binaryType(operator)
	if !ok {
		c.fail(binary.OperatorToken)
	}
	if c.allowPattern && typ == "AssignmentExpression" {
		return c.node(n, "AssignmentPattern").
			set("decorators", []any{}).
			set("left", c.convertPattern(binary.Left, n)).
			set("optional", false).
			set("right", c.convertChild(binary.Right, n))
	}
	return c.node(n, typ).
		set("operator", tokenText(operator)).
		set("left", c.converter(binary.Left, n, typ == "AssignmentExpression")).
		set("right", c.convertChild(binary.Right, n))
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
	return c.convertChainExpression(result, n)
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

// syntaxError is a parse error at a byte offset.
type syntaxError struct {
	pos     int
	message string
}

func (e syntaxError) Error() string { return e.message }

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
