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
	if !isInvocation(call) || holdsProgram(c, call) || !analyzerFor(c).runs(call) {
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
	t = triedResult(c, call, t)
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
func runningCallInferenceTarget(c *checker.Checker, call *ast.Node, contextual *checker.Type, target *checker.Type, candidate *checker.Signature) *checker.Type {
	if !isInvocation(call) || !isVibeLangFile(ast.GetSourceFileOfNode(call)) || !analyzerFor(c).runs(call) || !isEffectType(c, target) {
		return target
	}
	a := analyzerFor(c)
	for _, part := range contextual.Distributed() {
		if a.isExpectedEffect(part) {
			return target
		}
		if isEffectType(c, part) || isEffectSubtype(c, part) {
			return nil // an error instance, which fails with itself, names no success
		}
	}
	// The call stands for its Effect's success, so the contextual value type
	// infers that success, as const o: Outcome = await f() infers f's T from
	// Outcome: const o: Outcome = try Effect.succeed({ _tag: "Found" }) keeps
	// "Found" literal, and so does effect { ... } catch h under an Outcome
	// contract (D293).
	// The value's context must not invent an optional generic branch. Keep
	// defaults during this pass; actual arguments still infer against the
	// original signature. Otherwise Exclude<A3, Unassigned> can infer an
	// absent fallback as undefined from an Item | undefined assignment.
	return c.InstantiateTypeParameterDefaults(successType(c, target), candidate)
}

// callRunsResult is the shared checker/lowering predicate for D24: a call
// runs an Effect-valued result even when its callee is plain JavaScript.
// S3-3 covers plain factories; D270 extends the same predicate to all-Effect
// unions. Optional chaining keeps the absent branch; structured subtypes stay data.
func callRunsResult(c *checker.Checker, call *ast.Node, t *checker.Type) bool {
	if ast.IsOptionalChain(call) {
		t = presentCallResult(c, t)
	}
	return isEffectType(c, triedResult(c, call, t))
}

// triedResult is the Effect that call, written after try, runs when its
// result t is an Effect with structure of its own: t read as Effect<A, E, R>
// (effectOfValue), as try reads a stored value (Chapter 2's operand test). A
// Config, a branded Effect, or an interface that extends Effect, such as
// sql's Statement<A>, then runs where `try make()` stands, as `const s =
// make(); try s` runs it. Without try, D24 keeps such a result as data, and t
// stays as it is.
func triedResult(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	if !triedFlag(call) || t == nil || isEffectType(c, t) {
		return t
	}
	if effect := effectOfValue(c, t); effect != nil {
		return effect
	}
	return t
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
	// Infer the same channels as the native allSettled counterpart, including
	// the unknown requirement inferred by [].map(Effect.exit).
	returned = trySettledType(c, call, returned)
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
// result, an Effect subtype that stays data until try runs it (VIP-5). {0} is
// "This call" or "This tag", {1} whose result it is.
var structuredResult = EK4301.With("{0} returns an Effect subtype, which only try runs, so this statement discards {1} result without running it.")

// runWithTryNote is EK4301's repair for node, a discarded structured
// result: try runs it in effect code; plain JavaScript returns it (VIP-1).
func runWithTryNote(node *ast.Node) string {
	if fn := enclosingFunction(node); fn != nil && inLowerableBody(node) && markedForm(fn) != formNone {
		return "Run it with try: try {0}."
	}
	return "Return it, or run it with try inside an effect function: try {0}."
}

// In effect code, a structured Effect result stays data until try runs it.
// Plain and async code keep ordinary JavaScript call/discard behavior (VIP-1),
// including a runner whose returned Exit is already the outcome of execution.
func checkInvocationRuns(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isInvocation(node) && inEffectCode(node) && !inHatch(node) && !isTry(node) { // try runs it (VIP-5)
			sig := c.GetResolvedSignature(node)
			if sig != nil {
				t := runningCallResult(c, node, sig)
				statement := node.Parent
				for statement != nil && ast.IsParenthesizedExpression(statement) {
					statement = statement.Parent
				}
				// A tried call already runs its structured result; only an
				// unrun result is discarded by an expression statement.
				if isStructuredEffectResult(c, t) && statement != nil && ast.IsExpressionStatement(statement) && !underTry(node) {
					text := shortText(nodeText(file, node), "this result")
					if ast.IsCallExpression(node) {
						d := report(c, node, structuredResult, "This call", "its")
						note(d, runWithTryNote(node), text)
					} else {
						d := report(c, node, structuredResult, "This tag", "the template's")
						note(d, runWithTryNote(node), text)
					}
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
