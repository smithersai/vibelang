package vibelang

import (
	"context"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A catch handler is a plain or effect arrow or function expression, possibly
// parenthesized, so its syntax alone decides its kind (VIP-5, amended
// 2026-10-29). Anything else after catch is EK0509: a name, a call, any other
// value, an effect { … } block, a class expression, or an async or generator
// function. The quick fix wraps a value in a function literal, so the
// handler's kind stays visible, and removes async or * from a function:
//
//	x catch guest                x catch () => guest
//	x catch onErr                x catch (e) => onErr(e)        (onErr a function)
//	x catch Effect.succeed(1)    x catch effect () => try Effect.succeed(1)
//	x catch effect { … }         x catch effect () => { … }
//	x catch async (e) => 7       x catch (e) => 7
//	x catch function* (e) { }    x catch function (e) { }
//
// An Effect value gets an effect handler that runs it, as the legacy fallback
// did; a plain () => effect would hold it as data (EK0508).

// EK0509: a catch handler that is no function literal.
var EK0509 = message(509, errorCategory, "A catch handler that is not a plain or effect arrow or function expression. Run an Effect with try inside effect code; use a function literal as the catch handler.")

func init() {
	registry[EK0509.Code] = EK0509
	tsFormFixCodes = append(tsFormFixCodes, EK0509.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0509.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0509.Code}, GetCodeActions: catchHandlerActions})
}

// malformedCatchHandler returns the handler of a catch expression the parser
// wrote when it is no admitted function literal, or nil. fallback is what
// catchParts returns.
func malformedCatchHandler(call, fallback *ast.Node) *ast.Node {
	if fallback == nil {
		if handler := call.Arguments()[1]; isAsyncOrGenerator(handler) {
			return handler
		}
		return nil
	}
	inner := ast.SkipParentheses(fallback)
	if (ast.IsArrowFunction(inner) || ast.IsFunctionExpression(inner)) && !isEffectBlock(inner) && !isAsyncOrGenerator(inner) {
		// A parenthesized function literal or a function expression is a
		// handler the parser does not admit yet (catch-parenthesized-literal-parse).
		return nil
	}
	return fallback
}

func isAsyncOrGenerator(fn *ast.Node) bool {
	if !ast.IsArrowFunction(fn) && !ast.IsFunctionExpression(fn) {
		return false
	}
	return ast.GetFunctionFlags(fn)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0
}

func checkCatchHandler(c *checker.Checker, file *ast.SourceFile, call, fallback *ast.Node) {
	handler := malformedCatchHandler(call, fallback)
	if handler == nil {
		return
	}
	d := reportAt(c, file, core.NewTextRange(scanner.SkipTrivia(file.Text(), handler.Pos()), handler.End()), EK0509)
	if catchHandlerNeedsConversion(handler) {
		note(d, "This handler uses await or yield at its own function level; an explicit body conversion is needed before removing async or *.")
	} else if _, text := catchHandlerRepair(c, file, call, handler); text != "" {
		note(d, "Write it as a function literal: {0}.", text)
	}
}

// catchHandlerRepair returns the edits that make handler a function literal
// and the repaired handler's text, or nil when there is no mechanical repair
// (a class expression or an async/generator body needing conversion).
func catchHandlerRepair(c *checker.Checker, file *ast.SourceFile, call, handler *ast.Node) ([]core.TextChange, string) {
	text := file.Text()
	start := scanner.SkipTrivia(text, handler.Pos())
	source := text[start:handler.End()]
	inner := ast.SkipParentheses(handler)
	if isAsyncOrGenerator(inner) {
		if catchHandlerNeedsConversion(handler) {
			return nil, ""
		}
		var edits []core.TextChange
		for _, modifier := range inner.ModifierNodes() {
			if modifier.Kind == ast.KindAsyncKeyword {
				r := scanner.GetRangeOfTokenAtPosition(file, modifier.Pos())
				edits = append(edits, core.TextChange{TextRange: core.NewTextRange(r.Pos(), scanner.SkipTriviaEx(text, r.End(), &scanner.SkipTriviaOptions{StopAtComments: true})), NewText: ""})
			}
		}
		if ast.IsFunctionExpression(inner) && inner.AsFunctionExpression().AsteriskToken != nil {
			r := scanner.GetRangeOfTokenAtPosition(file, inner.AsFunctionExpression().AsteriskToken.Pos())
			edits = append(edits, core.TextChange{TextRange: r, NewText: ""})
		}
		return edits, applyTextChanges(text, edits)[start : handler.End()-removedLength(edits)]
	}
	var repaired string
	switch {
	case isEffectBlock(inner):
		// effect { … } becomes effect () => { … }.
		keyword := scanner.SkipTrivia(text, inner.Pos())
		repaired = source[:keyword-start+len("effect")] + " () =>" + source[keyword-start+len("effect"):]
	case ast.IsClassExpression(inner):
		return nil, ""
	default:
		t := c.GetTypeAtLocation(inner)
		switch {
		case effectOfValue(c, t) != nil || (ast.IsCallExpression(inner) || ast.IsNewExpression(inner)) && callReturnsEffect(c, inner):
			// In effect code a call that returns an Effect runs where it
			// stands, so its own type is what the Effect succeeds with.
			repaired = "effect () => try " + source
		case len(c.GetSignaturesOfType(c.GetApparentType(t), checker.SignatureKindCall)) != 0:
			name := freshCatchParameter(c, handler)
			callee := source // a name, a property or a parenthesized expression
			if inner == handler && !ast.IsIdentifier(inner) && !ast.IsPropertyAccessExpression(inner) {
				callee = "(" + source + ")"
			}
			repaired = "(" + name + ") => " + callee + "(" + name + ")"
		default:
			// An object literal as the body of an arrow needs parentheses,
			// or its braces are a block (foldkit-17069: catch { directory }).
			body := source
			if strings.HasPrefix(body, "{") {
				body = "(" + body + ")"
			}
			repaired = "() => " + body
		}
	}
	edits := []core.TextChange{{TextRange: core.NewTextRange(start, handler.End()), NewText: repaired}}
	if catchHandlerNeedsParentheses(call) {
		// The arrow would take in what follows, so the whole catch
		// expression is parenthesized: (x catch () => a) catch () => b.
		edits = append([]core.TextChange{{TextRange: core.NewTextRange(scanner.SkipTrivia(text, call.Pos()), scanner.SkipTrivia(text, call.Pos())), NewText: "("}}, edits...)
		edits[1].NewText += ")"
	}
	return edits, repaired
}

