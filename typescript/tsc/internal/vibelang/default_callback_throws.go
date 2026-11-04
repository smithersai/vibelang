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
// accessor and returned-callable provenance are outside this slice.
func init() { fileChecks = append(fileChecks, checkDefaultForeignCallbacks) }

func checkDefaultForeignCallbacks(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if ast.IsClassLike(node) && classKindOf(node) == ordinaryClass {
			checkDefaultForeignCallbackClass(c, node)
		}
		if defaultForeignValueContext(node) && !defaultForeignIntrinsicMatcher(c, node) && !defaultForeignBindingTagged(c, node, map[*ast.Symbol]bool{}) {
			target := c.GetContextualType(node, checker.ContextFlagsNone)
			if target == nil {
				return node.ForEachChild(visit)
			}
			source := c.GetTypeAtLocation(node)
			owners := defaultForeignValueOwners(c, node)
			if defaultForeignCallbackCandidate(c, source, owners, node) &&
				!admittedByShippedContract(c, node) && !defaultForeignComputedWrapper(c, node) &&
				!defaultForeignCallbackFits(c, source, target, owners, append([]*checker.Type{target}, owners...)) {
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
	if len(heritage) == 0 {
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
			if declaration != nil && declaration.Kind == ast.KindGetAccessor {
				continue
			}
			if declaration != nil && ast.IsPropertyDeclaration(declaration) && declaration.Initializer() != nil && defaultForeignBindingTagged(c, declaration.Initializer(), map[*ast.Symbol]bool{}) {
				continue
			}
			if !defaultForeignCallbackCandidate(c, source, []*checker.Type{instance}, declaration) {
				continue
			}
			if defaultForeignCallbackFits(c, source, target, []*checker.Type{instance}, []*checker.Type{implemented}) {
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
}

// Every source union alternative must fit one native-compatible destination.
// Every required overload must have a native-compatible admitted source
// signature. Written tags are metadata; they do not replace native inference.
func defaultForeignCallbackFits(c *checker.Checker, source, target *checker.Type, sourceOwners, targetOwners []*checker.Type) bool {
	if source == nil || target == nil || !c.IsTypeAssignableTo(source, target) {
		return true
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if !defaultForeignCallbackFits(c, part, target, sourceOwners, targetOwners) {
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
		for _, required := range c.GetSignaturesOfType(alternative, checker.SignatureKindCall) {
			bound, _ := defaultForeignCallbackContract(c, required, append(append([]*checker.Type{}, targetOwners...), alternative), false)
			matched := false
			for _, given := range provided {
				from := c.NewFunctionType(nil, []*checker.Signature{given})
				to := c.NewFunctionType(nil, []*checker.Signature{required})
				if !c.IsTypeAssignableTo(from, to) {
					continue
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
	for _, host := range jsdocHosts(decl) {
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
				case t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0:
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
// Accessor and returned-callable provenance remain separate contract-flow tasks.
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
				if !defaultForeignValueDeclaredAbroad(c, origin, map[*ast.Symbol]bool{}) {
					return false
				}
			default:
				return false
			}
			for _, host := range jsdocHosts(decl) {
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
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindNonNullExpression, ast.KindCallExpression, ast.KindNewExpression, ast.KindTaggedTemplateExpression:
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

// Preserve the foreign declaration of a callable variable through untyped
// aliases and fields. A written Vibe binding type or assertion is a boundary;
// this check does not infer a callable contract from an implementation body.
func defaultForeignValueDeclaredAbroad(c *checker.Checker, node *ast.Node, seen map[*ast.Symbol]bool) bool {
	node = ast.SkipParentheses(node)
	if node == nil {
		return false
	}
	if node.Kind == ast.KindExpressionWithTypeArguments {
		return defaultForeignValueDeclaredAbroad(c, node.Expression(), seen)
	}
	if ast.IsPropertyDeclaration(node) || node.Kind == ast.KindPropertySignature {
		file := ast.GetSourceFileOfNode(node)
		foreign := file != nil && !isVibeLangFile(file)
		for n := node; !foreign && n != nil; n = n.Parent {
			foreign = isTypeScriptModule(n)
		}
		if foreign {
			return true
		}
		return ast.IsPropertyDeclaration(node) && node.Type() == nil && node.Initializer() != nil && defaultForeignValueDeclaredAbroad(c, node.Initializer(), seen)
	}
	if !(ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node)) {
		return false
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || seen[symbol] {
		return false
	}
	seen[symbol] = true
	for _, decl := range symbol.Declarations() {
		if decl.Kind == ast.KindGetAccessor || decl.Kind == ast.KindSetAccessor {
			continue
		}
		file := ast.GetSourceFileOfNode(decl)
		foreign := file != nil && !isVibeLangFile(file)
		for n := decl; !foreign && n != nil; n = n.Parent {
			foreign = isTypeScriptModule(n)
		}
		if foreign {
			return true
		}
		if (ast.IsVariableDeclaration(decl) || ast.IsPropertyDeclaration(decl)) && decl.Type() == nil && decl.Initializer() != nil && defaultForeignValueDeclaredAbroad(c, decl.Initializer(), seen) {
			return true
		}
	}
	return false
}
