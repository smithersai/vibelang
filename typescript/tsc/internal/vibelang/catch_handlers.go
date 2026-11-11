package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Catch handlers must be plain or effect function expressions (VIP-5).
// Other values, async functions and generators report EK0509. An explicit
// effect handler runs an Effect; a plain handler may hold it as data.

// EK0509: a catch handler that is no function literal.
var EK0509 = message(509, errorCategory, parser.VibeLangCatchHandlerMessage)

// recoverableSyntaxCodes are parser diagnostics whose recovery leaves an
// intact AST, so the checker still reports the file's independent semantic
// diagnostics, as tsc does for its modifier grammar errors. Catch arrows and
// provider separators keep their recovered bodies. A rejected effect
// accessor, constructor or effect/async pair keeps its native member, and the
// error-body rules skip it (restrictedEffectMember). A producer's valued
// return in a retained do keeps its statement, so the producer's other
// returns are still reported with it.
var recoverableSyntaxCodes = map[int32]bool{
	EK0509.Code: true,
	EK1202.Code: true,
	EK0104.Code: true,
	EK0105.Code: true,
	EK2128.Code: true,
}

func init() {
	checker.RegisterCallArgumentDiagnosticsFilterHook(func(c *checker.Checker, call *ast.Node, ds []*ast.Diagnostic) []*ast.Diagnostic {
		if len(ds) == 0 || catchExpressionOf(call) == nil || !isVibeLangFile(ast.GetSourceFileOfNode(call)) {
			return ds
		}
		_, fallback := catchParts(call)
		if malformedCatchHandler(call, fallback) == nil {
			return ds
		}
		// EK0509 owns this generated callback's applicability error, including
		// errors elaborated onto an async arrow's returned expression. Native
		// checks of written annotations and body expressions run separately.
		handler := call.Arguments()[1]
		start := nodeStart(ast.GetSourceFileOfNode(call), handler)
		return slices.DeleteFunc(slices.Clone(ds), func(d *ast.Diagnostic) bool {
			return start <= d.Pos() && d.End() <= handler.End()
		})
	})
	compiler.RegisterRecoverableSyntacticDiagnosticCallback(func(d *ast.Diagnostic) bool {
		return d.Source() == diagnosticSource && recoverableSyntaxCodes[d.Code()] || recoverableNativeSyntax(d)
	})
	registry[EK0509.Code] = EK0509
}

