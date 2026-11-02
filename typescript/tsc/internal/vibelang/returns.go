package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// returnOwner recognizes a whole returned expression, including concise arrows.
// Operands of that expression still follow the ordinary call rule (D24).
func returnOwner(node *ast.Node) *ast.Node {
	if ast.IsParenthesizedExpression(node) || node.Kind == ast.KindConditionalExpression || pipeEndsInCall(node) {
		return nil // the enclosed expression or each arm owns the delegation, exactly once
	}
	// A conditional's arms are returned when the conditional is, so each arm
	// delegates on its own: cond ? Exit.fail(e) : Exit.void under a union of
	// Effects contract (D270, the twins' D-9 recipe) runs the chosen Exit.
	value := node
	for value.Parent != nil {
		parent := value.Parent
		if ast.IsParenthesizedExpression(parent) {
			value = parent
			continue
		}
		if parent.Kind == ast.KindConditionalExpression && parent.AsConditionalExpression().Condition != value {
			value = parent
			continue
		}
		// A pipe's value is its body's (D154). When the body is a call, that
		// call is returned exactly as it would be unpiped: a call that runs
		// gives its success, D24 data such as an Exit included, and only a call
		// that keeps a subtype as data delegates at the boundary (S5-1).
		if pipeEndsInCall(parent) && parent.AsBinaryExpression().Right == value {
			value = parent
			continue
		}
		break
	}
	parent := value.Parent
	if parent == nil {
		return nil
	}
	if parent.Kind == ast.KindReturnStatement && parent.Expression() == value {
		return enclosingFunction(parent)
	}
	if parent.Kind == ast.KindArrowFunction && parent.Body() == value {
		return parent
	}
	return nil
}

// expectsProgramReturn asks about the declared return boundary, never about a
// subtype-producing call's running position. Config-returning callbacks stay
// plain (D109); unannotated functions without an Effect expectation keep data.
func (a *analyzer) expectsProgramReturn(fn *ast.Node) bool {
	// S5-1 delegates structured subtype returns; D269 holds exact-Effect factory returns.
	if !isLowerable(fn) || isProducer(fn) || a.isFactory(fn) {
		return false
	}
	if fn.Type() != nil {
		return a.hasContract(fn)
	}
	if isLambda(fn) {
		e := a.classify(a.contextualTypes(fn))
		if call, path := ownerCall(fn); call != nil {
			if signature := a.candidateOf(call); signature != nil {
				e = a.expectationAt(call, signature, path, fn)
			}
		}
		return !e.plainFn && (e.effectFn || e.program)
	}
	return a.expectsEffect(fn)
}

// Calls are handled before their success is unwrapped a second time. Every
// other returned expression uses the general expression hook.
func returnedExpressionType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if isInvocation(node) {
		return t
	}
	return returnedProgramType(c, node, t)
}

// returnedProgramType keeps a returned Effect subtype as the program at an
// Effect-typed function boundary (S5-1), unless A already accepts it as data
// (S22-3). A delegated subtype's success participates in return checking and
// its E/R in flowOf; lowering delegates to that same program.
func returnedProgramType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	fn := returnOwner(node)
	if fn == nil || !isVibeLangFile(ast.GetSourceFileOfNode(node)) || !isLowerable(fn) ||
		t == nil || isEffectType(c, t) || effectInterfaceSymbol(c, t) == nil {
		return t
	}
	a := analyzerFor(c)
	if !a.expectsProgramReturn(fn) {
		return t
	}
	// S22-3 amends S5-1: the declared success channel wins over the
	// subtype's ability to run. Commands, Exits, and other yieldable values
	// accepted by A are data; only a subtype rejected by A delegates.
	if declared := a.declaredProgramReturn(fn); declared != nil {
		// A contextual unknown or any, as in a tsc callback typed
		// (n) => Effect<unknown>, names no success value, so a subtype returned
		// there is S5-1's program. A contract written on the function names it.
		if success := successType(c, declared); success != nil && (fn.Type() != nil || success.Flags()&(checker.TypeFlagsUnknown|checker.TypeFlagsAny) == 0) && c.IsTypeAssignableTo(t, success) {
			delete(a.returnedPrograms, node) // discard a prior contextual probe's delegation
			return t
		}
	}
	channels := []*checker.Type{programChannelType(c, t, "_A"), programChannelType(c, t, "_E"), programChannelType(c, t, "_R")}
	for _, channel := range channels {
		if channel == nil {
			return t
		}
	}
	a.returnedPrograms[node] = c.NewTypeReference(effectInterface(c, t), channels)
	return channels[channelA]
}

func (a *analyzer) returnedProgram(node *ast.Node) *checker.Type {
	fn := returnOwner(node)
	if fn == nil || !inLowerableBody(node) || !a.expectsProgramReturn(fn) {
		return nil
	}
	if program := a.returnedPrograms[node]; program != nil {
		return program
	}
	if isInvocation(node) {
		if sig := a.callSignature(node); sig != nil {
			callee := implementationOf(sig.Declaration())
			// These calls already yield their success under the call rule.
			// Do not request their inferred return rows while a call cycle's
			// fixpoint is being collected (D52).
			if callee != nil && isLowerable(callee) && (a.hasContract(callee) || isPlainCandidate(callee) && a.isSplittable(callee)) {
				return nil
			}
			// A do or throw expression whose return type the checker is
			// inferring, and which completes with primitive values only,
			// returns no program; typing its call here would be a cycle
			// (callReturnType).
			if isProgramArrow(callee) && a.checker.IsResolvingReturnTypeOf(sig) && isPrimitiveOnly(a.callReturnType(sig)) {
				return nil
			}
		}
	}
	// Force non-call expression hooks too, including a stored subtype or new.
	a.checker.GetTypeOfExpressionBeforeWidening(node)
	return a.returnedPrograms[node]
}

// Returning a program executes it even when no call in the body runs. Such
// a function cannot use D10's synchronous direct variant.
func (a *analyzer) hasProgramReturn(fn *ast.Node) bool {
	if !a.expectsProgramReturn(fn) {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		return a.returnedProgram(node) != nil || node.ForEachChild(visit)
	}
	return visit(fn.Body())
}

// pipeEndsInCall reports whether node is a pipe whose body is a call or a
// tagged template, possibly parenthesized.
func pipeEndsInCall(node *ast.Node) bool {
	return isPipe(node) && isInvocation(ast.SkipParentheses(node.AsBinaryExpression().Right))
}

// isPrimitiveOnly reports whether every member of t is a primitive or never,
// so no value of t is a program.
func isPrimitiveOnly(t *checker.Type) bool {
	return t != nil && !slices.ContainsFunc(t.Distributed(), func(member *checker.Type) bool {
		return member.Flags()&(checker.TypeFlagsPrimitive|checker.TypeFlagsNever) == 0
	})
}
