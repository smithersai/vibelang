package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Effect runs these combinators' callbacks inside the fiber, where a throw
// becomes a defect holding the thrown value (effect 4.1.1: suspend, flatMap,
// andThen, tap, catch, catchCause and forEach all exit Die with the same
// object). A plain callback returning an Effect can't throw (EK0401), so a
// call that may throw inside it is wrapped where it stands:
//
//	Effect.suspend(() => { foreign(); return Effect.void })
//	Effect.suspend(() => { try { foreign(); return Effect.void } catch (thrown) { return die(thrown) } })
//
// The callback still runs at the same moment and its failure is the same
// defect. A callback passed anywhere else, an eager factory or an
// Error-valued mapper keeps its EK0401: JavaScript there can tell a throw
// from a returned Effect.
var fiberCallbackCombinators = []string{"suspend", "flatMap", "andThen", "tap", "catch", "catchCause", "forEach"}

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
	call := n.Parent
	if call == nil || !ast.IsCallExpression(call) || n == call.Expression() || !isEffectFunction(c, call.Expression(), "Effect", fiberCallbackCombinators...) {
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
