package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The EK0402 callback checks (class members, foreign defaults, overloads,
// callable unions, spreads and constructors) share one matching rule
// (chapter 003 Assignability): a provided callable fits a destination when,
// for one destination alternative TypeScript accepts it at, every required
// signature has a related provided signature whose thrown contract the
// required one admits. Each check supplies how it relates signatures and
// how it reads the two contracts.

// callbackFit configures callbackFit.fits for one check.
type callbackFit struct {
	kind checker.SignatureKind
	// plain relates signatures by assignability only, never with type
	// parameters erased (constructor values).
	plain bool
	// own lets a required signature instantiated from a provided one's own
	// declaration fit: it names that declaration, so it carries the same
	// thrown contract.
	own bool
	// provided returns the contract of provided signature i. A false
	// result marks it unknown to this check, which then matches it.
	provided func(i int, given *checker.Signature) (throwContract, bool)
	// required returns the bound of need, a signature of alternative. A
	// false result admits every related provided signature.
	required func(alternative *checker.Type, need *checker.Signature) (throwContract, bool)
}

// fits reports whether source, with signatures provided, fits one of
// alternatives, whether TypeScript accepts source at any of them, and the
// provided contracts that some required bound rejected.
func (f callbackFit) fits(c *checker.Checker, source *checker.Type, provided []*checker.Signature, alternatives []*checker.Type) (fits, native bool, rejected throwContract) {
	for _, alternative := range alternatives {
		if !c.IsTypeAssignableTo(source, alternative) {
			continue // TypeScript reports the ordinary type mismatch.
		}
		native = true
		required := c.GetSignaturesOfType(alternative, f.kind)
		overloaded := !f.plain && (len(provided) > 1 || len(required) > 1)
		all := true
		for _, need := range required {
			bound, bounded := f.required(alternative, need)
			matched := false
			for i, given := range provided {
				if !callbackSignatureRelated(c, given, need, overloaded) {
					continue
				}
				if !bounded || f.own && sameRootSignatureDeclaration(given, need) {
					matched = true
					break
				}
				contract, known := f.provided(i, given)
				if !known || bound.admits(c, contract) {
					matched = true
					break
				}
				rejected.unknown = rejected.unknown || contract.unknown
				rejected.types = append(rejected.types, contract.types...)
			}
			if !matched {
				all = false
				break
			}
		}
		if all {
			return true, true, rejected
		}
	}
	return false, native, rejected
}

// alternativesOf returns the members of t, or t itself when it is no union.
func alternativesOf(t *checker.Type) []*checker.Type {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		return t.Types()
	}
	return []*checker.Type{t}
}

// writtenBound reads need's written @throws tags; a signature without a
// declaration has none.
func writtenBound(c *checker.Checker) func(*checker.Type, *checker.Signature) (throwContract, bool) {
	return func(_ *checker.Type, need *checker.Signature) (throwContract, bool) {
		if decl := need.Declaration(); decl != nil {
			return writtenThrows(c, decl), true
		}
		return throwContract{}, true
	}
}

