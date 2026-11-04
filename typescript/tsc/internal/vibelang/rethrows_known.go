package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { fileChecks = append(fileChecks, checkKnownRethrows) }

// Keep this plain-code check independent of foreign-call admission in effect code.
func checkKnownRethrows(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) {
			return false
		}
		if (ast.IsCallExpression(node) || ast.IsNewExpression(node) || ast.IsTaggedTemplateExpression(node)) &&
			!inCatchingTry(node) && !(ast.IsCallExpression(node) && (ast.IsSuperCall(node) || ast.IsImportCall(node))) {
			if home := a.plainHomeOf(node); home != nil && !a.throwsBelongToCall(home) {
				if thrown := a.rethrownThrows(node); len(thrown) > 0 && a.knownThrows(node) == nil {
					report(c, node, throwingCallOutsideEffect, nodeText(file, ast.GetInvokedExpression(node)), typeListText(c, thrown))
				}
			} else if home == nil && a.rethrowsUnbridgedInEffect(node) {
				thrown := a.rethrownThrows(node)
				report(c, ast.GetInvokedExpression(node), foreignThrowingCall, nodeText(file, ast.GetInvokedExpression(node)), typeListText(c, thrown))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// knownRethrownTypes retains explicit callback contracts at a plain invocation.
// The callee's own never does not erase a named callback's thrown type (VIP-4).
// Untagged callback values are not evidence of a known throw in plain code.
func knownRethrownTypes(c *checker.Checker, call *ast.Node) []*checker.Type {
	if returnsEffectful(c, call) {
		return nil
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return nil
	}
	decl := signature.Declaration()
	if decl == nil || !ast.IsFunctionLike(decl) {
		return nil
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil {
		return nil
	}
	if isVibeLangFile(file) {
		foreign := false
		for n := decl; n != nil; n = n.Parent {
			if isTypeScriptModule(n) {
				foreign = true
				break
			}
		}
		if !foreign {
			return nil
		}
	}
	named := map[string]bool{}
	if isLibFile(c, file) {
		key := globalKey(decl)
		switch {
		case strings.HasPrefix(key, "Array."), strings.HasPrefix(key, "ReadonlyArray."), key == "ArrayConstructor.from":
			if name := shippedRethrows[declarationName(decl)]; name != "" {
				named[name] = true
			}
		}
	} else {
		for _, host := range jsdocHosts(decl) {
			if ast.IsTypeAliasDeclaration(host) {
				continue
			}
			for _, doc := range host.JSDoc(nil) {
				for _, match := range rethrowsTag.FindAllStringSubmatch(file.Text()[doc.Pos():doc.End()], -1) {
					named[match[1]] = true
				}
			}
		}
	}
	if len(named) == 0 {
		return nil
	}
	var arguments []*ast.Node
	if !ast.IsTaggedTemplateExpression(call) {
		arguments = call.Arguments()
	}
	if ast.IsTaggedTemplateExpression(call) {
		arguments = []*ast.Node{nil} // the template-strings object is the first parameter
		template := call.AsTaggedTemplateExpression().Template
		if template.Kind == ast.KindTemplateExpression {
			for _, span := range template.AsTemplateExpression().TemplateSpans.Nodes {
				arguments = append(arguments, span.AsTemplateSpan().Expression)
			}
		}
	}
	var thrown []*checker.Type
	for index, parameter := range decl.Parameters() {
		if !named[declarationName(parameter)] {
			continue
		}
		end := index + 1
		if parameter.AsParameterDeclaration().DotDotDotToken != nil {
			end = len(arguments)
		}
		for position := index; position < end && position < len(arguments); position++ {
			argument := arguments[position]
			if argument == nil || ast.IsSpreadElement(argument) {
				continue
			}
			target := c.GetTypeAtPosition(signature, position)
			source := c.GetTypeAtLocation(argument)
			if target == nil || source == nil || !c.IsTypeAssignableTo(source, target) {
				continue
			}
			for _, part := range source.Distributed() {
				for _, given := range c.GetSignaturesOfType(part, checker.SignatureKindCall) {
					compatible := false
					for _, required := range c.GetSignaturesOfType(target, checker.SignatureKindCall) {
						if c.IsTypeAssignableTo(c.NewFunctionType(nil, []*checker.Signature{given}), c.NewFunctionType(nil, []*checker.Signature{required})) {
							compatible = true
							break
						}
					}
					if !compatible {
						continue
					}
					thrown = append(thrown, knownCallbackSignatureThrows(c, given, part)...)
				}
			}
		}
	}
	return thrown
}

func knownCallbackSignatureThrows(c *checker.Checker, signature *checker.Signature, owner *checker.Type) []*checker.Type {
	root := signature
	for root.Target() != nil {
		root = root.Target()
	}
	if isEffectfulType(c, c.InstantiateWrittenSignatureType(nil, c.GetReturnTypeOfSignature(root), []*checker.Type{owner})) {
		return nil
	}
	decl := root.Declaration()
	if decl == nil {
		return nil
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil {
		return nil
	}
	if isVibeLangFile(file) {
		foreign := false
		for n := decl; n != nil; n = n.Parent {
			if isTypeScriptModule(n) {
				foreign = true
				break
			}
		}
		if !foreign {
			return nil
		}
	}
	if isLibFile(c, file) {
		key := globalKey(decl)
		for n := decl.Parent; n != nil; n = n.Parent {
			if ast.IsGlobalScopeAugmentation(n) {
				canonical := strings.TrimPrefix(key, "global.")
				if _, present := globalThrowsTable[canonical]; present {
					key = canonical
				}
				break
			}
		}
		names, known := globalThrowsOf(key)
		if !known {
			return nil
		}
		var thrown []*checker.Type
		for _, name := range names {
			if value, ok := classFailure(c, name, c.GetGlobalSymbol(name, ast.SymbolFlagsValue, nil)); ok {
				thrown = append(thrown, value.t)
			}
		}
		return thrown
	}
	var thrown []*checker.Type
	for _, host := range jsdocHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			continue
		}
		for _, doc := range host.JSDoc(nil) {
			for _, tag := range jsdocTags(doc) {
				if !ast.IsJSDocThrowsTag(tag) || tag.AsJSDocThrowsTag().TypeExpression == nil {
					continue
				}
				node := tag.AsJSDocThrowsTag().TypeExpression.AsJSDocTypeExpression().Type
				if node == nil {
					continue
				}
				value := c.InstantiateWrittenSignatureType(signature, c.GetTypeFromTypeNode(node), []*checker.Type{owner})
				if value != nil && value.Flags()&checker.TypeFlagsNever == 0 {
					thrown = append(thrown, value)
				}
			}
		}
	}
	return thrown
}

// rethrownThrows is what call throws through its @rethrows callbacks: their
// written contracts (knownRethrownTypes) and, for a function literal passed
// to such a parameter, the known throws of the calls its own activation
// makes, which belong to the call (003 Plain code never throws). A function
// nested in the literal is its own code, and a call in a try block with a
// catch clause in the literal throws nothing out of it.
func (a *analyzer) rethrownThrows(call *ast.Node) []*checker.Type {
	thrown := knownRethrownTypes(a.checker, call)
	if !ast.IsCallExpression(call) && !ast.IsNewExpression(call) || returnsEffectful(a.checker, call) {
		return thrown
	}
	for index, argument := range call.Arguments() {
		literal := ast.SkipParentheses(argument)
		if !ast.IsFunctionExpressionOrArrowFunction(literal) || !rethrowsArgument(a.checker, call, index) {
			continue
		}
		// Async activations reject their Promise; generator and Effect bodies
		// do not execute when the callback is invoked.
		if ast.GetFunctionFlags(literal)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0 || a.runsAsEffect(literal) {
			continue
		}
		if signature := a.checker.GetSignatureFromDeclaration(literal); signature != nil && isEffectfulType(a.checker, a.checker.GetReturnTypeOfSignature(signature)) {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			// Use the same source owner as the admission check. Class bases,
			// enum initializers and transparent expressions execute here;
			// nested callable bodies and class fields keep their own owners.
			if (ast.IsCallExpression(n) || ast.IsNewExpression(n) || ast.IsTaggedTemplateExpression(n)) &&
				a.plainHomeOf(n) == literal && !caughtWithinLiteral(n, literal) {
				thrown = append(thrown, a.knownThrows(n)...)
				thrown = append(thrown, a.rethrownThrows(n)...)
			}
			return n.ForEachChild(visit)
		}
		literal.ForEachChild(visit)
	}
	return thrown
}

// rethrowsUnbridgedInEffect reports whether call, in effect code, throws
// through its @rethrows callbacks where trust.go's foreign-call check stays
// silent: a callee whose own contract is a written @throws {never}, or a
// built-in such as Array.prototype.map with a shipped annotation. The callee's
// own never does not erase a named callback's thrown type (VIP-4), so the
// call is EK0403 (003 Calls in effect code).
func (a *analyzer) rethrowsUnbridgedInEffect(call *ast.Node) bool {
	fn := enclosingFunction(call)
	if fn == nil || !a.runsAsEffect(fn) || outsideFibers(a.checker, a, call) {
		return false
	}
	if a.performs(call) || returnsEffectful(a.checker, call) || len(a.rethrownThrows(call)) == 0 {
		return false
	}
	if bound, written := foreignThrowsContract(a.checker, call); written {
		return bound == ""
	}
	return callTrust(a.checker, call).kind == trustBuiltin
}

// rethrowsArgument reports whether the argument at index of call is passed
// for a parameter its callee's @rethrows names, or the shipped annotation of
// a lib Array method names (Appendix E).
func rethrowsArgument(c *checker.Checker, call *ast.Node, index int) bool {
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	decl := signature.Declaration()
	if decl == nil || !ast.IsFunctionLike(decl) {
		return false
	}
	parameters := decl.Parameters()
	if index >= len(parameters) {
		if len(parameters) == 0 || parameters[len(parameters)-1].AsParameterDeclaration().DotDotDotToken == nil {
			return false
		}
		index = len(parameters) - 1
	}
	return rethrowsNames(c, decl)[declarationName(parameters[index])]
}

// rethrowsNames returns the parameter names decl's @rethrows tags name, or,
// for a lib Array method, the parameter its shipped annotation names.
func rethrowsNames(c *checker.Checker, decl *ast.Node) map[string]bool {
	named := map[string]bool{}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil {
		return named
	}
	if isLibFile(c, file) {
		key := globalKey(decl)
		if strings.HasPrefix(key, "Array.") || strings.HasPrefix(key, "ReadonlyArray.") || key == "ArrayConstructor.from" {
			if name := shippedRethrows[declarationName(decl)]; name != "" {
				named[name] = true
			}
		}
		return named
	}
	for _, host := range jsdocHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			continue
		}
		for _, doc := range host.JSDoc(nil) {
			for _, match := range rethrowsTag.FindAllStringSubmatch(file.Text()[doc.Pos():doc.End()], -1) {
				named[match[1]] = true
			}
		}
	}
	return named
}

// caughtWithinLiteral checks a call already assigned to this source owner.
// Generated transparent functions and eager enum/class expressions do not
// hide a source try/catch in that same activation.
func caughtWithinLiteral(node, literal *ast.Node) bool {
	for child := node; child.Parent != nil && child.Parent != literal; child = child.Parent {
		parent := child.Parent
		if parent.Kind == ast.KindTryStatement && parent.Flags&ast.NodeFlagsVibeLangBindingCleanup == 0 &&
			parent.AsTryStatement().TryBlock == child && catches(parent) {
			return true
		}
	}
	return false
}
