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

// candidateKey identifies an overload candidate across its instantiations:
// the declaration that declares it, or the uninstantiated signature when it
// has none.
type candidateKey any

func keyOf(signature *checker.Signature) candidateKey {
	if d := signature.Declaration(); d != nil {
		return d
	}
	for signature.Target() != nil {
		signature = signature.Target()
	}
	return signature
}

// lambdaState is what the analyzer knows about one lambda.
type lambdaState struct {
	byCandidate    map[candidateKey]form // the first form each candidate asked for
	first          form                  // the form the first candidate to check the lambda asked for
	free           form                  // the form outside every call's candidates
	deciding       bool                  // free is being decided; a recursive call sees provisionalForm
	reentered      bool                  // a recursive call saw provisionalForm while free was being decided
	typedAsWritten bool                  // TypeScript typed fn while checking its signature, before any form (functionExpressionType)
	types          [5]*checker.Type      // the lambda's type in each form
}

func (a *analyzer) lambda(fn *ast.Node) *lambdaState {
	s := a.lambdas[fn]
	if s == nil {
		s = &lambdaState{byCandidate: map[candidateKey]form{}}
		a.lambdas[fn] = s
	}
	return s
}

// isLambda reports whether fn is a function expression or arrow function in
// a .vibe file whose form the analyzer decides.
func isLambda(fn *ast.Node) bool {
	return (fn.Kind == ast.KindArrowFunction || fn.Kind == ast.KindFunctionExpression) && isLowerable(fn) && !isProducer(fn)
}

// callCandidate records that call's arguments are being checked against
// candidate, so a lambda among them takes that candidate's form.
func callCandidate(c *checker.Checker, call *ast.Node, candidate *checker.Signature) func() {
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) {
		return func() {}
	}
	a := analyzerFor(c)
	a.current[call] = append(a.current[call], candidate)
	return func() {
		stack := a.current[call]
		if len(stack) <= 1 {
			delete(a.current, call)
		} else {
			a.current[call] = stack[:len(stack)-1]
		}
	}
}

// filterCandidate rejects a candidate that asked a lambda argument for the
// plain form when that lambda can pause: a plain function cannot run an
// Effect, so the candidate does not accept the lambda in the form it expects
// (D56), and overload resolution moves on to the next candidate.
func filterCandidate(c *checker.Checker, call *ast.Node, candidate *checker.Signature, arguments []checker.CheckedArgument) bool {
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) {
		return true
	}
	a := analyzerFor(c)
	if a.rejected[call][keyOf(candidate)] {
		return false
	}
	if !ast.IsCallExpression(call) && !ast.IsNewExpression(call) {
		return true
	}
	for _, argument := range arguments {
		if a.plainAssignmentMismatch(argument.Node, argument.Target, argument.Type) != nil {
			return false
		}
	}
	return true
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
	return a.typeInForm(fn, t, a.formHere(fn))
}

// formHere decides fn's form for the check in progress: against the candidate
// the enclosing call is being checked against, else against the candidate
// that call selected, else from fn's contextual type and body. It records the
// first answer for each candidate.
func (a *analyzer) formHere(fn *ast.Node) form {
	s := a.lambda(fn)
	call, path := ownerCall(fn)
	if call != nil {
		if signature := a.candidateOf(call); signature != nil {
			key := keyOf(signature)
			if f, ok := s.byCandidate[key]; ok {
				return f
			}
			e := a.expectationAt(call, signature, path, fn)
			f := a.decide(fn, e)
			if f == formFactory && e.plainFn && !e.effectFn {
				a.reject(call, key)
			}
			s.byCandidate[key] = f
			if s.first == formNone {
				s.first = f
			}
			return f
		}
	}
	return a.freeForm(fn)
}

// expectationAt reads what signature, the candidate call is checked against,
// expects of fn at path among call's arguments.
func (a *analyzer) expectationAt(call *ast.Node, signature *checker.Signature, path []pathStep, fn *ast.Node) expectation {
	return a.classify(a.expectedAt(call, signature, path, fn))
}

// finalForm is the form fn compiles to: the form the candidate its call
// selected asked for, or the form it has outside any call. When no candidate
// accepted the call, TypeScript may report it against a signature no
// candidate was checked as, and fn keeps the form the first candidate asked
// for.
func (a *analyzer) finalForm(fn *ast.Node) form {
	if call, _ := ownerCall(fn); call != nil {
		if signature := a.candidateOf(call); signature != nil {
			s := a.lambda(fn)
			if f, ok := s.byCandidate[keyOf(signature)]; ok {
				return f
			}
			if s.first != formNone {
				return s.first
			}
		}
	}
	return a.freeForm(fn)
}

