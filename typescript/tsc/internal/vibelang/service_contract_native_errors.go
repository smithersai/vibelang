package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A rejected contract header does not hide errors in its written types.
func coverServiceRejectedContractErrors(c *checker.Checker, member *ast.Node) {
	coverServiceRejectedMemberErrors(c, member)
	for _, modifier := range member.ModifierNodes() {
		// Native checking points private-name header errors at the modifier.
		coverExactErrorCodes(c, modifier, 18019)
		if modifier.Flags&ast.NodeFlagsReparsed == 0 {
			coverExactCodes(c, modifier, 1024, 1031)
		}
	}
	if ast.HasSyntacticModifier(member, ast.ModifierFlagsAsync) && member.Type() != nil {
		// The rejected async header requires Promise only at this return annotation.
		coverExactErrorCodes(c, member.Type(), 1064)
	}
	if ast.IsAccessor(member) {
		coverExactErrorCodes(c, member, 7032, 7033)
		for _, parameter := range member.Parameters() {
			coverExactErrorCodes(c, parameter, 7006)
		}
	}
}
