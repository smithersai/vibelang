package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Class member initializers do not receive their implements clause as a
// contextual type. Compare the retained callable contracts on the resolved
// instance members, including inherited members and getter results (VIP-4,
// chapter 003 Assignability). A member the class declares over a base class
// member is a class override, compared the same way. Native incompatibility
// remains TypeScript's.
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
	checkCallbackClass(c, class, nil, func(source, target *checker.Type, sourceOwners, targetOwners []*checker.Type) bool {
		return ownedCallbackFits(c, source, target, sourceOwners, targetOwners, false, false)
	})
}

// checkCallbackClass reports EK0402 on each member of class whose callable
// does not fit the member it implements or overrides. member, when set,
// selects the members a check owns, given the member's type, its owning type
// and its declaration.
func checkCallbackClass(c *checker.Checker, class *ast.Node, member func(source, owner *checker.Type, declaration *ast.Node) bool, fits func(source, target *checker.Type, sourceOwners, targetOwners []*checker.Type) bool) {
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
			if member != nil && !member(source, instance, actual.ValueDeclaration()) || fits(source, target, []*checker.Type{instance}, []*checker.Type{implemented}) {
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
		if overrides[actual] || reported[actual.Name()] && owner == instance || member != nil && !member(source, owner, actual.ValueDeclaration()) ||
			fits(source, c.GetTypeOfSymbol(overridden), []*checker.Type{owner}, []*checker.Type{base}) {
			return
		}
		reportClassOverride(c, class, actual, overridden)
		overrides[actual] = true
	})
}

// forEachClassOverride calls f for each member that class declares over a
// member of its base class, with the owning type of each side: the instance
// types for instance members, and the constructor types for static members,
// whose side TypeScript checks too. A member the class inherits unchanged
// keeps the base's own contract and is skipped.
func forEachClassOverride(c *checker.Checker, class *ast.Node, instance *checker.Type, f func(actual, overridden *ast.Symbol, owner, base *checker.Type)) {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil {
		return
	}
	visit := func(owner, base *checker.Type) {
		if owner == nil || base == nil || base.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsUnion|checker.TypeFlagsTypeVariable) != 0 {
			return
		}
		for _, overridden := range c.GetPropertiesOfType(base) {
			actual := c.GetPropertyOfType(owner, overridden.Name())
			if actual == nil {
				continue
			}
			if decl := actual.ValueDeclaration(); decl != nil && decl.Parent == class && decl.Name() != nil {
				f(actual, overridden, owner, base)
			}
		}
	}
	for _, base := range c.GetBaseTypes(instance) {
		visit(instance, base)
	}
	if symbol := c.GetSymbolOfDeclaration(class); symbol != nil {
		visit(c.GetTypeOfSymbol(symbol), c.GetTypeAtLocation(extends.Expression()))
	}
}

// reportClassOverride reports EK0402 at the overriding member's name.
func reportClassOverride(c *checker.Checker, class *ast.Node, actual, overridden *ast.Symbol) {
	display := overridden.Name()
	if decl := overridden.ValueDeclaration(); decl != nil && decl.Name() != nil {
		display = scanner.GetTextOfNode(decl.Name())
	}
	d := report(c, actual.ValueDeclaration().Name(), EK0402)
	note(d, "The overridden member {0}.{1} does not admit this member's callable throws.", scanner.GetTextOfNode(ast.GetClassExtendsHeritageElement(class).Expression()), display)
	note(d, "Use a member that catches its throw, or a base member type that admits it.")
}
