package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

type collisionModulesKey struct{}

// collisionModules maps each Effect.M written in a .vibe file, the property
// access in a value or the qualified name in a type, to the module it names.
func collisionModules(c *checker.Checker) map[*ast.Node]string {
	return c.ExtensionState(collisionModulesKey{}, func() any { return map[*ast.Node]string{} }).(map[*ast.Node]string)
}

func init() {
	checker.RegisterMissingPropertyHook(effectCollisionProperty)
	checker.RegisterQualifiedNameResolutionHook(effectCollisionNamespace)
}

// VIP-14 keeps ECMAScript and TypeScript globals and exposes colliding
// Effect modules through Effect.M. Resolve by binding so a local Effect
// object keeps its own meaning.
func effectCollisionProperty(c *checker.Checker, node *ast.Node, receiver *checker.Type, name string) *ast.Symbol {
	var left *ast.Node
	switch {
	case ast.IsPropertyAccessExpression(node):
		left = node.Expression()
	case ast.IsQualifiedName(node) && ast.IsPartOfTypeQuery(node):
		left = node.AsQualifiedName().Left // typeof Effect.M
	default:
		return nil
	}
	actual := c.GetSymbolAtLocation(left)
	if actual == nil {
		return nil
	}
	return effectCollisionModule(c, node, actual, name)
}

// effectCollisionBinding returns the symbol the written Effect of node, the
// leftmost name of a qualified name, is bound to: an import specifier when
// the file imports Effect, a local declaration when it declares one, and the
// module export when the implicit binding supplies it.
func effectCollisionBinding(c *checker.Checker, name *ast.Node) *ast.Symbol {
	for ast.IsQualifiedName(name) {
		name = name.AsQualifiedName().Left
	}
	if !ast.IsIdentifier(name) {
		return nil
	}
	return c.GetSymbolAtLocation(name)
}

// effectCollisionNamespace is Effect.M on the left of a type name, as in
// Effect.Array.NonEmptyReadonlyArray<number>, where namespace is the symbol
// Effect resolved to. typeof Effect.M checks its qualified name as a property
// access instead, which effectCollisionProperty answers.
func effectCollisionNamespace(c *checker.Checker, name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	if !ast.IsQualifiedName(name) || !ast.IsIdentifier(right) {
		return nil
	}
	if binding := effectCollisionBinding(c, name); binding != nil {
		namespace = binding // the written name, before the checker resolved its alias
	}
	return effectCollisionModule(c, name, namespace, right.Text())
}

// effectCollisionModule returns the module export that node, Effect.name in
// a .vibe file, names when actual is the in-scope Effect and name is a
// module that a JavaScript or TypeScript global hides, and records the
// module for node.
func effectCollisionModule(c *checker.Checker, node *ast.Node, actual *ast.Symbol, name string) *ast.Symbol {
	file := ast.GetSourceFileOfNode(node)
	root, ok := effectRootNames[name]
	if !ok || !root.namespace || !isVibeLangFile(file) ||
		!(isBuiltinGlobal(c, name) || name == "Record" || name == "Iterable") {
		return nil
	}
	state := preludeStateOf(c)
	effect := preludeSymbol(c, state, file, "Effect")
	if effect == nil || aliasTarget(c, actual) != aliasTarget(c, effect) {
		return nil
	}
	// Only the implicit binding exposes Effect.M. A written binding keeps its
	// ordinary TypeScript meaning (005, VIP-14): import { Effect } from
	// "effect" is the native module, whose Array is TS2339.
	for _, declaration := range actual.Declarations() {
		if declared := ast.GetSourceFileOfNode(declaration); declared != nil && !declared.IsDeclarationFile {
			return nil
		}
	}
	symbol := effectExportSymbol(c, state, file, name)
	if symbol != nil {
		collisionModules(c)[node] = root.module
	}
	return symbol
}

// effectCollisionTypes writes a type that names Effect.M, a module that a
// global of the same name hides (VIP-14), as an import type of the module,
// since the declaration file's Effect is effect's Effect module, which has
// no member M:
//
//	// main.vibe                                        // main.d.ts
//	export const xs: Effect.Array.NonEmptyReadonlyArray<number> = [1]
//	                                                    export declare const xs: import("effect/Array").NonEmptyReadonlyArray<number>;
type effectCollisionTypes struct {
	transformers.Transformer
	modules map[*ast.Node]string // the written Effect.M, by the module it names
}

func (tx *effectCollisionTypes) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	f := tx.Factory()
	switch {
	case ast.IsTypeReferenceNode(node):
		reference := node.AsTypeReferenceNode()
		module, qualifier := tx.split(reference.TypeName)
		if qualifier == nil {
			return node
		}
		argument := f.NewLiteralTypeNode(f.NewStringLiteral(module, ast.TokenFlagsNone))
		return f.NewImportTypeNode(false /*isTypeOf*/, argument, nil /*attributes*/, qualifier, reference.TypeArguments)
	case ast.IsTypeQueryNode(node):
		// typeof Effect.M is typeof import("effect/M"), and typeof Effect.M.x
		// is typeof import("effect/M").x.
		query := node.AsTypeQueryNode()
		module, qualifier := tx.split(query.ExprName)
		if module == "" {
			return node
		}
		argument := f.NewLiteralTypeNode(f.NewStringLiteral(module, ast.TokenFlagsNone))
		return f.NewImportTypeNode(true /*isTypeOf*/, argument, nil /*attributes*/, qualifier, query.TypeArguments)
	}
	return node
}

// split finds the Effect.M that name starts with, and returns the module it
// names and the rest of name, or nil when name is not Effect.M.T.
func (tx *effectCollisionTypes) split(name *ast.Node) (string, *ast.Node) {
	var rest []string // the names after Effect.M, last first
	for ast.IsQualifiedName(name) {
		if module := tx.modules[tx.EmitContext().MostOriginal(name)]; module != "" {
			f := tx.Factory()
			var qualifier *ast.Node
			for i := len(rest) - 1; i >= 0; i-- {
				if qualifier == nil {
					qualifier = f.NewIdentifier(rest[i])
				} else {
					qualifier = f.NewQualifiedName(qualifier, f.NewIdentifier(rest[i]))
				}
			}
			return module, qualifier
		}
		rest = append(rest, name.AsQualifiedName().Right.Text())
		name = name.AsQualifiedName().Left
	}
	return "", nil
}
