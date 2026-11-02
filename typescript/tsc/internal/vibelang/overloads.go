package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// rankProgramCandidates implements D257 after D56 has checked each candidate
// in its own form. Prefer passing calls by name (D147) to running them while
// evaluating the arguments. A running call with success never cannot make a
// value parameter applicable by vacuity. Plain TypeScript and calls without
// potentially running arguments retain first-applicable overload selection.
func rankProgramCandidates(c *checker.Checker, call *ast.Node) func(*checker.Signature) int {
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) || !ast.IsCallExpression(call) {
		return nil
	}
	args := call.Arguments()
	if args == nil {
		return nil
	}
	potential := false
	for _, arg := range args {
		if mayRunByName(arg) {
			potential = true
			break
		}
	}
	if !potential {
		return nil
	}
	a := analyzerFor(c)
	return func(candidate *checker.Signature) (rank int) {
		// Observe only candidates the checker actually ranks (fully applicable
		// in their own context). The census must not rerun ranking on arbitrary
		// declared signatures and mistake an inapplicable overload for a choice.
		defer func() { rememberLegacyRank(c, call, candidate, rank) }()
		for _, arg := range args {
			if !mayRunByName(arg) {
				continue
			}
			for ast.IsParenthesizedExpression(arg) {
				arg = arg.Expression()
			}
			t := c.GetTypeAtLocation(arg)
			if state := a.conversions[arg]; state != nil && state.byCandidate[keyOf(candidate)] == convertByName {
				rank++
			} else if t.Flags()&checker.TypeFlagsNever != 0 && !isPlaceholderNever(t) && a.pauses(arg) {
				return -1
			}
		}
		return rank
	}
}
