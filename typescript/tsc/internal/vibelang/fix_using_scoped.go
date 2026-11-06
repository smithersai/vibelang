package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK0801.Code},
		GetCodeActions: usingScopedActions,
	})
}

// usingScopedActions is EK0801's fix: the rest of an Effect callable's body
// moves into scoped, and each value is acquired with acquireDisposable, so it is
// released on every Exit:
//
//	using f = openFile()                 return try scoped(effect {
//	return try read(f)                     const f = try acquireDisposable(effect { return openFile() })
//	                                       return try read(f)
//	                                     })
//
// This changes what a failure does, which is the point of the warning, so the
// fix is an editor action and never runs under vibelang --fix. It applies where
// the move keeps every jump: directly in the body of a non-producer Effect
// callable, whose return the new block can carry.
func usingScopedActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	var statement *ast.Node
	var find func(*ast.Node) bool
	find = func(node *ast.Node) bool {
		if node.End() < fix.Span.Pos() || node.Pos() > fix.Span.End() {
			return false
		}
		if isBlockUsing(node) && nodeStart(file, node.AsVariableStatement().DeclarationList) == fix.Span.Pos() {
			statement = node
			return true
		}
		return node.ForEachChild(find)
	}
	file.AsNode().ForEachChild(find)
	if statement == nil {
		return nil, nil
	}
	block, callable := statement.Parent, statement.Parent.Parent
	if callable == nil || !ast.IsFunctionLike(callable) || callable.Body() != block || markedForm(callable) != formEffect || isProducer(callable) {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	if usingScopedMovesReferencedBinding(c, file, statement) {
		return nil, nil
	}
	a := analyzerFor(c)
	for _, name := range []string{"scoped", "acquireDisposable"} {
		if !isEffectGlobalAt(c, name, block) {
			return nil, nil
		}
	}
	text := file.Text()
	start := nodeStart(file, statement)
	indent := lineIndent(text, start)
	var body strings.Builder
	body.WriteString("return try scoped(effect {\n")
	body.WriteString(indent + "  const")
	cursor := start + len("using")
	for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
		initializer := declaration.Initializer()
		t := c.GetTypeAtLocation(declaration.Name())
		if initializer == nil || usingScopedLosesName(initializer) || a.runsEffect(initializer) || t.Flags()&checker.TypeFlagsAny != 0 || c.GetNonNullableType(t) != t || !c.IsSyncDisposableType(t) {
			return nil, nil
		}
		// Keep the written declaration and its trivia; only wrap each initializer.
		// Parentheses let a leading line comment follow return without ending it.
		body.WriteString(text[cursor:initializer.Pos()])
		body.WriteString("try acquireDisposable(effect { return (")
		body.WriteString(text[initializer.Pos():initializer.End()])
		body.WriteString(") })")
		cursor = initializer.End()
	}
	body.WriteString(text[cursor:statement.End()] + "\n")
	end := block.End() - 1
	rest := strings.TrimRight(text[statement.End():end], " \t\r\n")
	rest = strings.TrimPrefix(strings.TrimLeft(rest, " \t\r\n;"), ";")
	if rest != "" {
		body.WriteString(indent + "  " + rest + "\n")
	}
	body.WriteString(indent + "})\n" + lineIndent(text, end))
	return []*ls.CodeAction{{
		Description: "Acquire with acquireDisposable inside scoped",
		Changes:     replaceRange(fix, start, end, body.String()),
	}}, nil
}

// isEffectGlobalAt reports whether name at location resolves to the export of
// effect/Effect that VIP-6 puts in scope.
func isEffectGlobalAt(c *checker.Checker, name string, location *ast.Node) bool {
	symbol := c.ResolveName(name, location, ast.SymbolFlagsValue, false /*excludeGlobals*/)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	return symbol != nil && len(symbol.Declarations()) > 0 && effectModuleOfFile(ast.GetSourceFileOfNode(symbol.Declarations()[0])) == "Effect"
}

// Moving the suffix into an Effect block must not hide a declaration from
// earlier code, including closures, hoisted functions and type references.
// Resolve symbols so property names and shadowing locals stay unrelated.
func usingScopedMovesReferencedBinding(c *checker.Checker, file *ast.SourceFile, statement *ast.Node) bool {
	block := statement.Parent
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			symbol := c.GetSymbolAtLocation(node)
			if node.Parent.Kind == ast.KindShorthandPropertyAssignment {
				symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
			}
			if symbol != nil {
				for _, declaration := range symbol.Declarations() {
					if ast.GetSourceFileOfNode(declaration) == file &&
						declaration.Pos() >= statement.Pos() && declaration.End() <= block.End() {
						return true
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	for _, earlier := range block.Statements() {
		if earlier == statement {
			break
		}
		if visit(earlier) {
			return true
		}
	}
	return false
}

// The acquisition callback returns a value, so it cannot supply the using
// binding's inferred name. A class static initializer can observe that name
// before acquisition finishes; assigning .name afterward would be too late.
func usingScopedLosesName(initializer *ast.Node) bool {
	value := ast.SkipOuterExpressions(initializer, ast.OEKAll)
	return ast.IsArrowFunction(value) ||
		(ast.IsFunctionExpression(value) || ast.IsClassExpression(value)) && value.Name() == nil
}
