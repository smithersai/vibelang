package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Retired block-parameter decoding is private to migration (VIP-11). It writes
// the old callback as the call's last argument so diagnostics and codemods can
// recover its original form. Ordinary parsing never constructs these calls.
// The pre-0.0.10 Effect-dual placement is retained separately by
// dual_block_migration.go.

// isBlockParamCall reports whether call passes a block param: its last
// argument is an arrow function with no parameters and a block body, written
// as a bare block, so its text starts with { rather than (.
func isBlockParamCall(call *ast.Node) bool {
	if !ast.IsCallExpression(call) {
		return false
	}
	arguments := call.Arguments()
	if len(arguments) == 0 {
		return false
	}
	arrow := arguments[len(arguments)-1]
	if arrow.Kind != ast.KindArrowFunction || len(arrow.Parameters()) != 0 || arrow.Body() == nil || arrow.Body().Kind != ast.KindBlock {
		return false
	}
	file := ast.GetSourceFileOfNode(call)
	if !isVibeLangFile(file) {
		return false
	}
	text := file.Text()
	start := scanner.SkipTrivia(text, arrow.Pos())
	return start < len(text) && text[start] == '{'
}
