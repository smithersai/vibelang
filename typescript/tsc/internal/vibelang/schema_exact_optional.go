package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

type schemaOptionalStateKey struct{}
type schemaOptionalState struct {
	files map[*ast.SourceFile]map[*ast.Node]*ast.Node
}

func init() { checker.RegisterCallExpressionTypeHook(schemaOptionalCallType) }

// A source file is shared by programs with different options. Select an
// immutable alternative in checker-local state; never rename the parsed AST.
func schemaOptionalReplacement(c *checker.Checker, node *ast.Node) *ast.Node {
	if !c.CompilerOptions().ExactOptionalPropertyTypes.IsTrue() ||
		!ast.IsCallExpression(node) || node.Expression().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	file := ast.GetSourceFileOfNode(node)
	if file == nil || len(file.VibeLangSchemaOptionals) == 0 {
		return nil
	}
	state := c.ExtensionState(schemaOptionalStateKey{}, func() any {
		return &schemaOptionalState{files: map[*ast.SourceFile]map[*ast.Node]*ast.Node{}}
	}).(*schemaOptionalState)
	refs, ok := state.files[file]
	if !ok {
		refs = map[*ast.Node]*ast.Node{}
		for _, ref := range file.VibeLangSchemaOptionals {
			if !ref.AllowsUndefined {
				refs[ref.Expression] = ref.Exact
			}
		}
		state.files[file] = refs
	}
	return refs[node]
}

func schemaOptionalCallType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if replacement := schemaOptionalReplacement(c, node); replacement != nil {
		return c.GetTypeAtLocation(replacement)
	}
	return t
}
