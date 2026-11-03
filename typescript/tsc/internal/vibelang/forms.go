package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A lambda, an arrow function or function expression in a .vibe file,
// compiles in one of three forms (design D56). Overload resolution decides
// which: while TypeScript checks a call's arguments against a candidate
// signature, each lambda argument takes the form that candidate's declared,
// uninstantiated parameter type asks for (D44), and the candidate that
// TypeScript's first-applicable rule selects decides the form the lambda
// compiles to.
//
//	Effect.retry(() => sync(store), policy)   // Effect<A, E, R> expected: a program
//	Effect.forEach(ids, (id) => find(id))      // (a) => Effect expected: an Effect function
//	ids.map((id) => id.trim())                 // (value) => U expected: a plain function
//
// An ordinary lambda's body is typed the same way in every form: a call that runs has
// its Effect's success type. Only the lambda's own type depends on the form,
// so each form is computed once from the same body, and a deferred recheck
// never reclassifies anything. A D269 factory is the exception: its plain
// JavaScript body returns a program against the whole declared Effect type.
type form uint8

const (
	formNone    form = iota
	formPlain        // a plain JavaScript function: (x) => A
	formEffect       // an Effect function: (x) => Effect<A, E, R>
	formFactory      // a plain call-time body returning a program (D269)
	formProgram      // a program, a function with no parameters: Effect<A, E, R>
)

// lambdaState is what the analyzer knows about one lambda.
type lambdaState struct {
	typedAsWritten bool             // TypeScript typed fn while checking its signature, before any form (functionExpressionType)
	types          [5]*checker.Type // the lambda's type in each form
}

func (a *analyzer) lambda(fn *ast.Node) *lambdaState {
	s := a.lambdas[fn]
	if s == nil {
		s = &lambdaState{}
		a.lambdas[fn] = s
	}
	return s
}

// isLambda reports whether fn is a function expression or arrow function in
// a .vibe file whose form the analyzer decides.
func isLambda(fn *ast.Node) bool {
	return (fn.Kind == ast.KindArrowFunction || fn.Kind == ast.KindFunctionExpression) && isLowerable(fn) && !isProducer(fn)
}

// functionExpressionType gives a lambda the type of its form at its position:
// the plain function TypeScript inferred, an Effect function, or the program's
// Effect.
func functionExpressionType(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !isLambda(fn) {
		return t
	}
	a := analyzerFor(c)
	if c.IsCheckingSignatureOf(fn) {
		// Resolving fn's own annotations typed fn again, as in
		// `const TextPart = withStatics(schema, { make: (input): TextPart => … })`
		// (C-5): its form depends on its return annotation, which has no type
		// yet. fn keeps the type TypeScript gives it, as in TypeScript; with
		// an Effect contract that type returns the Effect, so fn cannot be
		// plain (canBePlain).
		a.lambda(fn).typedAsWritten = true
		return t
	}
	f := markedForm(fn)
	if f == formNone && serviceHead(c, fn) {
		// The catch factory returns its operand's Effect, with the lookup's
		// requirements added. It does not succeed with an Effect as data.
		signatures := c.GetSignaturesOfType(t, checker.SignatureKindCall)
		if len(signatures) == 1 {
			program := effectOfValue(c, c.GetReturnTypeOfSignature(signatures[0]))
			if program != nil {
				flow := a.flowOf(fn.Body())
				errors := append(flow.errors, channelType(c, program, "_E"))
				requirements := append(flow.requirements, channelType(c, program, "_R"))
				result := c.NewTypeReference(effectInterface(c, program), []*checker.Type{
					successType(c, program), c.GetUnionType(errors), c.GetUnionType(requirements),
				})
				return c.NewFunctionTypeWithReturnType(t.Symbol(), signatures[0], result)
			}
		}
	}
	if f == formNone {
		return t // a function without effect is plain JavaScript (VIP-1)
	}
	return a.typeInForm(fn, t, f)
}

// isCalledInPlace reports whether fn is a program arrow the parser writes and
// calls where it stands, as it writes a match or an is expression.
func isCalledInPlace(fn *ast.Node) bool {
	if !isProgramArrow(fn) {
		return false
	}
	callee := fn.Parent
	if callee == nil || !ast.IsParenthesizedExpression(callee) {
		return false
	}
	call := callee.Parent
	return call != nil && ast.IsCallExpression(call) && call.Expression() == callee
}

