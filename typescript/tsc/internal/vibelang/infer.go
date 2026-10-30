package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// inferredReturnType gives a .vibe function that is an Effect, and has no
// return type annotation, the type Effect<A, E, R>. A is what TypeScript
// inferred from its return statements, where each call that runs already has
// its success type. E and R join the error and requirement channels of every
// Effect the body runs. Outside .vibe function bodies, for example at the
// module top level or in TypeScript and .d.ts files, a call to the function
// is therefore an Effect value.
func inferredReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !isLowerable(fn) || isLambda(fn) {
		return t // a lambda's type depends on its form (forms.go)
	}
	if isProducer(fn) {
		return producerType(c, fn, t)
	}
	a := analyzerFor(c)
	// A function that compiles to plain JavaScript through a $direct variant
	// is still an Effect to TypeScript (Chapter 15); other plain functions,
	// such as one with a plain return annotation, keep their type.
	if !a.isSplittable(fn) && !a.isEffect(fn) {
		return t
	}
	if effect := a.effectTypeOf(fn, t); effect != nil {
		return effect
	}
	return t
}

// effectInfo lists what running a function's body adds to the error and
// requirement channels of its Effect. Each channel is a type-identity set,
// ordered by first occurrence, with the first call or throw that adds it.
// The never type adds no entries. Maps only test membership: declarations
// and diagnostics always traverse the ordered slices.
type effectInfo struct {
	errorSet           map[*checker.Type]bool
	requirementSet     map[*checker.Type]bool
	errors             []*checker.Type
	requirements       []*checker.Type
	errorSources       []*ast.Node   // errorSources[i] adds errors[i]
	requirementSources []*ast.Node   // requirementSources[i] adds requirements[i]
	effect             *checker.Type // the generic Effect interface, from any Effect the body runs
}

func (info *effectInfo) addError(t *checker.Type, source *ast.Node) {
	if t == nil || t.Flags()&checker.TypeFlagsNever != 0 || info.errorSet[t] {
		return
	}
	if info.errorSet == nil {
		info.errorSet = make(map[*checker.Type]bool)
	}
	info.errorSet[t] = true
	info.errors = append(info.errors, t)
	info.errorSources = append(info.errorSources, source)
}

func (info *effectInfo) addRequirement(t *checker.Type, source *ast.Node) {
	if t == nil || t.Flags()&checker.TypeFlagsNever != 0 || info.requirementSet[t] {
		return
	}
	if info.requirementSet == nil {
		info.requirementSet = make(map[*checker.Type]bool)
	}
	info.requirementSet[t] = true
	info.requirements = append(info.requirements, t)
	info.requirementSources = append(info.requirementSources, source)
}

// add adds what other lists, keeping its sources.
func (info *effectInfo) add(other *effectInfo) {
	info.addErrors(other)
	info.addRequirements(other)
	if info.effect == nil {
		info.effect = other.effect
	}
}

// addErrors and addRequirements copy one channel without sharing mutable storage.
func (info *effectInfo) addErrors(other *effectInfo) {
	for i, t := range other.errors {
		info.addError(t, other.errorSources[i])
	}
}

func (info *effectInfo) addRequirements(other *effectInfo) {
	for i, t := range other.requirements {
		info.addRequirement(t, other.requirementSources[i])
	}
}

// addFrom adds what other lists, as added by source, such as a call to the
// function whose body other describes.
func (info *effectInfo) addFrom(other *effectInfo, source *ast.Node) {
	for _, t := range other.errors {
		info.addError(t, source)
	}
	for _, t := range other.requirements {
		info.addRequirement(t, source)
	}
	if info.effect == nil {
		info.effect = other.effect
	}
}

// effectOf returns fn's effectInfo, what can escape its body (flowOf). The
// functions fn calls are solved first, and the functions of a call cycle
// together (recursion.go); while fn's cycle is being solved, it returns what
// was found so far.
func (a *analyzer) effectOf(fn *ast.Node) *effectInfo {
	if info, ok := a.effects[fn]; ok {
		return info
	}
	if info, solving := a.approx[fn]; solving {
		return info
	}
	if a.connecting[fn] {
		// Discovering fn's callees asked the checker for a type that reads
		// fn's own E and R, as typing a call of fn passed by name in fn's
		// body does. Solving fn again here would never end; the read gets
		// empty channels, and checkRecursion asks for the written contract
		// that makes the read exact (EK9206).
		a.reentered[fn] = true
		return &effectInfo{}
	}
	a.solve(fn)
	return a.effects[fn]
}

// effectInterface returns the generic Effect interface, given an Effect t.
func effectInterface(c *checker.Checker, t *checker.Type) *checker.Type {
	if symbol := effectInterfaceSymbol(c, t); symbol != nil {
		return c.GetDeclaredTypeOfSymbol(symbol)
	}
	return nil
}

// effectInterfaceFor returns the generic Effect interface for the type of fn,
// whose body adds info: from an Effect the body runs, from the module that
// declares a thrown error's `~effect/Effect` property (a TaggedError's comes
// from YieldableError), from the Effect namespace in scope at fn, or from the
// file's imports of effect's modules.
func (a *analyzer) effectInterfaceFor(fn *ast.Node, info *effectInfo) *checker.Type {
	c := a.checker
	if info.effect != nil {
		return info.effect
	}
	for _, e := range info.errors {
		if property := c.GetPropertyOfType(e, effectTypeID); property != nil {
			if variance := c.GetTypeOfSymbol(property).Symbol(); variance != nil && variance.Parent() != nil {
				if t := effectInterfaceOfModule(c, variance.Parent()); t != nil {
					return t
				}
			}
		}
	}
	if namespace := c.ResolveName("Effect", fn, ast.SymbolFlagsNamespace, false /*excludeGlobals*/); namespace != nil {
		if t := effectInterfaceOfModule(c, namespace); t != nil {
			return t
		}
	}
	for _, statement := range ast.GetSourceFileOfNode(fn).Statements.Nodes {
		if statement.Kind != ast.KindImportDeclaration {
			continue
		}
		if module := c.ResolveExternalModuleName(statement.ModuleSpecifier(), nil /*importAttributesType*/); module != nil {
			if t := effectInterfaceOfModule(c, module); t != nil {
				return t
			}
		}
	}
	return nil
}

// effectInterfaceOfModule returns effect's Effect interface when module is
// effect's Effect module, or a module that exports it as the namespace
// Effect, as the package's index does.
func effectInterfaceOfModule(c *checker.Checker, module *ast.Symbol) *checker.Type {
	if module.Flags()&ast.SymbolFlagsAlias != 0 {
		module = c.GetAliasedSymbol(module)
	}
	for _, export := range c.GetExportsOfModule(module) {
		if export.Name() != "Effect" {
			continue
		}
		if export.Flags()&ast.SymbolFlagsInterface != 0 {
			if t := c.GetDeclaredTypeOfSymbol(export); effectInterfaceSymbol(c, t) == c.GetMergedSymbol(export) {
				return t
			}
		}
		if export.Flags()&ast.SymbolFlagsAlias != 0 {
			if namespace := c.GetAliasedSymbol(export); namespace != module && namespace.Flags()&ast.SymbolFlagsValueModule != 0 {
				return effectInterfaceOfModule(c, namespace)
			}
		}
	}
	return nil
}
