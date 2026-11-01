package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Decided detail 183 (005 "Services", VIP-9): a service's resolved member
// contracts cannot capture a type parameter from an enclosing scope, even when
// the service declaration itself has no type parameter list: every
// specialization would share the service's one key. The check follows the
// resolved types (aliases, constraints, defaulted type arguments and the
// Effect contracts VibeLang writes), by type-parameter identity. A generic
// parameter of the member's own signature is allowed, and so is a concrete
// service inside a generic function.
var serviceOuterTypeDiagnostic = EK3005.With("{0} depends on {1}, a type parameter of an enclosing scope, so every {1} would share the service's one key; use a concrete type or a generic parameter of the member's own signature.")

// checkServiceOuterTypeParameters reports EK3005 at the first written member
// type of class that resolves through an outer type parameter, and returns
// whether it reported.
func checkServiceOuterTypeParameters(c *checker.Checker, class *ast.Node) bool {
	// With no enclosing generic declaration, no resolved member can capture
	// an enclosing type parameter. Do not expand library contracts at all.
	generic := false
	for owner := class.Parent; owner != nil; owner = owner.Parent {
		if (ast.IsFunctionLike(owner) || ast.IsClassLike(owner)) && len(owner.TypeParameters()) != 0 {
			generic = true
			break
		}
	}
	if !generic {
		return false
	}
	for _, member := range class.Members() {
		if ast.IsStatic(member) || member.Name() == nil {
			continue
		}
		var written []*ast.Node
		switch {
		case ast.IsPropertyDeclaration(member):
			written = append(written, member.Type())
		case ast.IsMethodDeclaration(member):
			written = append(written, member.Type())
			for _, parameter := range member.Parameters() {
				written = append(written, parameter.Type())
			}
			for _, parameter := range member.TypeParameters() {
				written = append(written, parameter.AsTypeParameterDeclaration().Constraint, parameter.AsTypeParameterDeclaration().DefaultType)
			}
		default:
			continue
		}
		written = append(written, serviceThrownTypeNodes(member)...)
		for _, node := range written {
			if node == nil {
				continue
			}
			walk := &outerTypeWalk{c: c, class: class, seen: map[outerTypeSeen]*checker.Type{}}
			if captured := walk.find(c.GetTypeFromTypeNode(node)); captured != nil {
				name := scanner.GetTextOfNode(member.Name())
				d := report(c, node, serviceOuterTypeDiagnostic, name, captured.Symbol().Name())
				note(d, "A service has one key for every instantiation of its enclosing scope; declare the service outside the generic scope, or give {0} its own generic signature whose contract does not use {1}.", name, captured.Symbol().Name())
				return true
			}
		}
	}
	return false
}

type outerTypeSeen struct {
	typeValue *checker.Type
	context   uint32
}

type outerTypeContext struct {
	parent uint32
	owner  *checker.Type
}

type outerTypeWalk struct {
	c                *checker.Checker
	class            *ast.Node
	seen             map[outerTypeSeen]*checker.Type
	objects          []*checker.Type
	context          uint32
	contexts         map[outerTypeContext]uint32
	activeReferences map[*checker.Type]bool
}