// callbackSignatureRelated pairs a provided signature with a required one as
// TypeScript relates signature lists (checker signaturesRelatedTo): a lone
// pair compares with the source instantiated in the target's context, and an
// overloaded side compares with type parameters erased. A member TypeScript
// accepts through an erased overload is then checked against that overload's
// contract instead of matching nothing.
func callbackSignatureRelated(c *checker.Checker, given, required *checker.Signature, overloaded bool) bool {
	if overloaded {
		return c.IsOverloadSignatureAssignableTo(given, required)
	}
	return c.IsTypeAssignableTo(c.NewFunctionType(nil, []*checker.Signature{given}), c.NewFunctionType(nil, []*checker.Signature{required}))
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

// foreignSignatureThrows returns the written contract of a foreign
// signature, leaving untagged defaults to the ordinary foreign-call rule.
// VibeLang callables and Effect-returning signatures intrinsically throw
// never and are classified before generic instantiation.
func foreignSignatureThrows(c *checker.Checker, signature *checker.Signature) throwContract {
	for signature.Target() != nil {
		signature = signature.Target()
	}
	decl := signature.Declaration()
	if decl == nil {
		return throwContract{}
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || isVibeLangFile(file) || isLibFile(c, file) ||
		isEffectfulType(c, c.GetReturnTypeOfSignature(signature)) {
		return throwContract{}
	}
	for _, host := range jsdocHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			return throwContract{}
		}
	}
	return writtenSourceSignatureThrows(c, decl)
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

// callbackContract reads the thrown contract of signature for the class
// member and foreign-default checks. The owner substitution maps also cover
// type parameters used only in JSDoc, which TypeScript may prune from the
// callable structure. A type alias name's tags never annotate the signature
// inside it. foreignOnly reads a provided signature: one declared in VibeLang
// outside a TypeScript module is unknown to the check. defaults selects the
// foreign-default rules: a factory's tags stay off the callable it returns
// (defaultForeignSignatureHosts), and an untagged foreign provided signature
// throws unknown.
func callbackContract(c *checker.Checker, signature *checker.Signature, owners []*checker.Type, foreignOnly, defaults bool) (throwContract, bool) {
	original := signature
	for original.Target() != nil {
		original = original.Target()
	}
	decl := original.Declaration()
	if decl == nil {
		return throwContract{}, false
	}
	owners = defaultForeignCallbackOwners(c, owners)
	returned := c.SignatureReturnBeforeOwnTypeArguments(signature, owners)
	if defaults {
		returned = defaultForeignSignatureReturn(c, signature, owners)
	}
	if isEffectfulType(c, returned) {
		return throwContract{tagged: true}, true
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil {
		return throwContract{}, false
	}
	if isLibFile(c, file) {
		return libCallbackContract(c, decl)
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
	var hosts []*ast.Node
	switch {
	case defaults:
		hosts = defaultForeignSignatureHosts(decl)
	case foreignOnly:
		hosts = sourceSignatureHosts(decl)
	default:
		hosts = jsdocHosts(decl)
	}
	var contract throwContract
	for _, host := range hosts {
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
	if defaults && foreignOnly && !contract.tagged {
		return throwContract{tagged: true, unknown: true}, true
	}
	return contract, contract.tagged
}

// libCallbackContract reads a library declaration's contract from the
// shipped global throws table; a declaration the table omits is unknown to
// the check.
func libCallbackContract(c *checker.Checker, decl *ast.Node) (throwContract, bool) {
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

// ownedCallbackFits reports whether source fits target for the class member
// (defaults false) and foreign-default (defaults true) checks. Every source
// union alternative must fit one native-compatible destination, and every
// required overload must have a native-compatible admitted source signature.
// Written tags are metadata; they do not replace native inference. own is
// callbackFit.own.
func ownedCallbackFits(c *checker.Checker, source, target *checker.Type, sourceOwners, targetOwners []*checker.Type, defaults, own bool) bool {
	if source == nil || target == nil || !c.IsTypeAssignableTo(source, target) {
		return true
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if !ownedCallbackFits(c, part, target, sourceOwners, targetOwners, defaults, own) {
				return false
			}
		}
		return true
	}
	provided := c.GetSignaturesOfType(source, checker.SignatureKindCall)
	if len(provided) == 0 {
		return true
	}
	fit := callbackFit{
		kind: checker.SignatureKindCall,
		own:  own,
		provided: func(_ int, given *checker.Signature) (throwContract, bool) {
			return callbackContract(c, given, append(append([]*checker.Type{}, sourceOwners...), source), true, defaults)
		},
		required: func(alternative *checker.Type, need *checker.Signature) (throwContract, bool) {
			bound, _ := callbackContract(c, need, append(append([]*checker.Type{}, targetOwners...), alternative), false, defaults)
			return bound, true
		},
	}
	fits, _, _ := fit.fits(c, source, provided, alternativesOf(target))
	return fits
}
