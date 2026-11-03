package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() { ls.RegisterRenameEditHook(patternBindingRenameEdit) }

// Pattern shorthand denotes two names at one source span: a fixed key and
// a local binding. The parser marks the source binder before lowering it into a variable
// declaration, where TypeScript's destructuring rename cannot see the key.
func patternBindingRenameEdit(node *ast.Node, newName string) (core.TextRange, string, bool) {
	if node == nil || !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsVibeLangShorthandBinding == 0 {
		return core.TextRange{}, "", false
	}
	file := ast.GetSourceFileOfNode(node)
	if !isVibeLangFile(file) {
		return core.TextRange{}, "", false
	}
	start := nodeStart(file, node)
	keywordEnd := skipTriviaBackwards(file.Text(), start)
	keyword := keywordEnd - 3
	if keywordEnd >= 5 && file.Text()[keywordEnd-5:keywordEnd] == "const" {
		keyword = keywordEnd - 5
	}
	if keyword < 0 || (file.Text()[keyword:keywordEnd] != "let" && file.Text()[keyword:keywordEnd] != "const") {
		return core.TextRange{}, "", false
	}
	return core.NewTextRange(keyword, node.End()), node.Text() + ": " + file.Text()[keyword:start] + newName, true
}
