package vibelangfmt

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Return-type grouping and comments survive into declaration emit even when
// redundant for type checking. Keep their order through a TypeScript host.
type returnTypeShape struct {
	kind             ast.Kind
	opens, closes    []int
	prefixComments   int
	trailingComments int
	children         []returnTypeShape
}

type typeGroupToken struct {
	pos, end, comments int
	paren              byte
	line               bool
}

// Only parentheses, comment trivia and whitespace occur between the outside
// of a parenthesized type and its unwrapped type.
func typeGroupTokens(text string, start, end int) ([]typeGroupToken, int) {
	var result []typeGroupToken
	comments := 0
	for at := start; at < end; {
		token := typeGroupToken{pos: at, comments: comments}
		switch {
		case strings.HasPrefix(text[at:end], "/*"):
			close := strings.Index(text[at+2:end], "*/")
			if close < 0 {
				return result, comments
			}
			at += close + 4
			comments++
		case strings.HasPrefix(text[at:end], "//"):
			token.line = true
			close := strings.IndexAny(text[at:end], "\r\n")
			if close < 0 {
				at = end
			} else {
				at += close
			}
			comments++
		case text[at] == '(' || text[at] == ')':
			token.paren = text[at]
			at++
		default:
			at++
			continue
		}
		token.end = at
		result = append(result, token)
	}
	return result, comments
}

func groupParens(tokens []typeGroupToken, paren byte) []typeGroupToken {
	var result []typeGroupToken
	for _, token := range tokens {
		if token.paren == paren {
			result = append(result, token)
		}
	}
	return result
}

// A nested last child can release its own trailing comments when its groups
// disappear. Count those before anchoring the enclosing type's closing groups.
func trailingTypeComments(node *ast.Node, text string) int {
	part := text[node.Pos():node.End()]
	s := scanner.NewScanner()
	s.SetText(part)
	last := 0
	for token := s.Scan(); token != ast.KindEndOfFile; token = s.Scan() {
		if token != ast.KindCloseParenToken {
			last = s.TokenEnd()
		}
	}
	_, comments := typeGroupTokens(part, last, len(part))
	return comments
}

func returnTypes(file *ast.SourceFile) []*ast.Node {
	var result []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var returned *ast.Node
		if ast.IsFunctionLike(node) {
			returned = node.Type()
			if returned != nil {
				result = append(result, returned)
			}
		}
		return node.ForEachChild(func(child *ast.Node) bool {
			// Nested signatures in a returned type belong to this shape.
			if child == returned {
				return false
			}
			return visit(child)
		})
	}
	file.AsNode().ForEachChild(visit)
	return result
}

func returnShape(node *ast.Node, text string) returnTypeShape {
	outer := node
	for node.Kind == ast.KindParenthesizedType {
		node = node.Type()
	}
	shape := returnTypeShape{kind: node.Kind}
	prefix, count := typeGroupTokens(text, outer.Pos(), scanner.SkipTrivia(text, node.Pos()))
	shape.prefixComments = count
	for _, token := range groupParens(prefix, '(') {
		shape.opens = append(shape.opens, token.comments)
	}
	suffix, _ := typeGroupTokens(text, node.End(), outer.End())
	for _, token := range groupParens(suffix, ')') {
		shape.closes = append(shape.closes, token.comments)
	}
	if len(shape.closes) != 0 {
		shape.trailingComments = trailingTypeComments(node, text)
	}
	node.ForEachChild(func(child *ast.Node) bool {
		shape.children = append(shape.children, returnShape(child, text))
		return false
	})
	return shape
}

func (enc *encoding) recordReturnTypes(file *ast.SourceFile) {
	for _, node := range returnTypes(file) {
		enc.returnTypes = append(enc.returnTypes, returnShape(node, enc.text))
	}
}

