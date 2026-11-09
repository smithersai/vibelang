package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Inference is not an explicit request to receive a cold program (VIP-1/5).
// Keep EK4802's configurable severity, but diagnose the otherwise silent
// inferred-argument boundary. Returned programs remain success data.
var inferredEffectArgument = EK4802

// inferredEffectArguments returns the arguments that acquire an Effect through
// this call's own inferred type parameters. Written type arguments opt out.
// Effect-returning APIs and declared Effect positions already ask for programs.
func inferredEffectArguments(c *checker.Checker, call *ast.Node) []*ast.Node {
	if !ast.IsCallExpression(call) || len(call.TypeArguments()) != 0 || isKeywordFormCall(call) || isTryCall(call) || fiberHelper(call) != "" || !inEffectCode(call) || inHatch(call) {
		return nil
	}
	// try consumes the call that is its direct operand, through parentheses:
	// `try x.pipe(Stream.runCollect)` and `try take(job)` run the inferred
	// Effect at once, so nothing receives it unrun (VIP-1, inferred Effect
	// arguments; ruling 2026-11-04). The same call assigned, passed, returned
	// or pushed without try still warns. No callee name is exempt.
	if triedFlag(call) {
		return nil
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return nil
	}
	target := signature
	for target.Target() != nil {
		target = target.Target()
	}
	params := target.TypeParameters()
	args := c.GetTypeArgumentsForResolvedSignature(signature)
	if len(params) == 0 || len(params) != len(args) {
		return nil
	}
	// Instantiating a function value explicitly already fixes its contract.
	// The current call must itself have a generic candidate to infer anything.
	candidates := c.GetSignaturesOfType(c.GetApparentType(c.GetTypeAtLocation(call.Expression())), checker.SignatureKindCall)
	if !slices.ContainsFunc(candidates, func(candidate *checker.Signature) bool {
		return len(candidate.TypeParameters()) != 0 && candidate.Declaration() == signature.Declaration()
	}) {
		return nil
	}
	inferred := make(map[*checker.Type]bool)
	for i, param := range params {
		if constraintNamesEffect(c, param) {
			continue // a declared Effect position, as Effect.forkChild's Arg
		}
		// EK4802 warns about an unrun program inferred as ordinary data
		// (VIP-1/5), so use Effect's own interface identity. A subtype with
		// structure of its own, such as effect/cli's Command, is data that
		// also implements Effect; running it would replace that data with
		// its success value. Keep that identity through plain generics and
		// Pipeable receiver inference, without exempting any callee name.
		// Aliases and unions of Effect itself still describe cold programs.
		if isEffectType(c, args[i]) {
			inferred[param] = true
		}
	}
	if len(inferred) == 0 {
		return nil
	}
	result := c.GetReturnTypeOfSignature(target)
	if isEffectType(c, result) || isEffectSubtype(c, result) {
		return nil
	}
	var out []*ast.Node
	for i, arg := range call.Arguments() {
		value := ast.SkipParentheses(arg)
		if value.Flags&ast.NodeFlagsVibeLangTry != 0 || arg.Flags&ast.NodeFlagsVibeLangTry != 0 || isTryCall(value) || tried(value) {
			continue
		}
		if inferredEffectPosition(c, c.GetTypeAtPosition(target, i), inferred, make(map[*checker.Type]bool)) {
			out = append(out, arg)
		}
	}
	return out
}

// constraintNamesEffect reports whether the unsubstituted constraint declares
// Effect data, including constrained duals and containers of programs.
func constraintNamesEffect(c *checker.Checker, param *checker.Type) bool {
	return declaresEffectData(c, c.GetConstraintOfTypeParameter(param), make(map[*checker.Type]bool))
}

// declaresEffectData inspects the declared type before this call's inference.
// Use resolved symbols, not source spellings: aliases and Effect's other data
// types (Stream, Option, Layer, ...) retain their library identity. Do not
// descend into those types' implementation members or generic payloads.
func declaresEffectData(c *checker.Checker, t *checker.Type, seen map[*checker.Type]bool) bool {
	if t == nil || seen[t] {
		return false
	}
	seen[t] = true
	if t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		return declaresEffectData(c, c.GetConstraintOfTypeParameter(t), seen)
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		return slices.ContainsFunc(t.Types(), func(part *checker.Type) bool { return declaresEffectData(c, part, seen) })
	}
	if t.Flags()&checker.TypeFlagsObject == 0 {
		return false
	}
	for _, property := range c.GetPropertiesOfType(t) {
		if strings.HasPrefix(property.Name(), "~effect/") && declaredInEffect(property) {
			return true
		}
	}
	if isEffectType(c, t) || isEffectSubtype(c, t) {
		return true
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		return slices.ContainsFunc(c.GetTypeArguments(t), func(arg *checker.Type) bool { return declaresEffectData(c, arg, seen) })
	}
	for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if declaresEffectData(c, c.GetReturnTypeOfSignature(sig), seen) {
			return true
		}
		for _, param := range sig.Parameters() {
			if declaresEffectData(c, c.GetTypeOfSymbol(param), seen) {
				return true
			}
		}
	}
	return slices.ContainsFunc(c.GetPropertiesOfType(t), func(property *ast.Symbol) bool {
		return declaresEffectData(c, c.GetTypeOfSymbol(property), seen)
	})
}

// Follow generic containers and callback contracts without expanding their
// library implementation members. The visited set bounds recursive aliases.
func inferredEffectPosition(c *checker.Checker, t *checker.Type, inferred map[*checker.Type]bool, seen map[*checker.Type]bool) bool {
	if t == nil || seen[t] {
		return false
	}
	seen[t] = true
	if inferred[t] {
		return true
	}
	if declaresEffectData(c, t, make(map[*checker.Type]bool)) {
		return false
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		return slices.ContainsFunc(t.Types(), func(part *checker.Type) bool { return inferredEffectPosition(c, part, inferred, seen) })
	}
	if t.Flags()&checker.TypeFlagsObject == 0 {
		return false
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		return slices.ContainsFunc(c.GetTypeArguments(t), func(arg *checker.Type) bool { return inferredEffectPosition(c, arg, inferred, seen) })
	}
	for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if inferredEffectPosition(c, c.GetReturnTypeOfSignature(sig), inferred, seen) {
			return true
		}
		for _, param := range sig.Parameters() {
			if inferredEffectPosition(c, c.GetTypeOfSymbol(param), inferred, seen) {
				return true
			}
		}
	}
	for _, property := range c.GetPropertiesOfType(t) {
		if inferredEffectPosition(c, c.GetTypeOfSymbol(property), inferred, seen) {
			return true
		}
	}
	return false
}

func (r *ruleCheck) checkInferredEffectArguments(call *ast.Node) {
	for _, arg := range inferredEffectArguments(r.c, call) {
		d := report(r.c, arg, inferredEffectArgument, messageText(arg, "This argument"))
		note(d, "Run the Effect with try where it is constructed, or write the Effect type argument explicitly to pass the program itself.")
	}
}