// Removing async and/or * cannot leave their own await/yield operations.
// Nested function bodies keep their modifiers; computed method names still
// execute at the enclosing function level.
func catchHandlerNeedsConversion(handler *ast.Node) bool {
	fn := ast.SkipParentheses(handler)
	if !isAsyncOrGenerator(fn) || fn.Body() == nil {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) {
			// Names and decorators execute before a method's body boundary.
			if name := n.Name(); name != nil && ast.IsComputedPropertyName(name) && visit(name) {
				return true
			}
			for _, modifier := range n.ModifierNodes() {
				if ast.IsDecorator(modifier) && visit(modifier) {
					return true
				}
			}
			return false
		}
		if ast.IsAwaitExpression(n) || ast.IsYieldExpression(n) ||
			n.Kind == ast.KindForOfStatement && n.AsForInOrOfStatement().AwaitModifier != nil ||
			ast.IsVariableDeclarationList(n) && ast.IsVarAwaitUsing(n) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(fn.Body())
}

func removedLength(edits []core.TextChange) int {
	n := 0
	for _, edit := range edits {
		n += edit.Len() - len(edit.NewText)
	}
	return n
}

func applyTextChanges(text string, edits []core.TextChange) string {
	for i := len(edits) - 1; i >= 0; i-- {
		text = text[:edits[i].Pos()] + edits[i].NewText + text[edits[i].End():]
	}
	return text
}

// freshCatchParameter uses the checker's decoded bindings, including names
// written with Unicode escapes. Check every candidate, including the fallback;
// source-text words mistake comments for reads and miss escaped identifiers.
func freshCatchParameter(c *checker.Checker, handler *ast.Node) string {
	for _, name := range []string{"e", "error", "failure", "$e"} {
		if c.ResolveName(name, handler, ast.SymbolFlagsAll, false) == nil {
			return name
		}
	}
	for i := 2; ; i++ {
		name := "$e" + strconv.Itoa(i)
		if c.ResolveName(name, handler, ast.SymbolFlagsAll, false) == nil {
			return name
		}
	}
}

// catchHandlerNeedsParentheses reports whether an arrow written as call's
// handler would take in what follows call: an arrow's concise body extends as
// far as an assignment expression does, so in `x catch a catch b`,
// `x catch a ? b : c` or `x catch a as T` the repaired handler is
// parenthesized.
func catchHandlerNeedsParentheses(call *ast.Node) bool {
	parent := call.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsConditionalExpression(parent):
		return parent.AsConditionalExpression().Condition == call
	case ast.IsBinaryExpression(parent):
		return parent.AsBinaryExpression().Left == call && parent.AsBinaryExpression().OperatorToken.Kind != ast.KindCommaToken
	case ast.IsAsExpression(parent), ast.IsSatisfiesExpression(parent):
		return true
	case isProgramArrow(parent):
		outer := catchExpressionOf(parent.Parent)
		return outer != nil && outer.Arguments()[0] == parent
	}
	return false
}

func catchHandlerActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var call, handler *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if found := catchExpressionOf(n); found != nil {
			_, fallback := catchParts(found)
			if h := malformedCatchHandler(found, fallback); h != nil && scanner.SkipTrivia(fix.SourceFile.Text(), h.Pos()) == fix.Span.Pos() && h.End() == fix.Span.End() {
				call, handler = found, h
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if handler == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	edits, text := catchHandlerRepair(c, fix.SourceFile, call, handler)
	if len(edits) == 0 {
		return nil, nil
	}
	var changes []*lsproto.TextEdit
	for _, edit := range edits {
		changes = append(changes, replaceRange(fix, edit.Pos(), edit.End(), edit.NewText)...)
	}
	return []*ls.CodeAction{{Description: "Write the handler as " + text, Changes: changes}}, nil
}