// malformedCatchHandler returns the handler of a catch expression the parser
// wrote when it is no admitted function literal, or nil. fallback is what
// catchParts returns.
func malformedCatchHandler(call, fallback *ast.Node) *ast.Node {
	if fallback == nil {
		if handler := call.Arguments()[1]; isAsyncOrGenerator(handler) || isCatchBlockHandler(handler) {
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

// isCatchBlockHandler reports whether handler is `(e) { B }`, a parameter
// list followed directly by a block, which the parser recovers as an arrow
// without its => (parser/vibelang_catch.go). It is EK0509, and the catch
// expression gets no EK0505 besides (chapter 2).
func isCatchBlockHandler(handler *ast.Node) bool {
	fn := ast.SkipParentheses(handler)
	if !ast.IsArrowFunction(fn) || fn.Body() == nil || !ast.IsBlock(fn.Body()) {
		return false
	}
	token := fn.AsArrowFunction().EqualsGreaterThanToken
	return token != nil && token.Pos() == token.End()
}

func isAsyncOrGenerator(fn *ast.Node) bool {
	if !ast.IsArrowFunction(fn) && !ast.IsFunctionExpression(fn) {
		return false
	}
	return ast.GetFunctionFlags(fn)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0
}

func checkCatchHandler(c *checker.Checker, file *ast.SourceFile, call, fallback *ast.Node) {
	if handler := call.Arguments()[1]; fallback == nil && ast.IsArrowFunction(handler) && ast.NodeIsMissing(handler.AsArrowFunction().EqualsGreaterThanToken) {
		// The parser owns EK0509 for this recovered head. Suppress only
		// its provisional argument mismatch, retaining errors in the body.
		coverArgument(c, handler)
		return
	}
	handler := malformedCatchHandler(call, fallback)
	if handler == nil || parser.IsVibeLangCatchHandlerContinuation(handler) {
		return // EK0512 owns this closed-handler grammar violation.
	}
	d := reportAt(c, file, core.NewTextRange(scanner.SkipTrivia(file.Text(), handler.Pos()), handler.End()), EK0509)
	if catchHandlerNeedsConversion(handler) {
		note(d, "This handler uses await or yield at its own function level; an explicit body conversion is needed before removing async or *.")
	} else if text := catchHandlerRepair(c, file, handler); text != "" {
		note(d, "Write it as a function literal: {0}.", text)
	} else if inner := ast.SkipParentheses(handler); isAsyncOrGenerator(inner) {
		if reason := catchNativeKeywordRefusal(c, inner); reason != "" {
			note(d, "{0}", reason)
		}
	}
}

// catchHandlerRepair returns a function literal's text for the diagnostic
// note, or an empty string when the handler needs an explicit conversion.
func catchHandlerRepair(c *checker.Checker, file *ast.SourceFile, handler *ast.Node) string {
	text := file.Text()
	start := scanner.SkipTrivia(text, handler.Pos())
	source := text[start:handler.End()]
	inner := ast.SkipParentheses(handler)
	if isAsyncOrGenerator(inner) {
		if catchHandlerNeedsConversion(handler) {
			return ""
		}
		if catchNativeKeywordRefusal(c, inner) != "" {
			return ""
		}
		var repaired strings.Builder
		cursor := start
		remove := func(from, to int) {
			repaired.WriteString(text[cursor:from])
			cursor = to
		}
		for _, modifier := range inner.ModifierNodes() {
			if modifier.Kind == ast.KindAsyncKeyword {
				r := scanner.GetRangeOfTokenAtPosition(file, modifier.Pos())
				remove(r.Pos(), scanner.SkipTriviaEx(text, r.End(), &scanner.SkipTriviaOptions{StopAtComments: true}))
			}
		}
		if ast.IsFunctionExpression(inner) && inner.AsFunctionExpression().AsteriskToken != nil {
			r := scanner.GetRangeOfTokenAtPosition(file, inner.AsFunctionExpression().AsteriskToken.Pos())
			remove(r.Pos(), r.End())
		}
		repaired.WriteString(text[cursor:handler.End()])
		return repaired.String()
	}
	var repaired string
	switch {
	case isEffectBlock(inner):
		// effect { … } becomes effect () => { … }.
		keyword := scanner.SkipTrivia(text, inner.Pos())
		repaired = source[:keyword-start+len("effect")] + " () =>" + source[keyword-start+len("effect"):]
	case ast.IsClassExpression(inner):
		return ""
	case isThrowExpression(file, inner):
		repaired = "effect () => " + source
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
	return repaired
}

// isThrowExpression reports whether node is a throw expression, the call of
// the function the parser writes around it (D186), whose first token is the
// source's throw.
func isThrowExpression(file *ast.SourceFile, node *ast.Node) bool {
	if !ast.IsCallExpression(node) || len(node.Arguments()) != 0 || node.Expression().Kind != ast.KindParenthesizedExpression {
		return false
	}
	keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
	return file.Text()[keyword.Pos():keyword.End()] == "throw"
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
			// Synchronous source do/match closures share this activation.
			// Native functions, async match and effect blocks keep their boundary.
			if isProgramArrow(n) && !isEffectBlock(n) && ast.GetFunctionFlags(n)&ast.FunctionFlagsAsync == 0 {
				return n.ForEachChild(visit)
			}
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
		if ast.IsAwaitExpression(n) || fiberHelper(n) == "$await" || ast.IsYieldExpression(n) ||
			n.Kind == ast.KindForOfStatement && n.AsForInOrOfStatement().AwaitModifier != nil ||
			ast.IsVariableDeclarationList(n) && ast.IsVarAwaitUsing(n) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(fn.Body())
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

// catchNativeKeywordRefusal keeps the result a valid plain handler when the
// malformed native function loses async or *. A written contract needs an
// explicit rewrite; native suspension and returned Promises need a bridge.
func catchNativeKeywordRefusal(c *checker.Checker, fn *ast.Node) string {
	if fn.Type() != nil {
		return "Removing the native function modifier would conflict with its written return contract. Rewrite the contract explicitly."
	}
	if asyncReturnsPromiseValue(c, fn.Body()) {
		return "Removing the native function modifier would leave an unawaited Promise result in a plain handler. Bridge the Promise explicitly in an effect handler."
	}
	return ""
}