// A host can lift a comment out of parentheses it removes. Inserting at
// SkipTrivia would leave that comment outside the restored type and change
// declaration emit. Anchor each written delimiter by its adjacent comments.
func (d *decoder) restoreTypeGroups(outer, inner *ast.Node, shape returnTypeShape) {
	prefix, prefixComments := typeGroupTokens(d.text, outer.Pos(), d.start(inner))
	opens := groupParens(prefix, '(')
	suffix, _ := typeGroupTokens(d.text, inner.End(), scanner.SkipTrivia(d.text, outer.End()))
	closes := groupParens(suffix, ')')

	openAt := func(count int) int {
		for _, token := range prefix {
			if token.comments >= count {
				return token.pos
			}
		}
		return d.start(inner)
	}
	closeAt := func(count int) (int, string) {
		at, line := inner.End(), false
		for _, token := range suffix {
			if token.paren == ')' && token.comments <= count {
				at, line = token.end, false
			} else if token.paren == 0 && token.comments < count {
				at, line = token.end, token.line
			}
		}
		if line {
			for at < len(d.text) && strings.ContainsRune(" \t\r\n", rune(d.text[at])) {
				at++
			}
			if at < len(d.text) && strings.ContainsRune("{=/|&", rune(d.text[at])) {
				return at, ") "
			}
		}
		return at, ")"
	}
	removeOpen := func(token typeGroupToken) {
		end := token.end
		for end < len(d.text) && (d.text[end] == ' ' || d.text[end] == '\t') {
			end++
		}
		d.replace(token.pos, end, "")
	}
	removeClose := func(token typeGroupToken) {
		start := token.pos
		for start > inner.End() && (d.text[start-1] == ' ' || d.text[start-1] == '\t') {
			start--
		}
		d.replace(start, token.end, "")
	}

	// Hosts retain the innermost group when precedence requires it.
	offset := len(shape.opens) - len(opens)
	for i, token := range opens {
		if i+offset < 0 {
			removeOpen(token)
		}
	}
	for i, count := range shape.opens {
		// Ancestor groups can release leading comments into the first child's
		// trivia. The child's original comments remain the suffix of it.
		count = max(0, count+prefixComments-shape.prefixComments)
		host := i - offset
		if host >= 0 && opens[host].comments == count {
			continue
		}
		if host >= 0 {
			removeOpen(opens[host])
		}
		d.insert(openAt(count), "(")
	}
	for i, token := range closes {
		if i >= len(shape.closes) {
			removeClose(token)
		}
	}
	trailing := 0
	if len(shape.closes) != 0 {
		trailing = shape.trailingComments - trailingTypeComments(inner, d.text)
	}
	for i, count := range shape.closes {
		count = max(0, count+trailing)
		if i < len(closes) && closes[i].comments == count {
			continue
		}
		if i < len(closes) {
			removeClose(closes[i])
		}
		at, text := closeAt(count)
		d.insert(at, text)
	}
}

func (d *decoder) restoreReturnTypes() error {
	nodes := returnTypes(d.file)
	if len(nodes) != len(d.enc.returnTypes) {
		return fmt.Errorf("vibelang format: internal error: the formatter changed the number of return types")
	}
	var restore func(*ast.Node, returnTypeShape) error
	restore = func(node *ast.Node, shape returnTypeShape) error {
		outer := node
		for node.Kind == ast.KindParenthesizedType {
			node = node.Type()
		}
		if node.Kind != shape.kind {
			return fmt.Errorf("vibelang format: internal error: the formatter changed a return type")
		}
		inner := children(node)
		if len(inner) != len(shape.children) {
			return fmt.Errorf("vibelang format: internal error: the formatter changed a return type's children")
		}
		d.restoreTypeGroups(outer, node, shape)
		for i, child := range inner {
			if err := restore(child, shape.children[i]); err != nil {
				return err
			}
		}
		return nil
	}
	for i, node := range nodes {
		if err := restore(node, d.enc.returnTypes[i]); err != nil {
			return err
		}
	}
	return nil
}
