package checker

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// ClassBaseHook can choose the bases of class, a class's declared type. It
// returns the base constructor type, whose properties the class's static
// side inherits, and the base instance type, whose members the class's
// instances inherit, or nil and nil when it has nothing to say. A class whose
// bases a hook chooses ignores its own extends clause, if it has one, and
// keeps its own construct signatures, so the base constructor type must have
// none.
type ClassBaseHook func(c *Checker, class *Type) (constructorType *Type, instanceType *Type)

var classBaseHooks []ClassBaseHook

// RegisterClassBaseHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterClassBaseHook(hook ClassBaseHook) {
	classBaseHooks = append(classBaseHooks, hook)
}

func (c *Checker) classBasesFromHooks(class *Type) (constructorType *Type, instanceType *Type) {
	for _, hook := range classBaseHooks {
		if constructorType, instanceType = hook(c, class); constructorType != nil {
			return constructorType, instanceType
		}
	}
	return nil, nil
}

// CheckTypeAssignableTo reports TypeScript's assignability error at
// errorNode, headed by headMessage when it is not nil, when source is not
// assignable to target, and returns whether it is.
func (c *Checker) CheckTypeAssignableTo(source *Type, target *Type, errorNode *ast.Node, headMessage *diagnostics.Message) bool {
	return c.checkTypeAssignableTo(source, target, errorNode, headMessage)
}

// Program returns the program that c checks.
func (c *Checker) Program() Program {
	return c.program
}

// GetStringLiteralType returns the string literal type of value.
func (c *Checker) GetStringLiteralType(value string) *Type {
	return c.getStringLiteralType(value)
}

// NewOptionalReadonlyPropertyType returns the object type
// `{ readonly [name]?: t }`.
func (c *Checker) NewOptionalReadonlyPropertyType(name string, t *Type) *Type {
	property := c.newSymbolEx(ast.SymbolFlagsProperty|ast.SymbolFlagsOptional, name, ast.CheckFlagsReadonly)
	c.valueSymbolLinks.Get(property).resolvedType = t
	return c.newAnonymousType(nil, ast.SymbolTable{name: property}, nil, nil, nil)
}

// InitializerContextualTypeHook supplies an initializer's contextual type when
// its declaration has no written annotation. It returns nil for other declarations.
type InitializerContextualTypeHook func(c *Checker, declaration *ast.Node) *Type

var initializerContextualTypeHooks []InitializerContextualTypeHook

// RegisterInitializerContextualTypeHook registers an in-tree extension at init.
func RegisterInitializerContextualTypeHook(hook InitializerContextualTypeHook) {
	initializerContextualTypeHooks = append(initializerContextualTypeHooks, hook)
}

func (c *Checker) initializerContextualTypeFromHooks(declaration *ast.Node) *Type {
	for _, hook := range initializerContextualTypeHooks {
		if t := hook(c, declaration); t != nil {
			return t
		}
	}
	return nil
}

// CheckExpressionAssignableTo checks an implementation against a supplied
// shape, retaining TypeScript's member-level explanation of a mismatch.
func (c *Checker) CheckExpressionAssignableTo(node *ast.Node, target *Type) {
	c.checkTypeAssignableToAndOptionallyElaborate(c.checkExpressionCached(node), target, node, node, nil, nil)
}

// NewReadonlyPropertyType returns the object type `{ readonly [name]: t }`.
func (c *Checker) NewReadonlyPropertyType(name string, t *Type) *Type {
	property := c.newSymbolEx(ast.SymbolFlagsProperty, name, ast.CheckFlagsReadonly)
	c.valueSymbolLinks.Get(property).resolvedType = t
	return c.newAnonymousType(nil, ast.SymbolTable{name: property}, nil, nil, nil)
}

// NewAliasedObjectType returns an object type whose properties are members,
// symbols declared elsewhere, such as a class's instance members, and a type
// alias symbol named aliasName whose declared type it is. The alias has
// parent as its parent, so the type prints as Parent.AliasName, and it is
// declared nowhere: a hook resolves the name.
func (c *Checker) NewAliasedObjectType(members ast.SymbolTable, aliasName string, parent *ast.Symbol) (*Type, *ast.Symbol) {
	alias := c.newSymbol(ast.SymbolFlagsTypeAlias, aliasName)
	alias.SetParent(parent)
	t := c.newAnonymousType(nil, members, nil, nil, nil)
	t.alias = &TypeAlias{symbol: alias}
	c.typeAliasLinks.Get(alias).declaredType = t
	return t, alias
}