// find returns the first type parameter in t declared outside class, or nil.
// References check structurally witnessed type arguments, then resolved members
// for written throws metadata. Anonymous and mapped objects walk their members;
// a member-local type parameter contributes through its resolved bounds.
func (w *outerTypeWalk) find(t *checker.Type) (captured *checker.Type) {
	if t == nil {
		return nil
	}
	seen := outerTypeSeen{t, w.context}
	if result, visited := w.seen[seen]; visited {
		return result
	}
	w.seen[seen] = nil // in-progress recursion contributes no new dependency
	defer func() { w.seen[seen] = captured }()
	c := w.c
	switch {
	case t.Flags()&checker.TypeFlagsTypeParameter != 0:
		symbol := t.Symbol()
		if symbol == nil || len(symbol.Declarations()) == 0 {
			return nil
		}

		declaration := symbol.Declarations()[0]
		// A parameter binds this service only when its declaration's owner
		// encloses it. Generic call signatures reached through aliases have
		// their own parameters, just as a generic written member does.
		if !ast.IsNodeDescendantOf(declaration, w.class) && ast.IsNodeDescendantOf(w.class, declaration.Parent) {
			return t
		}
		if ast.IsTypeParameterDeclaration(declaration) {
			for _, bound := range []*checker.Type{c.GetConstraintOfTypeParameter(t), c.GetDefaultFromTypeParameter(t)} {
				if found := w.find(c.InstantiateWrittenSignatureType(nil, bound, w.objects)); found != nil {
					return found
				}
			}
		}
		return nil
	case t.Flags()&checker.TypeFlagsUnionOrIntersection != 0:
		for _, part := range t.Types() {
			if found := w.find(part); found != nil {
				return found
			}
		}

	case t.Flags()&checker.TypeFlagsTemplateLiteral != 0:
		for _, part := range t.AsTemplateLiteralType().Types() {
			if found := w.find(part); found != nil {
				return found
			}
		}
	case t.Flags()&checker.TypeFlagsStringMapping != 0:
		return w.find(t.AsStringMappingType().Target())
	case t.Flags()&checker.TypeFlagsSubstitution != 0:
		if found := w.find(t.AsSubstitutionType().BaseType()); found != nil {
			return found
		}
		return w.find(t.AsSubstitutionType().SubstConstraint())
	case t.Flags()&checker.TypeFlagsIndex != 0:
		return w.find(t.AsIndexType().Target())
	case t.Flags()&checker.TypeFlagsIndexedAccess != 0:
		if found := w.find(t.AsIndexedAccessType().ObjectType()); found != nil {
			return found
		}
		return w.find(t.AsIndexedAccessType().IndexType())
	case t.Flags()&checker.TypeFlagsConditional != 0:
		if found := w.find(t.AsConditionalType().CheckType()); found != nil {
			return found
		}
		if found := w.find(t.AsConditionalType().ExtendsType()); found != nil {
			return found
		}
		// A member-local check can hide an enclosing parameter in either
		// deferred branch. The base constraint may erase it to unknown.
		for _, branch := range []*checker.Type{c.GetTrueTypeOfConditionalType(t), c.GetFalseTypeOfConditionalType(t)} {
			if found := w.find(branch); found != nil {
				return found
			}
		}
		return w.find(c.GetBaseConstraintOfType(t))
	case t.Flags()&checker.TypeFlagsObject != 0:
		savedContext := w.context
		if t.Mapper() != nil || t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
			// Distinct instantiations can share a method type after native
			// mapper pruning. Memoize by the complete substitution context.
			repeated := false
			for _, owner := range w.objects {
				repeated = repeated || owner == t
			}
			if !repeated {
				if w.contexts == nil {
					w.contexts = map[outerTypeContext]uint32{}
				}
				context := outerTypeContext{w.context, t}
				if w.contexts[context] == 0 {
					w.contexts[context] = uint32(len(w.contexts) + 1)
				}
				w.context = w.contexts[context]
			}
		}
		w.objects = append(w.objects, t)
		defer func() {
			w.objects = w.objects[:len(w.objects)-1]
			w.context = savedContext
		}()
		if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
			mayCapture := false
			for index, argument := range c.GetTypeArguments(t) {
				if found := w.find(argument); found != nil {
					mayCapture = true
					if c.ReferenceTypeArgumentUsed(t, index) {
						return found
					}
				}
			}
			if !mayCapture {
				// A concrete reference's metadata cannot acquire a free
				// parameter absent from its arguments (outer arguments included).
				return nil
			}
			// Structurally unused arguments may still occur in written
			// callable throws metadata. Follow the resolved members below.
			// A recursive reference is the same contract; avoid expanding
			// non-regular phantom recursion such as Next<U[]> forever.
			target := t.Target()
			if w.activeReferences[target] {
				return nil
			}
			if w.activeReferences == nil {
				w.activeReferences = map[*checker.Type]bool{}
			}
			w.activeReferences[target] = true
			defer delete(w.activeReferences, target)
		}
		if t.ObjectFlags()&(checker.ObjectFlagsAnonymous|checker.ObjectFlagsMapped|checker.ObjectFlagsReference) == 0 {
			return nil
		}
		if t.ObjectFlags()&checker.ObjectFlagsMapped != 0 {
			mapped := t.AsMappedType()
			mapped.ResolveComponents(c, t)
			// An unresolved generic key set may expose no properties or
			// index signatures. Its key, remap and value contracts still
			// capture the outer parameter.
			for _, component := range []*checker.Type{mapped.ConstraintType(), mapped.NameType(), mapped.TemplateType()} {
				if found := w.find(component); found != nil {
					return found
				}
			}
		}
		for _, property := range c.GetPropertiesOfType(t) {
			if found := w.find(c.GetTypeOfSymbol(property)); found != nil {
				return found
			}
		}
		for _, kind := range []checker.SignatureKind{checker.SignatureKindCall, checker.SignatureKindConstruct} {
			for _, signature := range c.GetSignaturesOfType(t, kind) {
				for _, parameter := range signature.TypeParameters() {
					if found := w.find(parameter); found != nil {
						return found
					}
				}
				for _, node := range serviceThrownTypeNodes(signature.Declaration()) {
					declared := c.GetTypeFromTypeNode(node)
					if found := w.find(c.InstantiateWrittenSignatureType(signature, declared, w.objects)); found != nil {
						return found
					}
				}
				for _, parameter := range signature.Parameters() {
					if found := w.find(c.GetTypeOfSymbol(parameter)); found != nil {
						return found
					}
				}
				if found := w.find(c.GetReturnTypeOfSignature(signature)); found != nil {
					return found
				}
			}
		}
		for _, info := range c.GetIndexInfosOfType(t) {
			if found := w.find(info.ValueType()); found != nil {
				return found
			}
		}
	}
	return nil
}

// Read the existing written contract; this does not infer or change throws.
func serviceThrownTypeNodes(node *ast.Node) []*ast.Node {
	if node == nil {
		return nil
	}
	var types []*ast.Node
	for _, jsdoc := range node.JSDoc(nil) {
		for _, tag := range jsdocTags(jsdoc) {
			if ast.IsJSDocThrowsTag(tag) {
				expression := tag.AsJSDocThrowsTag().TypeExpression
				if expression != nil {
					types = append(types, expression.AsJSDocTypeExpression().Type)
				}
			}
		}
	}
	return types
}