// firstPause returns the first call in fn's own body that performs an Effect
// operation, or nil when fn compiles to plain JavaScript.
func (a *analyzer) firstPause(fn *ast.Node) *ast.Node {
	var pause *ast.Node
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if a.performs(call) {
			pause = call
			return true
		}
		return false
	})
	return pause
}

// freeForm is fn's form where no candidate decides it: from its contextual
// type, else from its body. While it is being decided, a call from fn's body
// back to fn sees provisionalForm. The checker keeps what that call sees: the
// call resolves fn's variable afresh (getResolvedSignature restarts
// TypeScript's cycle detection), types fn in the provisional form, and caches
// that type as the variable's. So when such a call happened, fn takes the
// provisional form. A recursive lambda that runs nothing else is plain (the
// greatest fixpoint, as D56 says for D10), unless it has an Effect contract:
// then the recursive call runs an Effect and fn is an Effect function, the
// form its contract allows wherever it calls itself.
func (a *analyzer) freeForm(fn *ast.Node) form {
	s := a.lambda(fn)
	if s.free != formNone {
		return s.free
	}
	if s.deciding {
		s.reentered = true
		return a.provisionalForm(fn)
	}
	s.deciding = true
	f := a.decide(fn, a.classify(a.contextualTypes(fn)))
	s.deciding = false
	if s.reentered && f == formPlain {
		f = a.provisionalForm(fn)
	}
	s.free = f
	return f
}

// D269 adds a factory form; retain the recursion crash fix state for all five forms.
// provisionalForm is the form a recursive call sees while fn's free form is
// being decided: an Effect function when fn has an Effect contract, else plain.
func (a *analyzer) provisionalForm(fn *ast.Node) form {
	if a.hasPlainContract(fn) {
		return formPlain
	}
	return formEffect
}

