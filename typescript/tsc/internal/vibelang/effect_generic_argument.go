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
		if inferredEffectPosition(c, c.GetTypeAtPosition(target, i), inferred, newEffectTypeWalk()) {
			out = append(out, arg)
		}
	}
	return out
}

// constraintNamesEffect reports whether the unsubstituted constraint declares
// Effect data, including constrained duals and containers of programs.
func constraintNamesEffect(c *checker.Checker, param *checker.Type) bool {
	return declaresEffectData(c, c.GetConstraintOfTypeParameter(param), newEffectTypeWalk())
}

// effectTypeWalk is the state of one walk over a declared type's members.
type effectTypeWalk struct {
	steps *int
	depth int
	seen  map[*checker.Type]bool
	// expanding counts, for each declared anonymous object type, the
	// instantiations whose members the walk is inside.
	expanding map[*checker.Type]int
}

func newEffectTypeWalk() *effectTypeWalk {
	return &effectTypeWalk{steps: new(int), seen: map[*checker.Type]bool{}, expanding: map[*checker.Type]int{}}
}

// maxExpandedInstantiations is how many instantiations of one declared object
// type a walk expands inside one another.
const maxExpandedInstantiations = 2

// expand reports whether t is an instantiation nested too deep to expand, and
// then returns its type arguments. An alias of an object type that names
// itself with a growing argument, such as Next<U[]> or Builder<[...T, U]>,
// yields a new type at every step, which no visited set bounds. Nested
// instantiations of one declaration have the same members, so past the limit
// the walk reads the arguments, as it does for a reference. Each call that
// returns false is paired with leave.
func (w *effectTypeWalk) expand(c *checker.Checker, t *checker.Type) (arguments []*checker.Type, nested bool) {
	target, arguments := c.AnonymousInstantiation(t)
	if target == nil {
		return nil, false
	}
	if w.expanding[target] == maxExpandedInstantiations {
		return arguments, true
	}
	w.expanding[target]++
	return nil, false
}

func (w *effectTypeWalk) leave(c *checker.Checker, t *checker.Type) {
	if target, _ := c.AnonymousInstantiation(t); target != nil {
		w.expanding[target]--
	}
}

// declaresEffectData inspects the declared type before this call's inference.
// Use resolved symbols, not source spellings: aliases and Effect's other data
// types (Stream, Option, Layer, ...) retain their library identity. Do not
// descend into those types' implementation members or generic payloads.
func declaresEffectData(c *checker.Checker, t *checker.Type, walk *effectTypeWalk) bool {
	if t == nil || walk.depth >= maxTypeWalkDepth || *walk.steps >= maxTypeWalkSteps || walk.seen[t] {
		return false
	}
	*walk.steps++
	walk.depth++
	defer func() { walk.depth-- }()
	walk.seen[t] = true
	if t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		return declaresEffectData(c, c.GetConstraintOfTypeParameter(t), walk)
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		return slices.ContainsFunc(t.Types(), func(part *checker.Type) bool { return declaresEffectData(c, part, walk) })
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
		return slices.ContainsFunc(c.GetTypeArguments(t), func(arg *checker.Type) bool { return declaresEffectData(c, arg, walk) })
	}
	if arguments, nested := walk.expand(c, t); nested {
		return slices.ContainsFunc(arguments, func(arg *checker.Type) bool { return declaresEffectData(c, arg, walk) })
	}
	defer walk.leave(c, t)
	for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if declaresEffectData(c, c.GetReturnTypeOfSignature(sig), walk) {
			return true
		}
		for _, param := range sig.Parameters() {
			if declaresEffectData(c, c.GetTypeOfSymbol(param), walk) {
				return true
			}
		}
	}
	return slices.ContainsFunc(c.GetPropertiesOfType(t), func(property *ast.Symbol) bool {
		return declaresEffectData(c, c.GetTypeOfSymbol(property), walk)
	})
}

// Follow generic containers and callback contracts without expanding their
// library implementation members. The visited set bounds a recursive alias
// that returns to the same type; effectTypeWalk bounds one that never does.
func inferredEffectPosition(c *checker.Checker, t *checker.Type, inferred map[*checker.Type]bool, walk *effectTypeWalk) bool {
	if t != nil && inferred[t] {
		return true
	}
	if t == nil || walk.depth >= maxTypeWalkDepth || *walk.steps >= maxTypeWalkSteps || walk.seen[t] {
		return false
	}
	*walk.steps++
	walk.depth++
	defer func() { walk.depth-- }()
	walk.seen[t] = true
	if inferred[t] {
		return true
	}
	declaredWalk := newEffectTypeWalk()
	// Rechecking the declared contract at each inferred position shares the
	// same work budget, rather than multiplying that budget by the graph size.
	declaredWalk.steps = walk.steps
	if declaresEffectData(c, t, declaredWalk) {
		return false
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		return slices.ContainsFunc(t.Types(), func(part *checker.Type) bool { return inferredEffectPosition(c, part, inferred, walk) })
	}
	if t.Flags()&checker.TypeFlagsObject == 0 {
		return false
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		return slices.ContainsFunc(c.GetTypeArguments(t), func(arg *checker.Type) bool { return inferredEffectPosition(c, arg, inferred, walk) })
	}
	if arguments, nested := walk.expand(c, t); nested {
		return slices.ContainsFunc(arguments, func(arg *checker.Type) bool { return inferredEffectPosition(c, arg, inferred, walk) })
	}
	defer walk.leave(c, t)
	for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if inferredEffectPosition(c, c.GetReturnTypeOfSignature(sig), inferred, walk) {
			return true
		}
		for _, param := range sig.Parameters() {
			if inferredEffectPosition(c, c.GetTypeOfSymbol(param), inferred, walk) {
				return true
			}
		}
	}
	for _, property := range c.GetPropertiesOfType(t) {
		if inferredEffectPosition(c, c.GetTypeOfSymbol(property), inferred, walk) {
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
