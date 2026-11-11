package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Retained foreign function declarations default to unknown (VIP-4, chapter
// 003). Check their callback assignments and class fields with native-compatible
// signatures. Foreign callable variables retain their value provenance;
// accessor provenance is outside this slice.
func init() { fileChecks = append(fileChecks, checkDefaultForeignCallbacks) }

func checkDefaultForeignCallbacks(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if replacement := schemaGenericReplacement(c, node); replacement != nil {
			return visit(replacement)
		}
		if ast.IsClassLike(node) && classKindOf(node) == ordinaryClass {
			checkDefaultForeignCallbackClass(c, node)
		}
		if defaultForeignValueContext(node) && !(ast.IsCallExpression(node) && isTrustedEmptyCall(c, node)) && !defaultForeignIntrinsicMatcher(c, node) && !defaultForeignBindingTagged(c, node, map[*ast.Symbol]bool{}) {
			target := c.GetContextualType(node, checker.ContextFlagsNone)
			forwarded := defaultForeignForwardedTarget(c, node)
			if forwarded != nil {
				target = forwarded
			}
			if target == nil {
				return node.ForEachChild(visit)
			}
			source := c.GetTypeAtLocation(node)
			owners := defaultForeignValueOwners(c, node)
			if defaultForeignCallbackCandidate(c, source, owners, node) &&
				!admittedByShippedContract(c, node) && !defaultForeignComputedWrapper(c, node) &&
				!defaultForeignCallbackFitsOwn(c, source, target, owners, append([]*checker.Type{target}, owners...), !defaultForeignTrustedImpl(c, node) && forwarded == nil) {
				d := report(c, node, EK0402)
				note(d, "An unannotated foreign function has thrown type unknown; this callback type does not admit it.")
				note(d, "Handle its throw in a callback, or use a foreign signature with an admitted written @throws contract.")
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkDefaultForeignCallbackClass(c *checker.Checker, class *ast.Node) {
	heritage := ast.GetImplementsHeritageClauseElements(class)
	if len(heritage) == 0 && ast.GetClassExtendsHeritageElement(class) == nil {
		return
	}
	symbol := c.GetSymbolOfDeclaration(class)
	if symbol == nil {
		return
	}
	instance := c.GetDeclaredTypeOfSymbol(symbol)
	reported := map[string]bool{}
	for _, element := range heritage {
		implemented := implementedType(c, class, element)
		if implemented == nil || implemented.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsUnion|checker.TypeFlagsTypeVariable) != 0 {
			continue
		}
		for _, required := range c.GetPropertiesOfType(implemented) {
			name := required.Name()
			if reported[name] {
				continue
			}
			actual := c.GetPropertyOfType(instance, name)
			if actual == nil {
				continue
			}
			source, target := c.GetTypeOfSymbol(actual), c.GetTypeOfSymbol(required)
			declaration := actual.ValueDeclaration()
			if !defaultForeignClassMember(c, source, instance, declaration) || defaultForeignCallbackFits(c, source, target, []*checker.Type{instance}, []*checker.Type{implemented}) {
				continue
			}
			at := element
			if decl := actual.ValueDeclaration(); decl != nil && decl.Parent == class && decl.Name() != nil {
				at = decl.Name()
			}
			display := name
			if decl := required.ValueDeclaration(); decl != nil && decl.Name() != nil {
				display = scanner.GetTextOfNode(decl.Name())
			}
			d := report(c, at, EK0402)
			note(d, "The implemented member {0}.{1} does not admit this member's callable throws.", scanner.GetTextOfNode(element), display)
			note(d, "Use a member that catches its throw, or an interface signature that admits it.")
			reported[name] = true
		}
	}
	overrides := map[*ast.Symbol]bool{}
	forEachClassOverride(c, class, instance, func(actual, overridden *ast.Symbol, owner, base *checker.Type) {
		source := c.GetTypeOfSymbol(actual)
		if overrides[actual] || reported[actual.Name()] && owner == instance || !defaultForeignClassMember(c, source, owner, actual.ValueDeclaration()) ||
			defaultForeignCallbackFits(c, source, c.GetTypeOfSymbol(overridden), []*checker.Type{owner}, []*checker.Type{base}) {
			return
		}
		reportClassOverride(c, class, actual, overridden)
		overrides[actual] = true
	})
}

// defaultForeignClassMember reports whether a class member's value is an
// unannotated foreign callable this check owns: not a getter, and not a field
// initialized from a binding with a written contract.
func defaultForeignClassMember(c *checker.Checker, source, instance *checker.Type, declaration *ast.Node) bool {
	if declaration != nil && declaration.Kind == ast.KindGetAccessor {
		return false
	}
	if declaration != nil && ast.IsPropertyDeclaration(declaration) && declaration.Initializer() != nil && defaultForeignBindingTagged(c, declaration.Initializer(), map[*ast.Symbol]bool{}) {
		return false
	}
	return defaultForeignCallbackCandidate(c, source, []*checker.Type{instance}, declaration)
}

// Every source union alternative must fit one native-compatible destination.
// Every required overload must have a native-compatible admitted source
// signature. Written tags are metadata; they do not replace native inference.
func defaultForeignCallbackFits(c *checker.Checker, source, target *checker.Type, sourceOwners, targetOwners []*checker.Type) bool {
	return defaultForeignCallbackFitsOwn(c, source, target, sourceOwners, targetOwners, true)
}

// defaultForeignCallbackFitsOwn admits a target signature that is the
// source's own declaration when own is set.
func defaultForeignCallbackFitsOwn(c *checker.Checker, source, target *checker.Type, sourceOwners, targetOwners []*checker.Type, own bool) bool {
	if source == nil || target == nil || !c.IsTypeAssignableTo(source, target) {
		return true
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if !defaultForeignCallbackFitsOwn(c, part, target, sourceOwners, targetOwners, own) {
				return false
			}
		}
		return true
	}
	provided := c.GetSignaturesOfType(source, checker.SignatureKindCall)
	if len(provided) == 0 {
		return true
	}
	alternatives := []*checker.Type{target}
	if target.Flags()&checker.TypeFlagsUnion != 0 {
		alternatives = target.Types()
	}
	for _, alternative := range alternatives {
		if !c.IsTypeAssignableTo(source, alternative) {
			continue
		}
		fits := true
		requiredSignatures := c.GetSignaturesOfType(alternative, checker.SignatureKindCall)
		overloaded := len(provided) > 1 || len(requiredSignatures) > 1
		for _, required := range requiredSignatures {
			bound, _ := defaultForeignCallbackContract(c, required, append(append([]*checker.Type{}, targetOwners...), alternative), false)
			matched := false
			for _, given := range provided {
				if !callbackSignatureRelated(c, given, required, overloaded) {
					continue
				}
				if own && sameRootSignatureDeclaration(given, required) {
					// typeof f, or a type parameter inferred from the argument,
					// names the source's own signature, so it carries the same
					// thrown type: unknown for an untagged foreign declaration.
					matched = true
					break
				}
				contract, known := defaultForeignCallbackContract(c, given, append(append([]*checker.Type{}, sourceOwners...), source), true)
				if !known || bound.admits(c, contract) {
					matched = true
					break
				}
			}
			if !matched {
				fits = false
				break
			}
		}
		if fits {
			return true
		}
	}
	return false
}

// The runtime's listed trusted(impl, [Errors]) wrapper requires impl's written
// contract: its generic impl parameter is impl's own type, which would
// otherwise admit an untagged foreign function. The retired empty
// trusted(impl, []) checks impl at its own type; EK0407 owns its retirement.
func defaultForeignTrustedImpl(c *checker.Checker, node *ast.Node) bool {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	return call != nil && ast.IsCallExpression(call) && len(call.Arguments()) > 0 && call.Arguments()[0] == node && runtimeExportOf(c, call.Expression()) == "trusted" && !isTrustedEmptyCall(c, call)
}

// A variadic forwarding call checks each supplied value against the
// corresponding parameter of its callback. Preserve that written destination
// instead of mistaking the inferred rest tuple for the value's own signature.
func defaultForeignForwardedTarget(c *checker.Checker, node *ast.Node) *checker.Type {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	if call == nil || !ast.IsCallExpression(call) && !ast.IsNewExpression(call) {
		return nil
	}
	index := -1
	for i, arg := range call.Arguments() {
		if arg == node {
			index = i
		}
	}
	signature := c.GetResolvedSignature(call)
	if index < 0 || signature == nil {
		return nil
	}
	for signature.Target() != nil {
		signature = signature.Target()
	}
	declaration := signature.Declaration()
	if declaration == nil || !ast.IsFunctionLike(declaration) {
		return nil
	}
	parameters := declaration.Parameters()
	if len(parameters) < 2 || len(declaration.TypeParameters()) == 0 {
		return nil
	}
	restIndex := len(parameters) - 1
	rest := parameters[restIndex]
	if index < restIndex || rest.AsParameterDeclaration().DotDotDotToken == nil || rest.Type() == nil {
		return nil
	}
	for _, parameter := range declaration.TypeParameters() {
		name := parameter.Name().Text()
		if !ast.IsTypeReferenceNode(rest.Type()) || !ast.IsIdentifier(rest.Type().AsTypeReferenceNode().TypeName) || rest.Type().AsTypeReferenceNode().TypeName.Text() != name {
			continue
		}
		for i, receiver := range parameters[:restIndex] {
			if receiver.Type() == nil || !mentionsName(receiver.Type(), name) || i >= len(call.Arguments()) {
				continue
			}
			written := c.GetSignaturesOfType(c.GetTypeFromTypeNode(receiver.Type()), checker.SignatureKindCall)
			if len(written) != 1 {
				continue
			}
			receiverDecl := written[0].Declaration()
			if receiverDecl == nil || !ast.IsFunctionLike(receiverDecl) {
				continue
			}
			slots := receiverDecl.Parameters()
			if len(slots) != 1 || slots[0].AsParameterDeclaration().DotDotDotToken == nil || slots[0].Type() == nil || !mentionsName(slots[0].Type(), name) {
				continue
			}
			actual := c.GetSignaturesOfType(c.GetTypeAtLocation(call.Arguments()[i]), checker.SignatureKindCall)
			if len(actual) == 1 {
				return c.GetTypeAtPosition(actual[0], index-restIndex)
			}
		}
	}
	return nil
}

// sameRootSignatureDeclaration reports whether two signatures instantiate one
// declaration.
func sameRootSignatureDeclaration(a, b *checker.Signature) bool {
	for a.Target() != nil {
		a = a.Target()
	}
	for b.Target() != nil {
		b = b.Target()
	}
	return a.Declaration() != nil && a.Declaration() == b.Declaration()
}

// Preserve substitutions from inherited generic owners whose parameters occur
// only in metadata and therefore disappear from the native callable structure.
func defaultForeignCallbackOwners(c *checker.Checker, roots []*checker.Type) []*checker.Type {
	var owners []*checker.Type
	seen := map[*checker.Type]bool{}
	var visit func(*checker.Type)
	visit = func(owner *checker.Type) {
		if owner == nil || seen[owner] {
			return
		}
		seen[owner] = true
		owners = append(owners, owner)
		if owner.Flags()&checker.TypeFlagsObject == 0 {
			return
		}
		target := owner
		if owner.ObjectFlags()&checker.ObjectFlagsReference != 0 {
			target = owner.Target()
		}
		if target.ObjectFlags()&checker.ObjectFlagsClassOrInterface == 0 {
			return
		}
		for _, base := range c.GetBaseTypes(target) {
			visit(c.InstantiateWrittenSignatureType(nil, base, []*checker.Type{owner}))
		}
	}
	for _, root := range roots {
		visit(root)
	}
	return owners
}

// The existing signature/owner substitution maps also cover type parameters
// used only in JSDoc, which TypeScript may prune from the callable structure.
// A factory's annotation belongs to its signature, not to the callable
// returned by that signature (chapter 003). Keep binding/property hosts,
// but stop before an enclosing function- or signature-like node.
func defaultForeignSignatureHosts(decl *ast.Node) []*ast.Node {
	hosts := jsdocHosts(decl)
	for i, host := range hosts {
		if i != 0 && ast.IsFunctionLike(host) {
			return hosts[:i]
		}
	}
	return hosts
}

// A type alias name's tags never annotate the signature inside it.
func defaultForeignCallbackContract(c *checker.Checker, signature *checker.Signature, owners []*checker.Type, foreignOnly bool) (throwContract, bool) {
	original := signature
	for original.Target() != nil {
		original = original.Target()
	}
	decl := original.Declaration()
	if decl == nil {
		return throwContract{}, false
	}
	owners = defaultForeignCallbackOwners(c, owners)
	if isEffectfulType(c, defaultForeignSignatureReturn(c, signature, owners)) {
		return throwContract{tagged: true}, true
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil {
		return throwContract{}, false
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
		if _, present := globalThrowsTable[key]; !present {
			return throwContract{}, false
		}
		names, known := globalThrowsOf(key)
		contract := throwContract{tagged: true, unknown: !known}
		for _, name := range names {
			value, ok := classFailure(c, name, c.GetGlobalSymbol(name, ast.SymbolFlagsValue, nil))
			if !ok {
				contract.unknown = true
			} else {
				contract.types = append(contract.types, value.t)
			}
		}
		return contract, true
	}
	if foreignOnly && isVibeLangFile(file) {
		foreign := false
		for n := decl; n != nil; n = n.Parent {
			if isTypeScriptModule(n) {
				foreign = true
				break
			}
		}
		if !foreign {
			return throwContract{}, false
		}
	}
	var contract throwContract
	for _, host := range defaultForeignSignatureHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			continue
		}
		for _, doc := range host.JSDoc(nil) {
			for _, tag := range jsdocTags(doc) {
				if !ast.IsJSDocThrowsTag(tag) || tag.AsJSDocThrowsTag().TypeExpression == nil {
					continue
				}
				contract.tagged = true
				node := tag.AsJSDocThrowsTag().TypeExpression.AsJSDocTypeExpression().Type
				if node == nil {
					contract.unknown = true
					continue
				}
				t := c.InstantiateWrittenSignatureType(signature, c.GetTypeFromTypeNode(node), owners)
				switch {
				case t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 && t != c.GetAnyType():
					contract.unknown = true
				case t.Flags()&checker.TypeFlagsNever != 0:
				default:
					contract.types = append(contract.types, t)
				}
			}
		}
	}
	if foreignOnly && !contract.tagged {
		return throwContract{tagged: true, unknown: true}, true
	}
	return contract, contract.tagged
}

// Retained foreign callable variables keep their declaration provenance.
// Accessor provenance remains a separate contract-flow task.
func defaultForeignCallbackCandidate(c *checker.Checker, t *checker.Type, owners []*checker.Type, origin *ast.Node) bool {
	if t == nil {
		return false
	}
	found := false
	owners = defaultForeignCallbackOwners(c, owners)
	for _, part := range t.Distributed() {
		for _, sig := range c.GetSignaturesOfType(part, checker.SignatureKindCall) {
			root := sig
			for root.Target() != nil {
				root = root.Target()
			}
			decl := root.Declaration()
			if decl == nil {
				return false
			}
			file := ast.GetSourceFileOfNode(decl)
			if file == nil || isLibFile(c, file) {
				return false
			}
			foreign := !isVibeLangFile(file)
			for n := decl; !foreign && n != nil; n = n.Parent {
				foreign = isTypeScriptModule(n)
			}
			if !foreign {
				continue
			}
			if isEffectfulType(c, defaultForeignSignatureReturn(c, sig, append(owners, part))) {
				continue
			}
			switch decl.Kind {
			case ast.KindFunctionDeclaration, ast.KindMethodDeclaration, ast.KindMethodSignature, ast.KindArrowFunction, ast.KindFunctionExpression:
			case ast.KindFunctionType, ast.KindCallSignature:
				// Reverted 2026-11-04 (platform option (a)): foreign callable
				// values and factory results typed by a function type are not
				// candidates until Will rules on Effect values such as
				// Order.Number and Schema.brand(...) passed as callbacks.
				return false
			default:
				return false
			}
			for _, host := range defaultForeignSignatureHosts(decl) {
				if !ast.IsTypeAliasDeclaration(host) && hasThrowsTag(host) {
					return false
				}
			}
			found = true
		}
	}
	return found
}
func defaultForeignSignatureReturn(c *checker.Checker, sig *checker.Signature, owners []*checker.Type) *checker.Type {
	root := sig
	for root.Target() != nil {
		root = root.Target()
	}
	if len(root.TypeParameters()) == 0 {
		return c.GetReturnTypeOfSignature(sig)
	}
	return c.SignatureReturnBeforeOwnTypeArguments(sig, owners)
}
func defaultForeignValueContext(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindNonNullExpression, ast.KindCallExpression, ast.KindNewExpression, ast.KindTaggedTemplateExpression, ast.KindExpressionWithTypeArguments:
		return isContextualValue(node)
	}
	return false
}