// decide turns an expectation into a form for fn. Without one, fn is plain
// when D10 allows it and an Effect function otherwise, and so is fn where a
// function that returns a plain value or an Effect is expected. Where only an
// Effect is expected, fn is a program; with required parameters it cannot be
// one, so it stays an Effect function and TypeScript reports the mismatch.
// Where a function or an Effect is expected (D39), a function with parameters
// is a function, and one without is a program when it can pause.
func (a *analyzer) decide(fn *ast.Node, e expectation) form {
	if f := markedForm(fn); f != formNone {
		return f
	}
	if outer := returnedBy(fn); len(fn.Parameters()) == 0 && outer != nil && a.isFactory(outer) {
		return formProgram
	}
	if a.isFactory(fn) {
		return formFactory
	}
	if fn.Type() != nil && a.hasPlainContract(fn) {
		return formPlain // D500: a plain return annotation makes a plain function
	}
	if a.hasContract(fn) {
		// D500: an Effect annotation makes an Effect function wherever it
		// stands; where only a plain function fits, TypeScript's
		// assignability or EK4301 rejects it (callbacks.go).
		if e.program && !e.effectFn && !e.plainFn && requiredParameterCount(fn) == 0 {
			return formProgram
		}
		return formEffect
	}
	if a.atProtocolKey(fn) && !a.hasContract(fn) {
		return formPlain // D484: a protocol key is a destination of the plain form
	}
	if a.isCatchOperandProgram(fn) {
		return formPlain // it gives the program, and the catch runs it
	}
	if isCalledInPlace(fn) {
		// A match or an is expression is an arrow the parser writes and calls
		// where it stands (isProgramArrow): no source text writes it as a
		// function, so its body's form is the code's around it.
		if a.canBePlain(fn) && !a.hasEscapingFailure(fn) {
			return formPlain
		}
		return formEffect
	}
	switch {
	case e.plainFn:
		return formPlain // D112, D500: where both forms fit, plain unless an Effect annotation says otherwise
	case e.effectFn:
		return formEffect
	case e.program && requiredParameterCount(fn) == 0:
		return formProgram
	}
	return formEffect // D500: no destination, as for a literal with none
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

func (a *analyzer) reject(call *ast.Node, key candidateKey) {
	m := a.rejected[call]
	if m == nil {
		m = map[candidateKey]bool{}
		a.rejected[call] = m
	}
	m[key] = true
}

// candidateOf returns the candidate call's arguments are being checked
// against, else the signature overload resolution selected for call, which is
// an instantiation of the selected candidate.
func (a *analyzer) candidateOf(call *ast.Node) *checker.Signature {
	if stack := a.current[call]; len(stack) > 0 {
		return stack[len(stack)-1]
	}
	if a.resolving[call] {
		return nil
	}
	a.resolving[call] = true
	defer delete(a.resolving, call)
	return a.checker.GetResolvedSignature(call)
}

// canBePlain reports whether fn compiles to plain JavaScript (D10): its body
// runs no Effect, looks up no service, and declares no using (D54).
// No throw can end it: a throw is a typed failure everywhere (D282).
func (a *analyzer) canBePlain(fn *ast.Node) bool {
	// D67 keeps callbacks typed as written in their explicit Effect form.
	if s := a.lambdas[fn]; s != nil && s.typedAsWritten && a.contractOf(fn) != nil {
		return false // TypeScript gave fn its contract's Effect type (functionExpressionType)
	}
	if a.isBodyDeferred(fn) {
		return a.hasPlainContract(fn) // the deferred check reports a body that cannot be plain (EK9203)
	}
	// D147 skips by-name argument bodies; S5-1 keeps returned programs effectful.
	return !a.forEachRunningCallInBody(fn, a.performs) && !hasEscapingThrow(fn) && !declaresUsing(fn) && !hasVibeLangStatement(fn) && !a.hasStreamLoop(fn) && !a.hasProgramReturn(fn)
}

// typeInForm returns fn's type in form f, given t, the type TypeScript
// inferred for it: a function that returns its body's success value A. A
// lambda with a return annotation keeps the type it writes (D500).
func (a *analyzer) typeInForm(fn *ast.Node, t *checker.Type, f form) *checker.Type {
	if f == formFactory {
		if fn.Type() != nil {
			return t
		}
		if sigs := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall); len(sigs) == 1 {
			declared := a.declaredProgramReturn(fn)
			// A declared program type that names the candidate's type
			// parameters, as R2 does in (a: A) => void!!R2, is what inference
			// reads from fn's type. A factory whose returns TypeScript already
			// types as an Effect, as () => Effect.void, keeps that type, or R2
			// would be inferred as itself.
			if returned := a.checker.GetReturnTypeOfSignature(sigs[0]); isEffectType(a.checker, returned) && a.namesCandidateTypeParameters(fn, declared) {
				return t
			}
			return a.checker.NewFunctionTypeWithReturnType(t.Symbol(), sigs[0], declared)
		}
		return t
	}
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
	errors, requirements := info.errors, info.requirements
	return a.checker.NewTypeReference(effect, []*checker.Type{success, a.checker.GetUnionType(errors), a.checker.GetUnionType(requirements)})
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

// contextualReturnType makes what a .vibe function returns contextually typed
// by the success type of the Effect expected of it. Its body returns the
// success value, because the calls in it run: an Effect function expected as
// (a) => Effect<B, E, R> returns a B. A program expected as Effect<A, E, R>
// has no contextual signature, so its body is typed by A, as the object a
// Layer.effect program returns is typed by the service's shape.
func contextualReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type, getContextual func() *checker.Type) *checker.Type {
	if !isLowerable(fn) {
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
	if analyzerFor(c).isFactory(fn) {
		return t
	}
	if success := successType(c, t); success != nil {
		return success
	}
	return t
}

// isBodyDeferred reports whether fn's body cannot be read yet, as in
//
//	const Recursive = Flow.make("r", { body: (p): Node<number> => Recursive.call(p) })
//
// while TypeScript infers make's type arguments: fn has a return annotation,
// so TypeScript types its body only after the initializer fn is in, and the
// body calls the variable that initializer declares. Resolving that call
// sooner reports a circularity (TS7022) that TypeScript does not, so until
// then fn's form follows its annotation (D67).
func (a *analyzer) isBodyDeferred(fn *ast.Node) bool {
	body := fn.Body()
	if fn.Type() == nil || body == nil {
		return false
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			// Only a callee's leftmost name is a reference whose symbol can
			// be resolved here without typing anything.
			root := node.Expression()
			for ast.IsPropertyAccessExpression(root) || ast.IsElementAccessExpression(root) || ast.IsParenthesizedExpression(root) {
				root = root.Expression()
			}
			if ast.IsIdentifier(root) {
				if symbol := a.checker.GetResolvedSymbol(root); symbol != nil && symbol.Flags()&ast.SymbolFlagsVariable != 0 && a.checker.IsResolvingTypeOf(symbol) {
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	return visit(body)
}

// namesCandidateTypeParameters reports whether t mentions a type parameter of
// the declared candidate that fn's owner call is checked against. A branch of
// a conditional takes the conditional's contextual type, so fn may stand in a
// branch of the argument, as in run(watching ? observe : () => Effect.void).
func (a *analyzer) namesCandidateTypeParameters(fn *ast.Node, t *checker.Type) bool {
	call, _ := ownerCall(conditionalRoot(fn))
	if call == nil || t == nil {
		return false
	}
	candidate := a.candidateOf(call)
	if candidate == nil {
		return false
	}
	declared := a.declaredSignature(candidate)
	return declared != nil && factoryHasInferenceParameter(a.checker, t, declared.TypeParameters(), 0)
}
