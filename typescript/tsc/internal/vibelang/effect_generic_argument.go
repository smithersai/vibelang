package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// Inference is not an explicit request to receive a cold program (VIP-1/5).
// Keep EK4802's configurable severity, but diagnose the otherwise silent
// argument boundary as well as the return boundary.
var inferredEffectArgument = EK4802.With("{0} infers an Effect in a plain function's generic parameter, so the function receives the unrun program instead of its result.")

// inferredEffectArguments returns the arguments that acquire an Effect through
// this call's own inferred type parameters. Written type arguments opt out.
// Effect-returning APIs and declared Effect positions already ask for programs.
func inferredEffectArguments(c *checker.Checker, call *ast.Node) []*ast.Node {
	if !ast.IsCallExpression(call) || len(call.TypeArguments()) != 0 || isKeywordFormCall(call) || isTryCall(call) || fiberHelper(call) != "" || !inEffectCode(call) || inHatch(call) {
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
		if isEffectType(c, args[i]) || isEffectSubtype(c, args[i]) {
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

// constraintNamesEffect reports whether param's constraint is an Effect or a
// union with an Effect member, as in Effect's duals
// `<Arg extends Effect<any, any, any> | Options>(effectOrOptions?: Arg)`:
// the parameter declares that it takes a program (VIP-1, inferred Effect
// arguments), even though the conditional return type is no Effect.
func constraintNamesEffect(c *checker.Checker, param *checker.Type) bool {
	t := c.GetConstraintOfTypeParameter(param)
	if t == nil {
		return false
	}
	parts := []*checker.Type{t}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		parts = t.Types()
	}
	return slices.ContainsFunc(parts, func(part *checker.Type) bool { return isEffectType(c, part) || isEffectSubtype(c, part) })
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
	if isEffectType(c, t) || isEffectSubtype(c, t) {
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

// A direct Effect argument can be repaired locally. A container or callback
// needs its Effect run at the construction site, so offer no invalid try on it.
func directInferredEffectArgument(c *checker.Checker, value *ast.Node) bool {
	call := value.Parent
	return call != nil && ast.IsCallExpression(call) && slices.Contains(inferredEffectArguments(c, call), value) &&
		(isEffectType(c, c.GetTypeAtLocation(value)) || isEffectSubtype(c, c.GetTypeAtLocation(value)))
}

// This action is an explicit user choice. Batch --fix must not silence an
// ambiguous call by deciding that the author intended to hold the program.
const keepInferredEffectTitle = "Keep the Effect value with explicit type arguments"

var inferredEffectTypeArgumentFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4802.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		value := reportedNode(fix.SourceFile, fix.Span, func(n *ast.Node) bool {
			return n.Parent != nil && ast.IsCallExpression(n.Parent) && slices.Contains(n.Parent.Arguments(), n)
		})
		if value == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		call := value.Parent
		if !slices.Contains(inferredEffectArguments(c, call), value) {
			return nil, nil
		}
		args := c.GetTypeArgumentsForResolvedSignature(c.GetResolvedSignature(call))
		texts := make([]string, len(args))
		for i, arg := range args {
			texts[i] = bangTypes(c.TypeToStringEx(arg, call, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil))
		}
		at := call.Expression().End()
		if token := call.QuestionDotToken(); token != nil {
			at = token.End()
		}
		return []*ls.CodeAction{{Description: keepInferredEffectTitle, Changes: replaceRange(fix, at, at, "<"+strings.Join(texts, ", ")+">")}}, nil
	},
}
