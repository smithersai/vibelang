package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// declaredProgramReturn reads only a written contract, never a return type
// inferred from this body. At a call D44's uninstantiated parameter wins:
// Effect.suspend's inferred A must not turn a returned function value into
// a program (F7).
func (a *analyzer) declaredProgramReturn(fn *ast.Node) *checker.Type {
	if fn == nil || !isLowerable(fn) || isProducer(fn) {
		return nil
	}
	if fn.Type() != nil {
		t := a.checker.GetTypeFromTypeNode(fn.Type())
		if isEffectType(a.checker, t) {
			return t
		}
		return nil
	}
	var expected []*checker.Type
	if call, path := ownerCall(fn); call != nil {
		if sig := a.candidateOf(call); sig != nil {
			expected = a.expectedAt(call, sig, path, fn)
		}
	} else {
		expected = a.contextualTypes(fn)
	}
	for _, t := range expected {
		// A declared Effect position describes the lambda's program, not a
		// factory signature. Its success channel also fixes EK4802's contract.
		if isEffectType(a.checker, t) {
			return t
		}
		// An optional member or parameter expects its function type or
		// undefined, as a Partial of a service shape does for its overrides.
		sigs := a.checker.GetSignaturesOfType(a.checker.GetNonNullableType(t), checker.SignatureKindCall)
		if len(sigs) == 1 {
			ret := a.checker.GetReturnTypeOfSignature(sigs[0])
			if isEffectType(a.checker, ret) {
				if call, _ := ownerCall(fn); call != nil {
					if candidate := a.candidateOf(call); candidate != nil {
						declared := a.declaredSignature(candidate)
						if factoryHasInferenceParameter(a.checker, successType(a.checker, ret), declared.TypeParameters(), 0) {
							return nil
						}
					}
				}
				return ret
			}
		}
	}
	return nil
}

func returnedBy(expr *ast.Node) *ast.Node {
	node := expr
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	parent := node.Parent
	if parent != nil && parent.Kind == ast.KindReturnStatement {
		return ast.GetContainingFunction(parent)
	}
	if parent != nil && ast.IsFunctionLike(parent) && parent.Body() == node {
		return parent
	}
	return nil
}

