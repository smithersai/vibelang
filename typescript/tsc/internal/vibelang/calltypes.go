package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// callExpressionType gives a call that runs an Effect the type of the
// Effect's success value. Inside a function that the lowering can turn into
// an Effect, `const name = findName(id)` has type string, not
// Effect<string>, because the call runs. A call that runs a plain function
// inline through its $direct variant has its success type anywhere in a .vibe
// file (plain.go). Every other call keeps its type.
func callExpressionType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	t = providedCallType(c, call, t)
	if !isInvocation(call) || holdsProgram(c, call) || !inLowerableBody(call) && analyzerFor(c).directCallee(call) == nil {
		return t
	}
	if isExitMarkerCall(call) {
		return exitCallType(c, call, t) // finally (exit) (primitives.go)
	}
	if !callRunsResult(c, call, t) {
		// D24 keeps subtype results as data in running positions. An Effect
		// return boundary instead delegates to that subtype's program (S5-1).
		// This hook also serves the checker's quick call-type path, which
		// skips expression hooks, including parenthesized callback returns.
		return returnedProgramType(c, call, t)
	}
	if ast.IsOptionalChain(call) {
		parts := []*checker.Type{}
		for _, part := range t.Distributed() {
			if success := successType(c, part); success != nil {
				parts = append(parts, success)
			} else {
				parts = append(parts, part)
			}
		}
		return c.GetUnionType(parts)
	}
	if result := resumeResultType(c, call); result != nil {
		return result // what the handle statement ends with (handle_results.go)
	}
	if success := successType(c, t); success != nil {
		return success // its success may itself be subtype data
	}
	return t
}

// runningCallInferenceTarget keeps TypeScript from inferring a candidate's
// type arguments from the contextual type of a call that runs the Effect the
// candidate returns. Such a call stands for that Effect's success value
// (callExpressionType), so its contextual type, as in `const user: User =
// find(id)`, is a value's, not the Effect's. Read as the Effect, a contextual
// type that is itself an Effect, such as an error instance, which fails with
// itself, gave the Effect's E the error: `function f(): Late!! { return
// late() }` drew EK9201 for an E that no argument names. Any other value type
// gave no inference. Where the contextual type expects an Effect, the call
// stands where a program is expected (D147, D262, D269), and TypeScript
// infers from it as usual.
func runningCallInferenceTarget(c *checker.Checker, call *ast.Node, contextual *checker.Type, target *checker.Type) *checker.Type {
	if !isInvocation(call) || !inLowerableBody(call) || !isVibeLangFile(ast.GetSourceFileOfNode(call)) || !isEffectType(c, target) {
		return target
	}
	a := analyzerFor(c)
	for _, part := range contextual.Distributed() {
		if a.isExpectedEffect(part) {
			return target
		}
	}
	return nil
}

// callRunsResult is the shared checker/lowering predicate for D24: a call
// runs an Effect-valued result even when its callee is plain JavaScript.
// S3-3 covers plain factories; D270 extends the same predicate to all-Effect
// unions. Optional chaining keeps the absent branch; structured subtypes stay data.
func callRunsResult(c *checker.Checker, call *ast.Node, t *checker.Type) bool {
	if ast.IsOptionalChain(call) {
		t = presentCallResult(c, t)
	}
	return isEffectType(c, t)
}

// inLowerableBody reports whether node is evaluated by the body of a function
// that the lowering can turn into an Effect, not by a nested function, a
// parameter list, or the module's top level.
func inLowerableBody(node *ast.Node) bool {
	for n := node; n.Parent != nil; n = n.Parent {
		if isHatchArgument(n) {
			return false // TypeScript, inside a boundary hatch (hatches.go)
		}
		if fn := n.Parent; isFunctionBoundary(fn) {
			return n == fn.Body() && isLowerable(fn)
		}
	}
	return false
}

// successType returns A for an Effect<A, E, R>, or nil if t is not an Effect.
func successType(c *checker.Checker, t *checker.Type) *checker.Type {
	return channelType(c, t, "_A")
}

// channelType returns one channel of an Effect<A, E, R>, or nil if t is not
// an Effect. A union of Effects joins each member's channel (D270).
// name is "_A", "_E", or "_R": a member of the Effect's
// `~effect/Effect` variance property whose type is `(_: never) => Channel`.
func channelType(c *checker.Checker, t *checker.Type, name string) *checker.Type {
	if !isEffectType(c, t) {
		return nil
	}
	// D270 joins exact-Effect union channels in ordinary running positions.
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		channels := make([]*checker.Type, 0, len(t.Types()))
		for _, member := range t.Types() {
			channel := channelType(c, member, name)
			if channel == nil {
				return nil
			}
			channels = append(channels, channel)
		}
		return c.GetUnionType(channels)
	}
	return programChannelType(c, t, name)
}

