package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Shared pipeline classification and edit composition.

// isPipeCall reports whether node is x.pipe(…) as the source writes it, not
// a pipe the parser wrote for x |> f(%).
func isPipeCall(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 {
		return false
	}
	callee := node.Expression()
	return ast.IsPropertyAccessExpression(callee) && callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0 &&
		ast.IsIdentifier(callee.Name()) && callee.Name().Text() == "pipe" && callee.Name().Flags&ast.NodeFlagsReparsed == 0
}

// isEffectPipeline reports whether call, a .pipe, carries an Effect through
// its stages.
func isEffectPipeline(c *checker.Checker, call *ast.Node) bool {
	for _, stage := range call.Arguments() {
		callee := ast.SkipParentheses(stage)
		if ast.IsCallExpression(callee) {
			callee = callee.Expression()
		}
		if module, _ := effectMember(c, callee); module == "Effect" {
			return true
		}
	}
	receiver := ast.SkipParentheses(call.Expression().Expression())
	if t := c.GetTypeAtLocation(receiver); t != nil && isEffectType(c, t) {
		return true
	}
	// (try f()).pipe(g) pipes f's success value, not the Effect f returns.
	return ast.IsCallExpression(receiver) && receiver.Flags&ast.NodeFlagsVibeLangTry == 0 && callReturnsEffect(c, receiver)
}

// joinEditsAt returns edits with an insertion and the edit that starts at the
// same offset, as a stage's (%) and the comma after it, as one edit, whose
// text keeps the insertion first.
func joinEditsAt(edits []sourceEdit) []sourceEdit {
	slices.SortStableFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	var joined []sourceEdit
	for _, edit := range edits {
		if last := len(joined) - 1; last >= 0 && joined[last].start == edit.start {
			joined[last].end = max(joined[last].end, edit.end)
			joined[last].text += edit.text
			continue
		}
		joined = append(joined, edit)
	}
	return joined
}
