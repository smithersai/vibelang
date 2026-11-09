package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-5 bans native try statements in effect code, including try/finally.
// Keep the parser's JavaScript statement priority and check the innermost
// callable's execution kind, so nested plain/async functions retain native try.
func init() {
	fileChecks = append(fileChecks, checkNativeTryStatements)
	tsFormRules[EK0503.Code] = &tsFormRule{
		message: EK0503,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

func checkNativeTryStatements(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nativeTryInEffectCode(n) {
			reportAt(c, file, tsFormSpan(file, n), EK0503)

		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// A handler statement is represented by a TryStatement too, but is not
// native JavaScript try. Unmarked generator functions are plain (VIP-1);
// the older producer classifier must not make their native try an error.
func nativeTryInEffectCode(n *ast.Node) bool {
	if !ast.IsTryStatement(n) || isHandleStatement(n) || inHatch(n) {
		return false
	}
	file := ast.GetSourceFileOfNode(n)
	body := n.AsTryStatement().TryBlock
	if ast.NodeIsMissing(body) || body.Pos() < 0 || body.End() > len(file.Text()) {
		return false
	}
	start := nodeStart(file, body)
	if start >= len(file.Text()) || file.Text()[start] != '{' {
		return false
	} // a synthesized wrapper around a handler is not native try
	// Binding lowering also creates try/finally nodes to close iterators.
	// Only a written try keyword followed by this block is a native statement.
	keyword := nodeStart(file, n)
	if keyword < 0 || keyword+3 > len(file.Text()) || file.Text()[keyword:keyword+3] != "try" ||
		scanner.SkipTrivia(file.Text(), keyword+3) != start {
		return false
	}
	owner := effectCodeOwner(n)
	return owner != nil && (isMarkedEffect(owner) || isProgramArrow(owner) && !isCatchHandlerOf(owner) && markedForm(owner) != formNone)
}