// typeInForm returns fn's type in form f, given t, the type TypeScript
// inferred for it: a function that returns its body's success value A. A
// lambda with a return annotation keeps the type it writes (D500).
func (a *analyzer) typeInForm(fn *ast.Node, t *checker.Type, f form) *checker.Type {
	if f == formProgram && fn.Type() != nil {
		// S6-4: an explicit Effect contract already types the body as its
		// program. The expected Effect position removes only the outer
		// function, preserving the contract's A/E/R rather than inferring
		// new channels. D67's Effect-function API and D67's plain form
		// keep their existing paths above and below.
		if signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall); len(signatures) == 1 {
			return a.checker.GetReturnTypeOfSignature(signatures[0])
		}
	}
	if f == formPlain || f == formNone || fn.Type() != nil {
		return t
	}
	s := a.lambda(fn)
	if cached := s.types[f]; cached != nil {
		return cached
	}
	signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
	if len(signatures) != 1 {
		return t
	}
	effect := a.effectTypeOf(fn, a.checker.GetReturnTypeOfSignature(signatures[0]))
	if effect == nil {
		return t
	}
	result := effect
	if f == formEffect {
		result = a.checker.NewFunctionTypeWithReturnType(t.Symbol(), signatures[0], effect)
	}
	s.types[f] = result
	return result
}

// effectTypeOf returns Effect<A, E, R> for fn's body, given its success type
// A, or nil when no Effect interface is in reach.
func (a *analyzer) effectTypeOf(fn *ast.Node, success *checker.Type) *checker.Type {
	info := a.effectOf(fn)
	if info == nil {
		info = &effectInfo{} // fn's body is being collected
	}
	effect := a.effectInterfaceFor(fn, info)
	if effect == nil {
		effect = a.programEffectInterface()
	}
	if effect == nil {
		effect = a.effectInterface
	}
	if effect == nil {
		return nil
	}
	errors, requirements := a.channelUnions(info, effect)
	return a.checker.NewTypeReference(effect, []*checker.Type{success, errors, requirements})
}

// ownerCall returns the call or new expression that fn is an argument of,
// directly or as an element of an array literal or the value of an object
// literal property there, with the path from the argument down to fn.
func ownerCall(fn *ast.Node) (*ast.Node, []pathStep) {
	var path []pathStep
	node := fn
	for parent := node.Parent; parent != nil; node, parent = parent, parent.Parent {
		switch parent.Kind {
		case ast.KindParenthesizedExpression, ast.KindObjectLiteralExpression:
			continue
		case ast.KindArrayLiteralExpression:
			path = append(path, pathStep{element: true})
			continue
		case ast.KindShorthandPropertyAssignment:
			if parent.Name() != node {
				return nil, nil
			}
			path = append(path, pathStep{property: node.Text()})
			continue
		case ast.KindPropertyAssignment:
			name := parent.Name()
			if parent.Initializer() != node || !(ast.IsIdentifier(name) || ast.IsStringLiteral(name) || ast.IsNumericLiteral(name)) {
				return nil, nil
			}
			path = append(path, pathStep{property: name.Text()})
			continue
		case ast.KindCallExpression, ast.KindNewExpression:
			for i, arg := range parent.Arguments() {
				if arg == node {
					reverse(path)
					return parent, append([]pathStep{{argument: i}}, path...)
				}
			}
		}
		return nil, nil
	}
	return nil, nil
}

// conditionalRoot returns the outermost conditional expression that holds
// node in a branch, through parentheses, or node when no conditional does.
func conditionalRoot(node *ast.Node) *ast.Node {
	root := node
	for n := node; n.Parent != nil; n = n.Parent {
		parent := n.Parent
		if parent.Kind == ast.KindParenthesizedExpression {
			continue
		}
		if parent.Kind != ast.KindConditionalExpression || parent.AsConditionalExpression().Condition == n {
			break
		}
		root = parent
	}
	return root
}

// pathStep is one step from a call's argument list down to a lambda: the
// argument at an index, an array element, or an object property.
type pathStep struct {
	argument int
	element  bool
	property string
}

func reverse(path []pathStep) {
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
}

func requiredParameterCount(fn *ast.Node) int {
	n := 0
	for _, p := range fn.Parameters() {
		if p.Initializer() != nil || p.QuestionToken() != nil || p.AsParameterDeclaration().DotDotDotToken != nil {
			break
		}
		n++
	}
	return n
}

// contextualReturnType makes what a .vibe effect function returns contextually
// typed by the success type of the Effect expected of it. Its body returns the
// success value, because the calls in it run: an effect function expected as
// (a) => Effect<B, E, R> returns a B. A program expected as Effect<A, E, R>
// has no contextual signature, so its body is typed by A, as the object a
// Layer.effect program returns is typed by the service's shape. A plain
// function returns what its body gives, so an Effect expected of it types its
// body as TypeScript does: Effect.succeed({ kind: "a" }) keeps the literal.
func contextualReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type, getContextual func() *checker.Type) *checker.Type {
	if !isLowerable(fn) || markedForm(fn) == formNone && !isProducer(fn) {
		return t
	}
	if t == nil {
		if !isLambda(fn) || requiredParameterCount(fn) != 0 {
			return nil
		}
		if contextual := getContextual(); contextual != nil && len(c.GetSignaturesOfType(contextual, checker.SignatureKindCall)) == 0 {
			return successType(c, contextual)
		}
		return nil
	}
	if success := successType(c, t); success != nil {
		return success
	}
	return t
}
