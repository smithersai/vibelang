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
			!inCatchingTry(node) && !(ast.IsCallExpression(node) && ast.IsImportCall(node)) {
			if home := a.plainHomeOf(node); home != nil && !a.throwsBelongToCall(home, node) {
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
	arguments := knownRethrowsArguments(c, call)
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
			for _, argument := range rethrowsCallbackAlternatives(c, arguments[position]) {
				source := argument.source
				if source == nil {
					continue
				}
				target := c.GetTypeAtPosition(signature, position)
				if target == nil || source == nil || !c.IsTypeAssignableTo(source, target) {
					continue
				}
				for _, part := range source.Distributed() {
					for _, given := range c.GetSignaturesOfType(part, checker.SignatureKindCall) {
						compatible := false
						for _, required := range c.GetSignaturesOfType(c.GetNonNullableType(target), checker.SignatureKindCall) {
							if c.IsTypeAssignableTo(c.NewFunctionType(nil, []*checker.Signature{given}), c.NewFunctionType(nil, []*checker.Signature{required})) {
								compatible = true
								break
							}
						}
						if !compatible {
							continue
						}
						owners := []*checker.Type{part}
						if argument.expression != nil && callbackReceiverIsWritten(c, argument.expression, map[*ast.Symbol]bool{}) {
							owners = append(foreignReferenceOwners(c, argument.expression), part)
						}
						thrown = append(thrown, knownCallbackSignatureThrows(c, given, owners...)...)
					}
				}
			}
		}
	}
	return thrown
}

// A conditional can reduce to one structurally equivalent function type.
// Retain each written branch before reading its thrown contract. Assertions
// remain authoritative callable types; spread slots keep their existing types.
func rethrowsCallbackAlternatives(c *checker.Checker, argument knownRethrowsArgument) []knownRethrowsArgument {
	if argument.expression == nil {
		return []knownRethrowsArgument{argument}
	}
	node := ast.SkipParentheses(argument.expression)
	if ast.IsConditionalExpression(node) {
		conditional := node.AsConditionalExpression()
		left := knownRethrowsArgument{conditional.WhenTrue, c.GetTypeAtLocation(conditional.WhenTrue)}
		right := knownRethrowsArgument{conditional.WhenFalse, c.GetTypeAtLocation(conditional.WhenFalse)}
		return append(rethrowsCallbackAlternatives(c, left), rethrowsCallbackAlternatives(c, right)...)
	}
	return []knownRethrowsArgument{argument}
}

