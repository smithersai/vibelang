package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const retiredControlMessage = "Handlers are outside the first release."
const retiredSelectMessage = "select is outside the first release. Choose explicit Effect selection for the intended behavior."

// Recovery keeps the old source available to the CLI migration. Neither
// projection rendering may turn a rejected form into continuation code.
func retiredControlCode(n *ast.Node) int32 {
	switch {
	case ast.IsClassDeclaration(n) && isServiceKeywordClass(n) && isControlClass(n):
		return 3501
	case n.Kind == ast.KindTryStatement && n.Flags&ast.NodeFlagsVibeLang != 0:
		return 3501
	case n.Kind == ast.KindLabeledStatement && n.Flags&ast.NodeFlagsVibeLang != 0 && strings.HasPrefix(n.AsLabeledStatement().Label.Text(), "$select"):
		return 4607
	}
	return 0
}

func (p *projector) rejectRetiredControlSyntax(n *ast.Node) bool {
	code := retiredControlCode(n)
	if code == 0 {
		return false
	}
	message := retiredControlMessage
	if code == 4607 {
		message = retiredSelectMessage
	}
	p.syntaxToken(n, code, message)
	p.plan.replace(p.tokenStart(n), n.End(), "")
	return true
}

// A projector has no semantic checker. An unbound identifier must remain
// available to stock TypeScript's ambient/global resolution; never infer a
// continuation binding from its spelling or lift its callbacks by a table.
func retiredControlPreludeName(name string) bool {
	switch name {
	case "Control", "handle", "resume", "resumeWith", "abandon":
		return true
	}
	return false
}
