package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Class member initializers do not receive their implements clause as a
// contextual type. Compare the retained callable contracts on the resolved
// instance members, including inherited members and getter results (VIP-4,
// chapter 003 Assignability). Native incompatibility remains TypeScript's.
func init() { fileChecks = append(fileChecks, checkImplementedCallbackThrows) }

func checkImplementedCallbackThrows(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if ast.IsClassLike(node) && classKindOf(node) == ordinaryClass {
			checkImplementedCallbackClass(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkImplementedCallbackClass(c *checker.Checker, class *ast.Node) {
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
			if implementedCallbackFits(c, source, target, []*checker.Type{instance}, []*checker.Type{implemented}) {
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
func implementedCallbackFits(c *checker.Checker, source, target *checker.Type, sourceOwners, targetOwners []*checker.Type) bool {
	if source == nil || target == nil || !c.IsTypeAssignableTo(source, target) {
		return true
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if !implementedCallbackFits(c, part, target, sourceOwners, targetOwners) {
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
			bound, _ := implementedCallbackContract(c, required, append(append([]*checker.Type{}, targetOwners...), alternative), false)
			matched := false
			for _, given := range provided {
				from := c.NewFunctionType(nil, []*checker.Signature{given})
				to := c.NewFunctionType(nil, []*checker.Signature{required})
				if !c.IsTypeAssignableTo(from, to) {
					continue
				}
				contract, known := implementedCallbackContract(c, given, append(append([]*checker.Type{}, sourceOwners...), source), true)
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
func implementedCallbackOwners(c *checker.Checker, roots []*checker.Type) []*checker.Type {
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
func implementedCallbackContract(c *checker.Checker, signature *checker.Signature, owners []*checker.Type, foreignOnly bool) (throwContract, bool) {
	original := signature
	for original.Target() != nil {
		original = original.Target()
	}
	decl := original.Declaration()
	if decl == nil {
		return throwContract{}, false
	}
	owners = implementedCallbackOwners(c, owners)
	if isEffectfulType(c, c.SignatureReturnBeforeOwnTypeArguments(signature, owners)) {
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
				case t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 && t != c.GetAnyType():
					contract.unknown = true
				case t.Flags()&checker.TypeFlagsNever != 0:
				default:
					contract.types = append(contract.types, t)
				}
			}
		}
	}
	return contract, contract.tagged
}