func factoryReturns(fn *ast.Node, cb func(*ast.Node)) {
	if !ast.IsBlock(fn.Body()) {
		cb(fn.Body())
		return
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindReturnStatement {
			cb(n.Expression())
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
}

// An overload's declared return can differ from its neighbor's. Memoize
// each candidate independently, just as lambda forms do (D44, D56).
type factoryKey struct {
	fn        *ast.Node
	candidate candidateKey
}

func (a *analyzer) isFactory(fn *ast.Node) bool {
	if fn == nil || !isLowerable(fn) || isProducer(fn) {
		return false
	}
	if a.factoryActive[fn] {
		return false
	}
	a.factoryActive[fn] = true
	defer delete(a.factoryActive, fn)
	key := factoryKey{fn: fn}
	if call, _ := ownerCall(fn); call != nil {
		if signature := a.candidateOf(call); signature != nil {
			key.candidate = keyOf(signature)
		}
	}
	if state := a.factories[key]; state != stateUnknown {
		return state == stateEffect
	}
	a.factories[key] = stateVisiting
	defer func() {
		if a.factories[key] == stateVisiting {
			a.factories[key] = statePure
		}
	}()
	declared := a.declaredProgramReturn(fn)
	if declared == nil {
		return false
	}
	// A lambda in an Effect position is itself a program, not a factory.
	if fn.Type() == nil {
		for _, t := range a.contextualTypes(fn) {
			if isEffectType(a.checker, t) {
				return false
			}
		}
	}
	success := successType(a.checker, declared)
	if success == nil {
		return false
	}
	found := false
	factoryReturns(fn, func(expr *ast.Node) {
		if a.factoryProgram(expr, success) {
			found = true
		}
	})
	if found {
		a.factories[key] = stateEffect
	}
	return found
}

func (a *analyzer) factoryProgram(expr *ast.Node, success *checker.Type) bool {
	if expr == nil {
		return false
	}
	expr = ast.SkipParentheses(expr)
	if isInvocation(expr) {
		return false
	}
	// A returned conditional returns one of its arms, so an arm that is a
	// program makes a factory, as a `return` of it does (returnOwner gives
	// each arm its own delegation). A conditional with an arm that runs, such
	// as `c ? work() : Effect.void`, keeps compiling as an Effect function's
	// result, as it always has.
	if expr.Kind == ast.KindConditionalExpression {
		if conditionalRunsArm(expr) {
			return false
		}
		conditional := expr.AsConditionalExpression()
		return a.factoryProgram(conditional.WhenTrue, success) || a.factoryProgram(conditional.WhenFalse, success)
	}
	if isLambda(expr) && len(expr.Parameters()) == 0 {
		// Test the return under the pre-factory success context. D7/D9 may
		// already convert it to a program or an Effect function accepted by
		// A; those compiling returns keep their existing calling convention.
		if owner := returnedBy(expr); owner != nil {
			active := a.factoryActive[owner]
			a.factoryActive[owner] = true
			defer func() {
				if active {
					a.factoryActive[owner] = true
				} else {
					delete(a.factoryActive, owner)
				}
			}()
		}

		// Read the function signature without applying its expression-form
		// hook. This is TypeScript's function value before D7 conversion;
		// A may already accept it (functions, object, {}, unknown, or a union).
		sig := a.checker.GetSignatureFromDeclaration(expr)
		value := a.checker.NewFunctionTypeWithReturnType(nil, sig, a.checker.GetReturnTypeOfSignature(sig))
		if a.checker.IsTypeAssignableTo(value, success) {
			return false
		}
		existing := a.typeInForm(expr, value, a.decide(expr, a.classify([]*checker.Type{success})))
		return !a.checker.IsTypeAssignableTo(existing, success)
	}
	// Scalar operators cannot return a program. Probing their operands here
	// would type recursive locals before forms.go's provisional form is set
	// (the landed recursive-contract-lambdas depth case).
	if ast.IsBinaryExpression(expr) {
		op := expr.AsBinaryExpression().OperatorToken.Kind
		if !ast.IsLogicalOrCoalescingBinaryOperator(op) && !ast.IsLogicalOrCoalescingAssignmentOperator(op) && op != ast.KindEqualsToken && op != ast.KindCommaToken {
			return false
		}
	}
	if ast.IsIdentifier(expr) {
		if symbol := a.checker.GetSymbolAtLocation(expr); symbol != nil {
			// A class named inside its own extends expression, as in
			// Schema.Class<Crate>("Crate")({ children: Schema.suspend(
			// (): Schema.Codec<Crate, W>!! => Crate) }), has no static type
			// until that base resolves. Reading it here reports TS2506, so
			// keep D67's success-return convention, as for the const below.
			if decl := symbol.ValueDeclaration(); decl != nil && ast.IsClassLike(decl) {
				for parent := expr.Parent; parent != nil && parent != decl; parent = parent.Parent {
					if ast.IsHeritageClause(parent) {
						return false
					}
				}
			}
			if decl := symbol.ValueDeclaration(); decl != nil && ast.IsVariableDeclaration(decl) && decl.Type() == nil {
				// An unannotated local call runs and binds its success, just
				// like a call returned directly above. It cannot select D269's
				// held-program factory form. Reading its type here can resolve
				// a recursive arrow before its initializer has a type (TS7022,
				// engine-store); an explicitly Effect-typed local stays held.
				if init := decl.Initializer(); init != nil && isInvocation(ast.SkipParentheses(init)) {
					return false
				}
				// A lazy recursive value such as Schema.suspend(() => Crate)
				// has no inferred type until its initializer is checked. Keep
				// D67's success-return convention instead of creating a cycle;
				// D269's explicitly typed held programs remain eligible.
				for parent := expr.Parent; parent != nil; parent = parent.Parent {
					if parent == decl {
						return false
					}
				}
			}
		}
	}
	t := a.checker.GetTypeAtLocation(expr)
	return isEffectType(a.checker, t) && !a.checker.IsTypeAssignableTo(t, success)
}

func init() { fileChecks = append(fileChecks, checkFactories) }

func checkFactories(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(fn *ast.Node) bool {
		if a.isFactory(fn) {
			name := functionDisplayName(fn)
			var body func(*ast.Node) bool
			body = func(call *ast.Node) bool {
				if isFunctionBoundary(call) || a.byNameOf(call) != nil {
					return false
				}
				if !isInvocation(call) || !a.performs(call) {
					return call.ForEachChild(body)
				}
				text := nodeText(file, call)
				d := report(c, call, EK2115, name, text)
				note(d, "Move {0} into the returned program: return () => { … }.", text)
				if outer := returnedBy(call); outer == fn {
					note(d, "Hold it first, const program: {0} = {1}, and return program; or return () => {1} to call it when the program runs.", c.TypeToString(a.declaredProgramReturn(fn)), text)
				}
				return false // outermost running call owns this diagnostic
			}
			body(fn.Body())
			if list := firstUsing(fn); list != nil {
				d := report(c, list, EK2115, name, "using")
				note(d, "Move using into the returned program: return () => { … }.")
			}
			a.reportFactoryFailures(file, fn, name) // D282 (plain_failures.go)
			if hasVibeLangStatement(fn) || a.hasStreamLoop(fn) {
				d := report(c, fn.Body(), EK2115, name, "this Effect statement")
				note(d, "Move it into the returned program: return () => { … }.")
			}
			success := successType(c, a.declaredProgramReturn(fn))
			factoryReturns(fn, func(expr *ast.Node) {
				if a.factoryProgram(expr, success) {
					a.checkFactoryProgram(file, fn, expr)
					return
				}
				if expr != nil && isInvocation(ast.SkipParentheses(expr)) && a.performs(ast.SkipParentheses(expr)) {
					coverFactoryReturn(c, expr)
					return
				}
				site, text := fn, "return without a program"
				if expr != nil {
					site, text = expr, nodeText(file, expr)
				}
				d := report(c, site, EK2116, name, text)
				note(d, "Return () => value, or () => { throw error } to fail when the program runs.")
				coverFactoryReturn(c, site)
			})
			if ast.IsBlock(fn.Body()) && c.FunctionHasImplicitReturn(fn) {
				d := report(c, fn, EK2116, name, "falling off the end")
				note(d, "Return () => value, or () => { throw error } to fail when the program runs.")
				if fn.Type() != nil {
					cover(c, fn.Type())
				}
			}
		}
		return fn.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// A candidate's success type must be fixed by its declaration, not by
// inferring the callback's returned function (F7).
func factoryHasInferenceParameter(c *checker.Checker, t *checker.Type, parameters []*checker.Type, depth int) bool {
	if t == nil || len(parameters) == 0 || depth > 8 {
		return false
	}
	t = unwrapSubstitution(t)
	if t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		for _, parameter := range parameters {
			if t == parameter {
				return true
			}
		}
		return false
	}
	if t.Flags()&(checker.TypeFlagsConditional|checker.TypeFlagsIndexedAccess) != 0 {
		return true
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		for _, part := range t.Types() {
			if factoryHasInferenceParameter(c, part, parameters, depth+1) {
				return true
			}
		}
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		for _, part := range c.GetTypeArguments(t) {
			if factoryHasInferenceParameter(c, part, parameters, depth+1) {
				return true
			}
		}
	}
	for _, signature := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if factoryHasInferenceParameter(c, c.GetReturnTypeOfSignature(signature), parameters, depth+1) {
			return true
		}
		for _, parameter := range signature.Parameters() {
			if factoryHasInferenceParameter(c, c.GetTypeOfSymbol(parameter), parameters, depth+1) {
				return true
			}
		}
	}
	if t.Flags()&checker.TypeFlagsObject != 0 && t.ObjectFlags()&checker.ObjectFlagsReference == 0 {
		for _, property := range c.GetPropertiesOfType(t) {
			if factoryHasInferenceParameter(c, c.GetTypeOfSymbol(property), parameters, depth+1) {
				return true
			}
		}
	}
	return false
}

// E and R still belong to the returned program, rather than the factory's
// JavaScript phase. Keep the contract diagnostics used by ordinary programs.
func (a *analyzer) checkFactoryProgram(file *ast.SourceFile, fn, expr *ast.Node) {
	c := a.checker
	declared := a.declaredProgramReturn(fn)
	program := ast.SkipParentheses(expr)
	var info *effectInfo
	if isLambda(program) {
		info = a.effectOf(program)
	} else {
		t := c.GetTypeAtLocation(expr)
		info = &effectInfo{}
		if e := channelType(c, t, "_E"); e != nil {
			info.addError(e, expr)
		}
		if r := channelType(c, t, "_R"); r != nil {
			info.addRequirement(r, expr)
		}
	}
	if info == nil {
		return
	}
	name := functionDisplayName(fn)
	errors, requirements := info.errors, info.requirements
	if contract := a.contractOf(fn); contract != nil {
		if contract.inferred(channelE) {
			errors = nil
		}
		if contract.inferred(channelR) {
			requirements = nil
		}
	}
	for _, escape := range escapes(c, errors, info.errorSources, channelType(c, declared, "_E")) {
		report(c, escape.source, EK9201, c.TypeToString(escape.t), name, "its contract says E = "+c.TypeToString(channelType(c, declared, "_E")))
		coverFactoryReturn(c, expr)
	}
	for _, escape := range escapes(c, requirements, info.requirementSources, channelType(c, declared, "_R")) {
		report(c, escape.source, EK9202, name, c.TypeToString(escape.t), c.TypeToString(channelType(c, declared, "_R")))
		coverFactoryReturn(c, expr)
	}
}

// TypeScript attaches a return mismatch to the return keyword, whereas the
// factory diagnostic names the expression. Cover that statement, not only
// the value's narrower span, when the EK diagnostic explains the mismatch.
func coverFactoryReturn(c *checker.Checker, value *ast.Node) {
	site := ast.WalkUpParenthesizedExpressions(value)
	if site.Parent != nil && site.Parent.Kind == ast.KindReturnStatement {
		site = site.Parent
	}
	cover(c, site)
}

// D57 infers a factory's channels from its returned programs. Its eager
// JavaScript phase contributes neither failures nor requirements.
func (a *analyzer) factoryInfo(fn *ast.Node) *effectInfo {
	info := &effectInfo{}
	factoryReturns(fn, func(expr *ast.Node) {
		if expr == nil {
			return
		}
		expr = ast.SkipParentheses(expr)
		if isLambda(expr) && len(expr.Parameters()) == 0 {
			if returned := a.effectOf(expr); returned != nil {
				info.add(returned)
			}
		} else if !isInvocation(expr) {
			t := a.checker.GetTypeAtLocation(expr)
			if e := channelType(a.checker, t, "_E"); e != nil {
				info.addError(e, expr)
			}
			if r := channelType(a.checker, t, "_R"); r != nil {
				info.addRequirement(r, expr)
			}
		}
	})
	return info
}

// conditionalRunsArm reports whether an arm of a conditional, or of a
// conditional nested in an arm, is a call, a tagged template, or a pipe that
// ends in one.
func conditionalRunsArm(node *ast.Node) bool {
	conditional := node.AsConditionalExpression()
	for _, arm := range []*ast.Node{conditional.WhenTrue, conditional.WhenFalse} {
		arm = ast.SkipParentheses(arm)
		if isInvocation(arm) || pipeEndsInCall(arm) || arm.Kind == ast.KindConditionalExpression && conditionalRunsArm(arm) {
			return true
		}
	}
	return false
}
