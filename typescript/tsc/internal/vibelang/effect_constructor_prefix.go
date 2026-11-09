package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Functions owns a forbidden effect accessor/constructor before the error-body
// categories. Match only the member's head: a nested diagnostic in its body or
// parameter initializer belongs to that nested member.
func restrictedEffectMember(member *ast.Node) bool {
	if member.Flags&ast.NodeFlagsReparsed != 0 || (member.Kind != ast.KindConstructor && member.Kind != ast.KindGetAccessor && member.Kind != ast.KindSetAccessor) {
		return false
	}
	parameters := member.FunctionLikeData().Parameters
	if parameters == nil {
		return false
	}
	start := member.Pos()
	if modifiers := member.Modifiers(); modifiers != nil {
		start = modifiers.End()
	}
	for _, d := range ast.GetSourceFileOfNode(member).Diagnostics() {
		if d.Source() == diagnosticSource && d.Code() == EK0104.Code && d.Pos() >= start && d.End() <= parameters.Pos() {
			return true
		}
	}
	return false
}
