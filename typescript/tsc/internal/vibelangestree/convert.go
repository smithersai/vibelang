package vibelangestree

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The conversion follows @typescript-eslint/typescript-estree 8 (convert.ts)
// node for node, so ESLint rules written for TypeScript read a .vibe file's
// TypeScript forms exactly as they read a .ts file's. The differential test
// (packages/compiler/test/eslint) holds the two to the same output on a
// TypeScript corpus. VibeLang's own forms are in vibelang.go.

// conversionError records the first fatal conversion or syntax error encountered.
type conversionError struct {
	pos     int
	message string
}

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
	// err holds the first unrecoverable conversion error, avoiding panics.
	err *conversionError
}

// unsupported is a node the converter has no ESTree form for.
type unsupported struct {
	node *ast.Node
	pos  int
}

// Error returns a formatted diagnostic describing the unsupported AST node kind.
func (u unsupported) Error() string {
	return fmt.Sprintf("VibeLang's ESLint parser has no ESTree form for %s", strings.TrimPrefix(u.node.Kind.String(), "Kind"))
}

// syntaxError is a parse error at a byte offset.
type syntaxError struct {
	pos     int
	message string
}

// Error returns the syntax error message.
func (e syntaxError) Error() string { return e.message }

func (c *converter) recordError(pos int, message string) {
	if c.err == nil {
		c.err = &conversionError{pos: pos, message: message}
	}
}

func (c *converter) fail(n *ast.Node) *obj {
	u := unsupported{node: n, pos: c.start(n)}
	c.recordError(u.pos, u.Error())
	return nil
}

func (c *converter) syntaxFail(pos int, message string) *obj {
	c.recordError(pos, message)
	return nil
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
	start := c.start(n)
	end := max(n.End(), 0)
	if c.vibe && (synthesized(n) || ast.NodeIsMissing(n)) {
		for end > start && end <= len(c.text) && (c.text[end-1] == ' ' || c.text[end-1] == '\t' || c.text[end-1] == '\r' || c.text[end-1] == '\n') {
			end--
		}
		if start == end && end > 0 && end <= len(c.text) {
			trimmed := end
			for trimmed > 0 && (c.text[trimmed-1] == ' ' || c.text[trimmed-1] == '\t' || c.text[trimmed-1] == '\r' || c.text[trimmed-1] == '\n') {
				trimmed--
			}
			if trimmed > 0 {
				start, end = trimmed, trimmed
			}
		}
	}
	return span{start, end}
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
	if n == nil || c.err != nil {
		return nil
	}
	saved := c.allowPattern
	c.allowPattern = allowPattern
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
		if c.err != nil {
			break
		}
		out = append(out, c.convertChild(n, parent))
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

// ---------------------------------------------------------------- nodes

func (c *converter) convertNode(n *ast.Node, parent *ast.Node) *obj {
	if c.err != nil {
		return nil
	}
	if result, ok := c.convertVibeLang(n, parent); ok {
		return result
	}
	if result := c.convertJSX(n); result != nil {
		return result
	}
	if result, ok := c.convertStatementNode(n, parent); ok {
		return result
	}
	if result, ok := c.convertDeclarationNode(n, parent); ok {
		return result
	}
	if result, ok := c.convertClassMemberNode(n, parent); ok {
		return result
	}
	if result, ok := c.convertPatternOrParamNode(n, parent); ok {
		return result
	}
	if result, ok := c.convertExpressionNode(n, parent); ok {
		return result
	}
	if result, ok := c.convertTypeNode(n, parent); ok {
		return result
	}
	return c.fail(n)
}