// NewObjectType returns an anonymous object type whose properties are
// members, symbols declared elsewhere, such as a class's instance members.
func (c *Checker) NewObjectType(members ast.SymbolTable) *Type {
	return c.newAnonymousType(nil, members, nil, nil, nil)
}

// MembersOfSymbol returns symbol's members, including the late-bound ones
// whose names are unique symbols, such as [Symbol.iterator].
func (c *Checker) MembersOfSymbol(symbol *ast.Symbol) ast.SymbolTable {
	return c.getMembersOfSymbol(symbol)
}

// NewTypeAliasSymbol returns a type alias symbol named name whose declared
// type is t and whose parent is parent. It is declared nowhere: a hook
// resolves the name.
func (c *Checker) NewTypeAliasSymbol(name string, parent *ast.Symbol, t *Type) *ast.Symbol {
	alias := c.newSymbol(ast.SymbolFlagsTypeAlias, name)
	alias.SetParent(parent)
	c.typeAliasLinks.Get(alias).declaredType = t
	return alias
}

// ResolveEntityName resolves name, an identifier, qualified name, or property
// access, with meaning, following aliases, without reporting an error. It
// returns nil when name resolves to nothing with that meaning.
func (c *Checker) ResolveEntityName(name *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	symbol := c.resolveEntityName(name, meaning, true /*ignoreErrors*/, false /*dontResolveAlias*/, nil /*location*/)
	if symbol == c.unknownSymbol {
		return nil
	}
	return symbol
}

// ImplementedTypeHook can replace t, the type that typeNode, an element of
// class's implements clause, names, with the type the class must be
// assignable to. It returns t when it has nothing to say.
type ImplementedTypeHook func(c *Checker, class *ast.Node, typeNode *ast.Node, t *Type) *Type

var implementedTypeHooks []ImplementedTypeHook

// RegisterImplementedTypeHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterImplementedTypeHook(hook ImplementedTypeHook) {
	implementedTypeHooks = append(implementedTypeHooks, hook)
}

func (c *Checker) implementedTypeFromHooks(class *ast.Node, typeNode *ast.Node, t *Type) *Type {
	for _, hook := range implementedTypeHooks {
		t = hook(c, class, typeNode, t)
	}
	return t
}

// QualifiedTypeNameHook can supply a symbol for name, a qualified name or
// property access in a type whose left side is left and whose right side is
// right, before the checker resolves left as a namespace. A class that is not
// a namespace can then have a member type, as a service's Shape is. It
// returns nil when it has nothing to supply, and it runs for every qualified
// name of a type, so it must be cheap.
type QualifiedTypeNameHook func(c *Checker, name *ast.Node, left *ast.Node, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol

var qualifiedTypeNameHooks []QualifiedTypeNameHook

// RegisterQualifiedTypeNameHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterQualifiedTypeNameHook(hook QualifiedTypeNameHook) {
	qualifiedTypeNameHooks = append(qualifiedTypeNameHooks, hook)
}

func (c *Checker) resolveQualifiedTypeNameFromHooks(name *ast.Node, left *ast.Node, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	for _, hook := range qualifiedTypeNameHooks {
		if symbol := hook(c, name, left, right, meaning); symbol != nil {
			return symbol
		}
	}
	return nil
}

// IsServiceBrandProperty reports whether p is the optional brand of a
// VibeLang control operation's interface, "~vibelang/service", which keeps two
// controls with the same members distinct. It takes part in typing, but it
// is not a member that source declares.
func IsServiceBrandProperty(p *ast.Symbol) bool {
	return p.Name() == "~vibelang/service"
}

// GetPropertyNameForKnownSymbolName returns the property name of the
// well-known symbol Symbol.<name>, such as hasInstance.
func (c *Checker) GetPropertyNameForKnownSymbolName(name string) string {
	return c.getPropertyNameForKnownSymbolName(name)
}

// PropertyNameOfType returns the property name that a value of t, a unique
// symbol or literal type, names in a computed property, and whether t can
// name a property.
func PropertyNameOfType(t *Type) (string, bool) {
	if t == nil || !isTypeUsableAsPropertyName(t) {
		return "", false
	}
	return getPropertyNameFromType(t), true
}
