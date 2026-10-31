package vibelangfmt

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// patternBodies finds the bodies controlled by an is condition in the
// TypeScript projection. Use this tree, before lowering, because a binding is
// becomes nested tests and declarations, and its else becomes a list element.
func patternBodies(node *ast.Node) (*ast.Node, []*ast.Node) {
	for node.Parent != nil {
		parent := node.Parent
		switch parent.Kind {
		case ast.KindIfStatement:
			if parent.Expression() == node {
				bodies := []*ast.Node{parent.AsIfStatement().ThenStatement}
				if other := parent.AsIfStatement().ElseStatement; other != nil {
					bodies = append(bodies, other)
				}
				return parent, bodies
			}
			return nil, nil
		case ast.KindWhileStatement:
			if parent.Expression() == node {
				return parent, []*ast.Node{parent.Statement()}
			}
			return nil, nil
		case ast.KindBlock, ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindFunctionDeclaration:
			return nil, nil
		}
		node = parent
	}
	return nil, nil
}

// recordPatternBodies gives one placeholder per condition its original brace
// choices. TypeScript formatters may add or remove these braces; VibeLang's
// lowered AST is sensitive to that choice even for a single return statement.
func (enc *encoding) recordPatternBodies(file *ast.SourceFile) {
	d := decoder{enc: enc}
	seen := map[*ast.Node]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if index := d.placeholderOf(node); index >= 0 && enc.placeholders[index].kind == placeholderIsPattern {
			control, bodies := patternBodies(node)
			if control != nil && !seen[control] {
				seen[control] = true
				for _, body := range bodies {
					enc.placeholders[index].bodyKinds = append(enc.placeholders[index].bodyKinds, body.Kind)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func (d *decoder) restorePatternBodies(node *ast.Node, kinds []ast.Kind) error {
	if len(kinds) == 0 {
		return nil
	}
	control, bodies := patternBodies(node)
	if len(bodies) != len(kinds) {
		return fmt.Errorf("vibelang format: internal error: an is condition lost its bodies")
	}
	for i, body := range bodies {
		braced := body.Kind == ast.KindBlock
		if braced == (kinds[i] == ast.KindBlock) {
			continue
		}
		if kinds[i] == ast.KindBlock {
			d.rebrace(control, body)
		} else {
			// ASI styling may add empty statements inside a new block.
			// They cannot become the body's statement when the block goes away.
			inner := body.AsBlock().Statements.Nodes
			significant := statements(body, inner)
			if kinds[i] == ast.KindEmptyStatement {
				significant = inner
			}
			if len(significant) != 1 {
				return fmt.Errorf("vibelang format: internal error: an is body is no longer one statement")
			}
			if kinds[i] != ast.KindEmptyStatement {
				for _, child := range inner {
					if child.Kind == ast.KindEmptyStatement {
						d.replace(d.start(child), child.End(), "")
					}
				}
			}
			start := d.start(body)
			d.replace(start, start+1, "")
			d.replace(body.End()-1, body.End(), "")
		}
	}
	return nil
}

// rebrace restores the braces a host removed from body, the one statement of
// control, an if or while whose condition binds. The host laid the statement
// out without braces, so write the block as the host writes one it keeps: the
// statement on its own line, one step deeper than control, and the closing
// brace on the line of control, before any else. Comments stay with the body.
func (d *decoder) rebrace(control, body *ast.Node) {
	indent := lineIndent(d.text, d.start(control))
	open, start := body.Pos(), d.start(body)
	if hasComment(d.text[open:start]) {
		d.insert(open, " {")
	} else {
		d.replace(open, start, " {\n"+indent+indentUnit(d.text, d.start(control)))
	}
	closeAt := endOfLineTrivia(d.text, body.End())
	next := scanner.SkipTrivia(d.text, closeAt)
	if startsWithWord(d.text[next:], "else") && !hasComment(d.text[closeAt:next]) {
		d.replace(closeAt, next, "\n"+indent+"} ")
		return
	}
	d.insert(closeAt, "\n"+indent+"}")
}

// endOfLineTrivia returns the position after the spaces and comments that
// follow pos on its line, before the line break or the next token.
func endOfLineTrivia(text string, pos int) int {
	for pos < len(text) {
		switch {
		case text[pos] == ' ' || text[pos] == '\t':
			pos++
		case strings.HasPrefix(text[pos:], "//"):
			end := strings.IndexAny(text[pos:], "\r\n")
			if end < 0 {
				return len(text)
			}
			return pos + end
		case strings.HasPrefix(text[pos:], "/*"):
			end := strings.Index(text[pos:], "*/")
			if end < 0 || strings.ContainsAny(text[pos:pos+end], "\r\n") {
				return pos
			}
			pos += end + len("*/")
		default:
			return pos
		}
	}
	return pos
}

// indentUnit guesses the host's indentation step at pos: the first deeper
// line after it, else the shallowest indentation in the text, else two spaces.
func indentUnit(text string, pos int) string {
	indent := lineIndent(text, pos)
	for at := pos; at < len(text); {
		newline := strings.IndexByte(text[at:], '\n')
		if newline < 0 {
			break
		}
		at += newline + 1
		deeper := lineIndent(text, at)
		if at+len(deeper) < len(text) && text[at+len(deeper)] != '\n' && text[at+len(deeper)] != '\r' && len(deeper) > len(indent) && strings.HasPrefix(deeper, indent) {
			return deeper[len(indent):]
		}
	}
	unit := ""
	for _, line := range strings.Split(text, "\n") {
		if step := lineIndent(line, 0); step != "" && strings.TrimSpace(line) != "" && (unit == "" || len(step) < len(unit)) {
			unit = step
		}
	}
	if unit == "" {
		return "  "
	}
	return unit
}
