package vibelangfmt

import (
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// TypeScriptFormatter formats a TypeScript file's text. It returns the text
// unchanged when the file is already formatted.
type TypeScriptFormatter func(text string) (string, error)

// Format formats source, the text of a .vibe file, with formatter, which
// formats TypeScript. fileName names the file in errors. Format fails, and
// changes nothing, on a file with syntax errors, and when the result would not
// parse to the program source parses to.
func Format(fileName, source string, formatter TypeScriptFormatter) (string, error) {
	enc, err := encode(fileName, source)
	if err != nil {
		return "", prefix(fileName, err)
	}
	if len(enc.modules) != 0 {
		// Each module body formats as a .ts file of its own first (modules.go).
		staged, err := formatModules(source, enc.modules, formatter)
		if err != nil {
			return "", prefix(fileName, err)
		}
		if enc, err = encode(fileName, staged); err != nil {
			return "", prefix(fileName, fmt.Errorf("vibelang format: internal error: the formatted module bodies do not encode: %w", err))
		}
	}
	formatted, err := formatter(enc.text)
	if err != nil {
		return "", prefix(fileName, fmt.Errorf("vibelang format: the TypeScript formatter failed: %w", err))
	}
	result, err := enc.decode(formatted)
	if err != nil {
		return "", prefix(fileName, err)
	}
	if err := SameProgram(source, result); err != nil {
		return "", prefix(fileName, fmt.Errorf("vibelang format: internal error: formatting changed the program: %w", err))
	}
	return result, nil
}

func prefix(fileName string, err error) error {
	if fileName == "" {
		return err
	}
	return fmt.Errorf("%s: %w", fileName, err)
}

// SameProgram reports how after, a .vibe file, differs from before as a
// program: its syntax tree and the tree of each module declaration's body,
// ignoring parentheses, the braces around a single statement that is the
// body of an if, else, or loop, and the order of import and export
// specifiers. Declaration order participates in module evaluation and stays
// significant. It returns nil when they are the same.
func SameProgram(before, after string) error {
	a := parser.ParseSourceFile(vibeOptions, before, core.ScriptKindTS)
	b := parser.ParseSourceFile(vibeOptions, after, core.ScriptKindTS)
	if diagnostics := b.Diagnostics(); len(diagnostics) != 0 && len(a.Diagnostics()) == 0 {
		return syntaxError(after, diagnostics[0])
	}
	c := comparer{before: before, after: after}
	if err := c.same(a.AsNode(), b.AsNode()); err != nil {
		return err
	}
	return c.sameModules(a, b)
}

type comparer struct{ before, after string }

func unparenthesize(node *ast.Node) *ast.Node {
	for node != nil && (node.Kind == ast.KindParenthesizedExpression || node.Kind == ast.KindParenthesizedType) {
		if node.Kind == ast.KindParenthesizedExpression {
			node = node.Expression()
		} else {
			node = node.Type()
		}
	}
	return node
}

func (c *comparer) differ(a *ast.Node, what string) error {
	line, column := lineColumn(c.before, scanner.SkipTrivia(c.before, a.Pos()))
	return fmt.Errorf("%d:%d: %s", line, column, what)
}

func (c *comparer) same(a, b *ast.Node) error {
	a, b = unparenthesize(a), unparenthesize(b)
	if a == nil || b == nil {
		if a != b {
			return fmt.Errorf("a node is missing")
		}
		return nil
	}
	if a.Kind != b.Kind {
		return c.differ(a, fmt.Sprintf("%v became %v", a.Kind, b.Kind))
	}
	if associatedDocCount(a, c.before) != associatedDocCount(b, c.after) {
		return c.differ(a, "JSDoc attachment changed; choose whether the comment should apply before formatting")
	}
	if text, ok := leafText(a); ok {
		if other, _ := leafText(b); text != other {
			return c.differ(a, fmt.Sprintf("%q became %q", text, other))
		}
	}
	if a.Kind == ast.KindBinaryExpression || a.Kind == ast.KindPrefixUnaryExpression || a.Kind == ast.KindPostfixUnaryExpression {
		if operator(a) != operator(b) {
			return c.differ(a, fmt.Sprintf("operator %v became %v", operator(a), operator(b)))
		}
	}
	aChildren, bChildren := unbraced(a, statements(a, children(a))), unbraced(b, statements(b, children(b)))
	if len(aChildren) != len(bChildren) {
		return c.differ(a, fmt.Sprintf("%v has %d children, then %d", a.Kind, len(aChildren), len(bChildren)))
	}
	if sortsChildren(a) {
		aChildren = sortedByKey(aChildren)
		bChildren = sortedByKey(bChildren)
	}
	for i := range aChildren {
		if err := c.same(aChildren[i], bChildren[i]); err != nil {
			return err
		}
	}
	return nil
}

// associatedDocCount follows the compiler's attachment rules rather than the
// lazy HasJSDoc hint. Declaration emission also recognizes @internal in an
// ordinary leading declaration comment; parameters have separate attachment rules.
func associatedDocCount(node *ast.Node, text string) int {
	var factory ast.NodeFactory
	count := len(parser.GetJSDocCommentRanges(&factory, nil, node, text))
	ordinaryInternal := func(comment ast.CommentRange) bool {
		raw := text[comment.Pos():comment.End()]
		return strings.Contains(raw, "@internal") && (!strings.HasPrefix(raw, "/**") || strings.HasPrefix(raw, "/**/"))
	}
	if node.Kind == ast.KindParameter && node.Parent != nil {
		// Declaration emission uses the last trailing/leading parameter comment.
		params := node.Parent.Parameters()
		index := slices.IndexFunc(params, func(p *ast.ParameterDeclarationNode) bool { return p.AsNode() == node })
		var comments []ast.CommentRange
		if index > 0 {
			position := scanner.SkipTriviaEx(text, params[index-1].End()+1, &scanner.SkipTriviaOptions{StopAtComments: true})
			for comment := range scanner.GetTrailingCommentRanges(&factory, text, position) {
				comments = append(comments, comment)
			}
			for comment := range scanner.GetLeadingCommentRanges(&factory, text, node.Pos()) {
				comments = append(comments, comment)
			}
		} else {
			position := scanner.SkipTriviaEx(text, node.Pos(), &scanner.SkipTriviaOptions{StopAtComments: true})
			for comment := range scanner.GetTrailingCommentRanges(&factory, text, position) {
				comments = append(comments, comment)
			}
		}
		if len(comments) > 0 && ordinaryInternal(comments[len(comments)-1]) {
			count++
		}
		return count
	}
	if ast.IsDeclaration(node) || ast.IsVariableStatement(node) || ast.IsExportAssignment(node) || ast.IsExportDeclaration(node) || ast.IsImportDeclaration(node) {
		for comment := range scanner.GetLeadingCommentRanges(&factory, text, node.Pos()) {
			if ordinaryInternal(comment) {
				count++
			}
		}
	}
	return count
}

// leafText returns the text of a name or literal.
func leafText(node *ast.Node) (string, bool) {
	switch node.Kind {
	case ast.KindIdentifier, ast.KindPrivateIdentifier, ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral,
		ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail, ast.KindRegularExpressionLiteral:
		return node.Text(), true
	}
	return "", false
}

func operator(node *ast.Node) ast.Kind {
	switch node.Kind {
	case ast.KindBinaryExpression:
		return node.AsBinaryExpression().OperatorToken.Kind
	case ast.KindPrefixUnaryExpression:
		return node.AsPrefixUnaryExpression().Operator
	case ast.KindPostfixUnaryExpression:
		return node.AsPostfixUnaryExpression().Operator
	}
	return ast.KindUnknown
}

func children(node *ast.Node) []*ast.Node {
	var result []*ast.Node
	node.ForEachChild(func(child *ast.Node) bool {
		result = append(result, child)
		return false
	})
	return result
}

// statements returns the children of node without the empty statements of a
// statement list: dprint's "asi" setting writes one before a statement that
// starts with a parenthesis or a bracket, as in ;(() => { ... })(), and it
// changes nothing. An empty statement that is the body of an if or a loop is
// that statement's child, not a list's, and stays.
func statements(node *ast.Node, nodes []*ast.Node) []*ast.Node {
	switch node.Kind {
	case ast.KindBlock, ast.KindSourceFile, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause:
	default:
		return nodes
	}
	return slices.DeleteFunc(slices.Clone(nodes), func(child *ast.Node) bool { return child.Kind == ast.KindEmptyStatement })
}

// unbraced returns the children of node, replacing a block that holds one
// statement with the statement when it is the body of an if, else, or loop,
// which dprint's useBraces settings write with or without braces. A
// declaration keeps its block, which scopes it.
func unbraced(node *ast.Node, nodes []*ast.Node) []*ast.Node {
	switch node.Kind {
	case ast.KindIfStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement, ast.KindWhileStatement, ast.KindDoStatement:
	default:
		return nodes
	}
	result := slices.Clone(nodes)
	for i, child := range result {
		if child.Kind != ast.KindBlock {
			continue
		}
		if statements := child.AsBlock().Statements.Nodes; len(statements) == 1 && statements[0].Kind != ast.KindVariableStatement && !ast.IsDeclarationStatement(statements[0]) {
			result[i] = statements[0]
		}
	}
	return result
}

// sortsChildren reports whether a formatter may reorder node's children:
// the specifiers of a named import or export.
func sortsChildren(node *ast.Node) bool {
	return node.Kind == ast.KindNamedImports || node.Kind == ast.KindNamedExports
}

// key is node's kind and leaf texts, which identify an import or a specifier
// whatever its layout.
func key(node *ast.Node) string {
	var b strings.Builder
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		fmt.Fprintf(&b, "%d(", n.Kind)
		if text, ok := leafText(n); ok {
			b.WriteString(text)
		}
		n.ForEachChild(visit)
		b.WriteString(")")
		return false
	}
	visit(unparenthesize(node))
	return b.String()
}

func sortedByKey(nodes []*ast.Node) []*ast.Node {
	sorted := slices.Clone(nodes)
	slices.SortStableFunc(sorted, func(a, b *ast.Node) int { return strings.Compare(key(a), key(b)) })
	return sorted
}