// programChannelType reads structured Effect subtypes at by-name result
// positions and Effect return boundaries (S5-1). Ordinary running calls use
// channelType's exact-Effect test above (D24/D270).
func programChannelType(c *checker.Checker, t *checker.Type, name string) *checker.Type {
	variance := c.GetTypeOfPropertyOfType(t, effectTypeID) // Variance<A, E, R>
	if variance == nil {
		return nil
	}
	covariant := c.GetTypeOfPropertyOfType(variance, name) // (_: never) => Channel
	if covariant == nil {
		return nil
	}
	signatures := c.GetSignaturesOfType(covariant, checker.SignatureKindCall)
	if len(signatures) != 1 {
		return nil
	}
	return c.GetReturnTypeOfSignature(signatures[0])
}

// runningCallResult removes only the undefined added by optional chaining.
// D24 still decides from the present branch's exact type, never from a
// structural Effect subtype or a union containing data (D270).
func runningCallResult(c *checker.Checker, call *ast.Node, sig *checker.Signature) *checker.Type {
	return runningCallResultOf(c, call, c.GetReturnTypeOfSignature(sig))
}

// runningCallResultOf is runningCallResult for a call whose callee returns
// returned.
func runningCallResultOf(c *checker.Checker, call *ast.Node, returned *checker.Type) *checker.Type {
	t := providedCallType(c, call, returned)
	if !ast.IsOptionalChain(call) {
		return t
	}
	return presentCallResult(c, t)
}

func presentCallResult(c *checker.Checker, t *checker.Type) *checker.Type {
	parts := []*checker.Type{}
	for _, part := range t.Distributed() {
		if part.Flags()&checker.TypeFlagsUndefined == 0 {
			parts = append(parts, part)
		}
	}
	return c.GetUnionType(parts)
}

// isInvocation includes tagged templates: invoking a tag is a call (D267).
func isInvocation(node *ast.Node) bool {
	return ast.IsCallExpression(node) || ast.IsTaggedTemplateExpression(node)
}

func init() {
	fileChecks = append(fileChecks, checkInvocationRuns)
}

// structuredResult is EK4301's text for a statement that discards a call's
// result, an Effect subtype that stays data until it is called (D24). {0} is
// "This call" or "This tag", {1} whose result it is.
var structuredResult = EK4301.With("{0} returns an Effect subtype, which stays data until it is called, so this statement discards {1} result without running it.")

// D24 keeps structured Effect results as data. Discarding a call or template
// statement must ask rather than silently leaving a SQL migration cold.
func checkInvocationRuns(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isInvocation(node) && !inHatch(node) {
			sig := c.GetResolvedSignature(node)
			if sig != nil {
				t := runningCallResult(c, node, sig)
				statement := node.Parent
				for statement != nil && ast.IsParenthesizedExpression(statement) {
					statement = statement.Parent
				}
				if isStructuredEffectResult(c, t) && statement != nil && ast.IsExpressionStatement(statement) {
					text := shortText(nodeText(file, node), "this result")
					if ast.IsCallExpression(node) {
						d := report(c, node, structuredResult, "This call", "its")
						note(d, "Call the result to run it, {0}(), or write the return type of what it calls as A!E!R, which runs the call where it stands.", text)
					} else {
						d := report(c, node, structuredResult, "This tag", "the template's")
						note(d, "Call the result to run it, {0}(), or write the tag's return type as A!E!R, which runs the template where it stands.", text)
					}
				} else if ast.IsTaggedTemplateExpression(node) && isEffectType(c, t) && !inLowerableBody(node) && !atTopLevel(node) {
					d := report(c, node, EK4301.With("This tagged template runs an Effect, but this position can't run one."))
					note(d, "Move it into an Effect function's body.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// A union such as Exit is data too: every branch must be a structured Effect.
func isStructuredEffectResult(c *checker.Checker, t *checker.Type) bool {
	found := false
	for _, part := range t.Distributed() {
		if effectInterfaceSymbol(c, part) == nil || isEffectType(c, part) {
			return false
		}
		found = true
	}
	return found
}
