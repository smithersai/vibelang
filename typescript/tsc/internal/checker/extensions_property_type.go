package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// PropertyDeclarationTypeHook supplies the type of an unannotated property
// declaration, or nil to keep TypeScript's initializer inference.
type PropertyDeclarationTypeHook func(c *Checker, declaration *ast.Node) *Type

var propertyDeclarationTypeHooks []PropertyDeclarationTypeHook

// RegisterPropertyDeclarationTypeHook registers an in-tree extension at init.
func RegisterPropertyDeclarationTypeHook(hook PropertyDeclarationTypeHook) {
	propertyDeclarationTypeHooks = append(propertyDeclarationTypeHooks, hook)
}

func (c *Checker) propertyDeclarationTypeFromHooks(declaration *ast.Node) *Type {
	for _, hook := range propertyDeclarationTypeHooks {
		if t := hook(c, declaration); t != nil {
			return t
		}
	}
	return nil
}
