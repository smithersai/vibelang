package vibelang

import (
	"context"
	"slices"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const concurrentHeadRenameLabel = "concurrent head renames"

// The old lowering let an RHS capture resolve to an outer binding. If the
// correct head type now rejects that capture, rename the item binding and its
// own uses, leaving the RHS's outer binding and its live identity unchanged.
// No value is copied and no user function is moved or invoked.
func concurrentHeadMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !file.IsVibeLang() {
		return p
	}
	ds := program.GetSemanticDiagnostics(ctx, file)
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var cells []*ast.Node
	var taken []string
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			taken = append(taken, n.Text())
		}
		if ast.IsVariableDeclaration(n) && parser.VibeLangDoHeadBinding(n) != nil {
			cells = append(cells, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	var used []sourceEdit
	for _, cell := range cells {
		binding := parser.VibeLangDoHeadBinding(cell)
		fn := ast.FindAncestor(binding, isConcurrentBody)
		if fn == nil {
			continue
		}
		call := fn.Parent
		items := call.Arguments()[0]
		headBlock := cell.Parent.Parent.Parent
		// Start outside the synthesized head environment.
		outer := c.ResolveName(cell.Name().Text(), headBlock.Parent.Parent, ast.SymbolFlagsValue, true)
		own := c.GetSymbolAtLocation(cell.Name())
		if outer == nil || own == nil || outer == own || !concurrentCaptureRejected(c, file, items, own, ds) {
			continue
		}
		name := binding.Name()
		fresh := uniqueName(name.Text(), taken)
		edits := concurrentItemRenameEdits(c, file, fn, name, fresh)
		key := "concurrentHeadRename:" + name.Text() + ":" + strconv.Itoa(nodeStart(file, name))
		if refused[key] || slices.ContainsFunc(edits, func(e sourceEdit) bool { return overlapsAny(e, used) }) {
			continue
		}
		p.fixes = append(p.fixes, fileFix{edits: edits, key: key, label: concurrentHeadRenameLabel})
		used = append(used, edits...)
		taken = append(taken, fresh)
	}
	return p
}

// A diagnostic must belong to the capture's own expression. Do not rename a
// valid capture because a sibling comma operand has an unrelated error.
func concurrentCaptureRejected(c *checker.Checker, file *ast.SourceFile, items *ast.Node, symbol *ast.Symbol, ds []*ast.Diagnostic) bool {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && n.Flags&ast.NodeFlagsReparsed == 0 && c.GetSymbolAtLocation(n) == symbol {
			for parent := n; parent != nil && parent != items.Parent; parent = parent.Parent {
				if ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
					break
				}
				for _, d := range ds {
					if d.Source() != "" || d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Pos() <= nodeStart(file, n) && n.End() <= d.End() {
						return true
					}
					if ast.IsPropertyAccessExpression(parent) && concurrentCaptureValue(parent.Expression(), n) && d.Pos() >= parent.Name().Pos() && d.End() <= parent.Name().End() {
						return true
					}
					if ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
						right := ast.SkipParentheses(parent.AsBinaryExpression().Right)
						left := parent.AsBinaryExpression().Left
						if ast.IsArrowFunction(right) && concurrentCaptureValue(right.Body(), n) && d.Pos() >= left.Pos() && d.End() <= left.End() {
							return true
						}
					}
				}
				if parent == items {
					break
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(items)
}

func concurrentItemRenameEdits(c *checker.Checker, file *ast.SourceFile, fn, name *ast.Node, fresh string) []sourceEdit {
	symbol := c.GetSymbolAtLocation(name)
	replacement := fresh
	if ast.IsBindingElement(name.Parent) && name.Parent.AsBindingElement().PropertyName == nil && name.Parent.Parent.Kind == ast.KindObjectBindingPattern {
		replacement = name.Text() + ": " + fresh
	}
	edits := []sourceEdit{{nodeStart(file, name), name.End(), replacement}}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n != name && ast.IsIdentifier(n) && n.Flags&ast.NodeFlagsReparsed == 0 && n.Text() == name.Text() {
			text := fresh
			match := c.GetSymbolAtLocation(n) == symbol
			if ast.IsShorthandPropertyAssignment(n.Parent) && n.Parent.Name() == n {
				match = c.GetShorthandAssignmentValueSymbol(n.Parent) == symbol
				text = name.Text() + ": " + fresh
			}
			if match {
				edits = append(edits, sourceEdit{nodeStart(file, n), n.End(), text})
			}
		}
		return n.ForEachChild(visit)
	}
	fn.ForEachChild(visit)
	slices.SortStableFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	return edits
}

// concurrentCaptureValue recognizes a read whose result depends only on this
// capture, without treating a failing sibling operand as a capture failure.
func concurrentCaptureValue(value, capture *ast.Node) bool {
	value = ast.SkipParentheses(value)
	if value == capture {
		return true
	}
	switch value.Kind {
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
		return concurrentCaptureValue(value.Expression(), capture)
	case ast.KindAsExpression, ast.KindTypeAssertionExpression, ast.KindNonNullExpression:
		return concurrentCaptureValue(value.Expression(), capture)
	}
	return false
}
