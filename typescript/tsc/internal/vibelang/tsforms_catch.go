package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4835 (D289): Effect's catch combinators that try runs, which a catch
// expression (VIP-5) and a match (VIP-7) write:
//
//	try Effect.catchTag(find(id), "NotFound", (e) => Effect.succeed(`no user ${e.id}`))
//	find(id) catch effect (e) => match (e) { when { _tag: "NotFound" }: `no user ${e.id}`; default: throw e; }
//
//	try Effect.catch(find(id), (e) => Effect.succeed(describe(e)))
//	find(id) catch (e) => describe(e)
//
//	try Effect.catch(find(id), (e) => recover(e))
//	find(id) catch effect (e) => try recover(e)
//
// A catch expression runs its left side, so a combinator no try runs builds a
// program and stays. Effect.catchTag(self, "Tag", handler) and
// Effect.catchTags(self, { Tag: handler, … }) become one arm per tag and
// rethrow only unhandled failures. An arm tests the failure's _tag with an
// object pattern, { _tag: "Tag" }, which is what catchTag tests.

// Catch conversion cannot retain a written generic instantiation.
var catchTypeArgumentsForm = EK4835.With("{0} has an explicit type-argument contract; keep the native call.")

var catchOptionalCallForm = EK4835.With("{0} uses optional chaining; keep the native call.")

var catchSpreadCallForm = EK4835.With("{0} uses spread arguments; keep the native call.")

// catchHandlerMessage is EK4835's text for Effect.catch, whose handler the
// catch expression keeps.
var catchHandlerMessage = EK4835.With("{0} takes a handler; write a catch expression: x catch (e) => handler.")

func init() {
	tsFormRules[EK4835.Code] = &tsFormRule{
		message: EK4835,
		find:    findCatchCombinators,
	}
}

// catchCombinatorOf returns the name of the Effect catch combinator that call
// calls in its data-first form, or "".
// methodCatchParts accepts x.pipe(op), one Effect catch operator on x, an Effect.
// A pipeline of several operators keeps its form.
func methodCatchParts(c *checker.Checker, call *ast.Node) (*ast.Node, *ast.Node) {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || ast.IsOptionalChain(call) || len(call.Arguments()) != 1 {
		return nil, nil
	}
	access := call.Expression()
	if !ast.IsPropertyAccessExpression(access) || ast.IsOptionalChain(access) || access.Name().Text() != "pipe" {
		return nil, nil
	}
	self := ast.SkipParentheses(access.Expression())
	operator := ast.SkipParentheses(call.Arguments()[0])
	if !isEffectType(c, c.GetTypeAtLocation(self)) || !ast.IsCallExpression(operator) || operator.TypeArguments() != nil || ast.IsOptionalChain(operator) {
		return nil, nil
	}
	return self, operator
}

func catchCombinatorOf(c *checker.Checker, call *ast.Node) string {
	if directTryFormSite(call) == nil {
		return ""
	}
	return catchCombinatorName(c, call)
}

// catchCombinatorName is catchCombinatorOf for any position of call. EK4835
// reports only the direct operand of bare try (detail 254); catchStageRewrite
// also reads a pipeline's last stage for the retained diagnostic analysis.
func catchCombinatorName(c *checker.Checker, call *ast.Node) string {
	if !ast.IsCallExpression(call) || !inLowerableBody(call) || inHatch(call) {
		return ""
	}
	operator := call
	count := len(call.Arguments())
	if self, inner := methodCatchParts(c, call); self != nil {
		operator, count = inner, len(inner.Arguments())+1
	}
	spread := hasSpreadFormArguments(operator)
	if spread && (operator != call || !isEffectType(c, effectOperandType(c, call))) {
		return ""
	}
	name := directEffectFormName(c, operator.Expression(), "catchTag", "catchTags", "catch", "catch_")
	if name == "" || operator != call && ast.IsElementAccessExpression(operator.Expression()) {
		return ""
	}
	// The catch export aliases its reserved-word-safe declaration.
	if name == "catch_" {
		name = "catch"
	}
	if spread {
		return name
	}
	switch {
	case name == "catchTag" && count == 3, name == "catchTags" && count == 2, name == "catch" && count == 2:
		return name
	}
	return ""
}

// findCatchCombinators reports EK4835 at each catch combinator of file that a
// catch expression writes.
func findCatchCombinators(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := catchCombinatorOf(c, node); name != "" {
			var message *Message
			switch {
			case ast.IsElementAccessExpression(node.Expression()):
			case hasSpreadFormArguments(node):
				message = catchSpreadCallForm
			case ast.IsOptionalChain(node):
				message = catchOptionalCallForm
			case node.TypeArguments() != nil:
				message = catchTypeArgumentsForm
			}
			if name == "catch" && message == nil {
				message = catchHandlerMessage
			}
			report(node, &formRewrite{message: message}, "Effect."+name)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
