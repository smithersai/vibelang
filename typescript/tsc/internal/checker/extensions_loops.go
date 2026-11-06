package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// IteratedElementTypeHook can give the type of the elements that node
// iterates, where node is a for...of statement or a yield* expression and
// iterated is the type of the value it iterates. An in-tree language
// extension uses it for a value that JavaScript cannot iterate but the
// extension can, such as an Effect Stream. It returns nil when it has nothing
// to say, and TypeScript then iterates iterated as usual.
type IteratedElementTypeHook func(c *Checker, node *ast.Node, iterated *Type) *Type

var iteratedElementTypeHooks []IteratedElementTypeHook

// RegisterIteratedElementTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterIteratedElementTypeHook(hook IteratedElementTypeHook) {
	iteratedElementTypeHooks = append(iteratedElementTypeHooks, hook)
}

func (c *Checker) iteratedElementTypeFromHooks(node *ast.Node, iterated *Type) *Type {
	for _, hook := range iteratedElementTypeHooks {
		if t := hook(c, node, iterated); t != nil {
			return t
		}
	}
	return nil
}

// isVibeLangConcurrentItemDeclaration recognizes the source head declared
// from a generated item parameter. It keeps native for-of underscore rules
// without exempting ordinary declarations in the written body.
func isVibeLangConcurrentItemDeclaration(node *ast.Node) bool {
	if node == nil || !ast.IsVariableDeclaration(node) {
		return false
	}
	value := node.Initializer()
	if value == nil || !ast.IsIdentifier(value) || value.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return false
	}
	fn := ast.FindAncestor(node, func(n *ast.Node) bool { return ast.IsArrowFunction(n) && n.Flags&ast.NodeFlagsVibeLang != 0 })
	if fn == nil || len(fn.Parameters()) != 1 {
		return false
	}
	parameter := fn.Parameters()[0].Name()
	call := fn.Parent
	if parameter == nil || !ast.IsIdentifier(parameter) || parameter.Flags&ast.NodeFlagsVibeLangTemporary == 0 || parameter.Text() != value.Text() || call == nil || !ast.IsCallExpression(call) {
		return false
	}
	callee := call.Expression()
	return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && callee.Text() == "$forConcurrent"
}
