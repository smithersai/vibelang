package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterPropertyDeclarationTypeHook(serviceKeyDeclarationType) }

// A written service key selects the native Context.Service key type. Unlike
// an ordinary readonly property's initializer, that literal is not fresh:
// returning it retains its identity in both plain and effect functions.
func serviceKeyDeclarationType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	class := declaration.Parent
	if class == nil || declarationWord(class) != "service" || hasDefaultValue(class) {
		return nil
	}
	if key, member := writtenKey(class); member == declaration {
		return c.GetStringLiteralType(key)
	}
	return nil
}