// Intrinsic matcher names are pattern syntax, not foreign callback values
// (chapter 004). Exempt only the matcher slot of a parser-written pattern
// helper. User expressions in subjects, arms and guards still get checked.
func defaultForeignIntrinsicMatcher(c *checker.Checker, node *ast.Node) bool {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	if !(isPatternCall(call, "$is") || isPatternCall(call, "$extract")) || call.Arguments()[0] != node {
		return false
	}
	_, builtin := builtinMatcherOf(c, ast.SkipParentheses(node))
	return builtin
}

func defaultForeignValueOwners(c *checker.Checker, node *ast.Node) []*checker.Type {
	owners := []*checker.Type{c.GetTypeAtLocation(node)}
	if ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node) {
		owners = append(owners, c.GetTypeAtLocation(node.Expression()))
	}
	if p := node.Parent; p != nil && ast.IsPropertyAssignment(p) && p.Parent != nil && ast.IsObjectLiteralExpression(p.Parent) {
		if t := c.GetContextualType(p.Parent, checker.ContextFlagsNone); t != nil {
			owners = append(owners, t)
		}
	}
	return defaultForeignCallbackOwners(c, owners)
}

// A written annotation on a binding is outside the unannotated slice.
// Preserve it through ordinary aliases without looking through assertions.
func defaultForeignBindingTagged(c *checker.Checker, node *ast.Node, seen map[*ast.Symbol]bool) bool {
	node = ast.SkipParentheses(node)
	if node == nil || !(ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node)) {
		return false
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	if seen[symbol] {
		return false
	}
	seen[symbol] = true
	for _, decl := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(decl)
		if file != nil && !isVibeLangFile(file) {
			for _, host := range jsdocHosts(decl) {
				if !ast.IsTypeAliasDeclaration(host) && hasThrowsTag(host) {
					return true
				}
			}
		}
		if ast.IsVariableDeclaration(decl) && decl.Type() == nil && decl.Initializer() != nil && defaultForeignBindingTagged(c, decl.Initializer(), seen) {
			return true
		}
	}
	return false
}
func defaultForeignComputedWrapper(c *checker.Checker, node *ast.Node) bool {
	p := node.Parent
	if p == nil || !ast.IsPropertyAssignment(p) || p.Parent == nil || !ast.IsObjectLiteralExpression(p.Parent) {
		return false
	}
	name := p.Name()
	if name == nil || !ast.IsComputedPropertyName(name) {
		return false
	}
	key, ok := keyDomainSingleString(c, c.GetTypeAtLocation(name.Expression()), 0)
	if !ok || key != "try" {
		return false
	}
	call := p.Parent.Parent
	return call != nil && ast.IsCallExpression(call) && isExportOf(c, call, "effect", "Effect", []string{"try_", "try", "tryPromise"})
}