func knownCallbackSignatureThrows(c *checker.Checker, signature *checker.Signature, owners ...*checker.Type) []*checker.Type {
	root := signature
	for root.Target() != nil {
		root = root.Target()
	}
	if isEffectfulType(c, c.InstantiateWrittenSignatureType(nil, c.GetReturnTypeOfSignature(root), owners)) {
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
	for _, host := range sourceSignatureHosts(decl) {
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
				value := c.InstantiateWrittenSignatureType(signature, c.GetTypeFromTypeNode(node), owners)
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
	if !ast.IsCallExpression(call) && !ast.IsNewExpression(call) && !ast.IsTaggedTemplateExpression(call) || returnsEffectful(a.checker, call) {
		return thrown
	}
	for index, argument := range rethrowsCallArguments(call) {
		if argument == nil {
			continue
		}
		literal := ast.SkipParentheses(argument)
		if !ast.IsFunctionExpressionOrArrowFunction(literal) || !rethrowsArgument(a.checker, call, index) {
			continue
		}
		// Ordinary async initialization rejects its Promise. Generator
		// initialization still runs at the call; only its body is deferred.
		flags := ast.GetFunctionFlags(literal)
		if flags&ast.FunctionFlagsAsync != 0 && flags&ast.FunctionFlagsGenerator == 0 || a.runsAsEffect(literal) {
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
				a.plainHomeOf(n) == literal && (flags&ast.FunctionFlagsGenerator == 0 || inParameterListOf(n, literal)) && !caughtWithinLiteral(n, literal) {
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
	index = invocationArgumentPosition(c, call, index)
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

// rethrowsCallArguments preserves native invocation positions. A tag receives
// its template-strings object first, followed by the written substitutions.
func rethrowsCallArguments(call *ast.Node) []*ast.Node {
	if !ast.IsTaggedTemplateExpression(call) {
		return call.Arguments()
	}
	arguments := []*ast.Node{nil}
	template := call.AsTaggedTemplateExpression().Template
	if template.Kind == ast.KindTemplateExpression {
		for _, span := range template.AsTemplateExpression().TemplateSpans.Nodes {
			arguments = append(arguments, span.AsTemplateSpan().Expression)
		}
	}
	return arguments
}

// Extra receiver owners are valid only when a written type or constant
// reference establishes them. Native inference can merge distinct throws
// contracts, so do not recover a receiver from a conditional or mutable value.
func callbackReceiverIsWritten(c *checker.Checker, node *ast.Node, seen map[*ast.Symbol]bool) bool {
	node = ast.SkipParentheses(node)
	if node == nil {
		return false
	}
	if ast.IsAsExpression(node) || ast.IsTypeAssertion(node) || node.Kind == ast.KindThisKeyword {
		return true
	}
	property := ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node)
	if property && !callbackReceiverIsWritten(c, node.Expression(), seen) {
		return false
	}
	if !property && !ast.IsIdentifier(node) {
		return false
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || seen[symbol] {
		return false
	}
	seen[symbol] = true
	for _, declaration := range symbol.Declarations() {
		switch {
		case ast.IsVariableDeclaration(declaration):
			if declaration.Type() != nil {
				return true
			}
			return ast.IsVarConst(declaration) && declaration.Initializer() != nil &&
				callbackReceiverIsWritten(c, declaration.Initializer(), seen)
		case ast.IsBindingElement(declaration):
			root := ast.GetRootDeclaration(declaration)
			if !ast.IsVariableDeclaration(root) || !ast.IsVarConst(root) {
				return false
			}
			for element := declaration; ast.IsBindingElement(element); element = element.Parent.Parent {
				if element.Initializer() != nil {
					return false
				}
			}
			return root.Type() != nil || root.Initializer() != nil && callbackReceiverIsWritten(c, root.Initializer(), seen)
		case ast.IsPropertyDeclaration(declaration), ast.IsParameterDeclaration(declaration), ast.IsGetAccessorDeclaration(declaration):
			return declaration.Type() != nil
		case ast.IsPropertyAssignment(declaration), ast.IsShorthandPropertyAssignment(declaration):
			return false
		default:
			return true
		}
	}
	return false
}

type knownRethrowsArgument struct {
	expression *ast.Node
	source     *checker.Type
}

// Fixed tuple spreads occupy their native argument positions. Their element
// signatures carry contracts independently of the tuple container's metadata.
func knownRethrowsArguments(c *checker.Checker, call *ast.Node) []knownRethrowsArgument {
	var result []knownRethrowsArgument
	arguments := rethrowsCallArguments(call)
	for index, argument := range arguments {
		if argument == nil {
			result = append(result, knownRethrowsArgument{})
			continue
		}
		if !ast.IsSpreadElement(argument) {
			result = append(result, knownRethrowsArgument{argument, c.GetTypeAtLocation(argument)})
			continue
		}
		elements, fixed := fixedRethrowsSpreadTypes(c, argument)
		if !fixed && index == len(arguments)-1 {
			elements, fixed = trailingOptionalRethrowsSpreadTypes(c, argument)
		}
		if !fixed {
			result = append(result, knownRethrowsArgument{})
			continue
		}
		for _, element := range elements {
			result = append(result, knownRethrowsArgument{source: element})
		}
	}
	return result
}

// invocationArgumentPosition maps a written argument index past fixed spreads.
// Inspect only preceding spreads, avoiding rechecking the current callback.
func invocationArgumentPosition(c *checker.Checker, call *ast.Node, index int) int {
	position := index
	arguments := rethrowsCallArguments(call)
	for i := 0; i < index && i < len(arguments); i++ {
		if elements, fixed := fixedRethrowsSpreadTypes(c, arguments[i]); fixed {
			position += len(elements) - 1
		}
	}
	return position
}

func fixedRethrowsSpreadTypes(c *checker.Checker, argument *ast.Node) ([]*checker.Type, bool) {
	if argument == nil || !ast.IsSpreadElement(argument) {
		return nil, false
	}
	spread := c.GetTypeAtLocation(argument.Expression())
	if !checker.IsTupleType(spread) {
		return nil, false
	}
	for _, flag := range spread.TargetTupleType().ElementFlags() {
		if flag&checker.ElementFlagsRequired == 0 {
			return nil, false
		}
	}
	return c.GetTypeArguments(spread), true
}

// Optional entries in a final tuple spread keep their parameter positions
// whenever present. A later written argument can shift when entries are
// absent, so that case retains the existing unknown-position treatment.
func trailingOptionalRethrowsSpreadTypes(c *checker.Checker, argument *ast.Node) ([]*checker.Type, bool) {
	if argument == nil || !ast.IsSpreadElement(argument) {
		return nil, false
	}
	spread := c.GetTypeAtLocation(argument.Expression())
	if !checker.IsTupleType(spread) {
		return nil, false
	}
	optional := false
	for _, flag := range spread.TargetTupleType().ElementFlags() {
		if flag&checker.ElementFlagsFixed == 0 {
			return nil, false
		}
		optional = optional || flag&checker.ElementFlagsOptional != 0
	}
	if !optional {
		return nil, false
	}
	return c.GetTypeArguments(spread), true
}
