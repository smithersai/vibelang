package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Effect runs these combinators' callbacks inside the fiber, where a throw
// becomes a defect holding the thrown value. A plain callback returning an
// Effect can't throw (EK0401), so a call that may throw inside it is wrapped
// where it stands:
//
//	Effect.catchTag("Denied", (e) => Effect.succeed(reject(e)))
//	Effect.catchTag("Denied", (e) => { try { return Effect.succeed(reject(e)) } catch (thrown) { return die(thrown) } })
//
// The callback still runs at the same moment and its failure is the same
// defect: on effect 4.1.1 the throwing callback and the wrapped one exit with
// the same Cause, holding the same object, for every callback listed here. A
// callback passed anywhere else, an eager factory or an Error-valued mapper
// keeps its EK0401: JavaScript there can tell a throw from a returned Effect.
// So do the Eager variants (flatMapEager, catchEager, matchCauseEffectEager
// and the rest), which may call their callback while the program is built.
var fiberCallbackCombinators = []string{
	"acquireRelease", "acquireUseRelease", "andThen", "catch", "catchCause", "catchCauseFilter", "catchCauseIf",
	"catchDefect", "catchFilter", "catchIf", "catchTag", "filterOrElse", "flatMap", "forEach",
	"onError", "onErrorFilter", "onErrorIf", "onExit", "onExitFilter", "onExitIf", "onInterrupt",
	"repeatOrElse", "retryOrElse", "scopedWith", "suspend", "tap", "tapCause", "tapCauseFilter",
	"tapCauseIf", "tapDefect", "tapError", "tapErrorTag",
}

// fiberHandlerMembers lists the combinators that take fiber-run callbacks as
// members of an object argument, and which members those are; nil admits
// every member, as catchTags' handlers are named by error tag.
var fiberHandlerMembers = map[string][]string{
	"catchTags":        nil,
	"matchCauseEffect": {"onFailure", "onSuccess"},
	"matchEffect":      {"onFailure", "onSuccess"},
	"repeat":           {"until", "while"},
	"retry":            {"until", "while"},
	"whileLoop":        {"body"},
}

// isFiberRunCallback reports whether fn, a function expression with its
// parentheses, is a callback Effect runs inside the fiber: an argument of a
// fiberCallbackCombinators call, or a listed member of an object literal
// passed to a fiberHandlerMembers call.
func isFiberRunCallback(c *checker.Checker, fn *ast.Node) bool {
	parent := fn.Parent
	if parent == nil {
		return false
	}
	if ast.IsCallExpression(parent) {
		return fn != parent.Expression() && isEffectFunction(c, parent.Expression(), "Effect", fiberCallbackCombinators...)
	}
	if !ast.IsPropertyAssignment(parent) || parent.Initializer() != fn || parent.Parent == nil || !ast.IsObjectLiteralExpression(parent.Parent) {
		return false
	}
	name, ok := ast.TryGetTextOfPropertyName(parent.Name())
	call := parent.Parent.Parent
	if !ok || call == nil || !ast.IsCallExpression(call) || !slices.Contains(call.Arguments(), parent.Parent) {
		return false
	}
	for combinator, members := range fiberHandlerMembers {
		if (members == nil || slices.Contains(members, name)) && isEffectFunction(c, call.Expression(), "Effect", combinator) {
			return true
		}
	}
	return false
}

func preservingCallbackCallThrows(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string) (fileFix, bool) {
	if !ast.IsCallExpression(site) && !ast.IsNewExpression(site) {
		return fileFix{}, false
	}
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil || !ast.IsFunctionExpressionOrArrowFunction(home) || isMarkedEffect(home) || home.Body() == nil {
		return fileFix{}, false
	}
	if ast.IsFunctionExpression(home) && home.Name() != nil || ast.GetFunctionFlags(home)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0 {
		return fileFix{}, false
	}
	body := home.Body()
	if site.Pos() < body.Pos() || site.End() > body.End() {
		return fileFix{}, false // a parameter default runs before the body
	}
	sig := c.GetSignatureFromDeclaration(home)
	if sig == nil || !isEffectfulType(c, c.GetReturnTypeOfSignature(sig)) {
		return fileFix{}, false
	}
	n := home
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	if !isFiberRunCallback(c, n) {
		return fileFix{}, false
	}
	visible := c.ResolveName("die", body, ast.SymbolFlagsValue, false)
	if visible != nil && visible.Flags()&ast.SymbolFlagsAlias != 0 {
		visible = c.GetAliasedSymbol(visible)
	}
	if expected := servicesFor(c).effectExport("Effect", "die"); expected == nil || visible != expected {
		return fileFix{}, false
	}
	thrown := freshName(file, "thrown")
	handler := " catch (" + thrown + ") { return die(" + thrown + ") }"
	var edits []sourceEdit
	if ast.IsBlock(body) {
		open, close := nodeStart(file, body), body.End()-1
		if file.Text()[open] != '{' || file.Text()[close] != '}' {
			return fileFix{}, false
		}
		edits = []sourceEdit{{open + 1, open + 1, " try {"}, {close, close, "}" + handler + " "}}
	} else {
		start := nodeStart(file, body)
		edits = []sourceEdit{{start, start, "{ try { return "}, {body.End(), body.End(), " }" + handler + " }"}}
	}
	return fileFix{code: EK0401.Code, key: key, sited: true, siteStart: site.Pos(), siteEnd: site.End(), edits: edits}, true
}
