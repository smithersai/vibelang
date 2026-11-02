package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

var (
	EK2001     = message(2001, errorCategory, "for try consumes a Stream inside effect code; move this loop into an effect function or block.")
	EK2002     = message(2002, errorCategory, "return cannot leave a for try body; use break to stop consuming the Stream, then return after the loop.")
	EK2003     = message(2003, errorCategory, "A labeled jump cannot leave a for try body; move the decision after the loop.")
	EK2004     = message(2004, errorCategory, "for try requires a Stream; convert an AsyncIterable with Stream.fromAsyncIterable first.")
	forTryHead = message(2005, errorCategory, "for try declares its element with const or let; write for try (const v of s) { x = v } to assign an existing variable.")
)

func isForTry(n *ast.Node) bool {
	return n != nil && n.Kind == ast.KindForOfStatement && n.Flags&ast.NodeFlagsVibeLang != 0
}

func init() {
	for _, m := range []*Message{EK2001, EK2002, EK2003, EK2004} {
		registry[m.Code] = m
	}
	// EK2005 still names the legacy resumeWith rule until its owning VIP
	// retires it; register the for try head rule once the code is free.
	if registry[forTryHead.Code] == nil {
		registry[forTryHead.Code] = forTryHead
	}
	fileChecks = append(fileChecks, checkForTry)
}

func checkForTry(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isForTry(n) {
			if init := n.AsForInOrOfStatement().Initializer; init != nil && (!ast.IsVariableDeclarationList(init) || init.Flags&(ast.NodeFlagsLet|ast.NodeFlagsConst) == 0 || init.Flags&ast.NodeFlagsUsing != 0) {
				report(c, init, forTryHead)
			}
			if !inEffectCode(n) { // a plain function is not effect code (VIP-1, VIP-20)
				report(c, n, EK2001)
				coverCodes(c, n.Expression(), 2488, 2504)
			}
			if !forTryOperandType(c, c.GetTypeAtLocation(n.Expression())) {
				report(c, n.Expression(), EK2004)
				coverCodes(c, n.Expression(), 2488, 2504)
			}
			var body func(*ast.Node) bool
			body = func(x *ast.Node) bool {
				// A do expression is an invoked arrow, but its jumps still target
				// the function and statements around the for try.
				if isFunctionBoundary(x) && !isDoArrow(file, x) {
					return false
				}
				if ast.IsBreakOrContinueStatement(x) && x.Label() != nil {
					target := labeledJumpTarget(file, x)
					own := target != nil && target.Kind == ast.KindLabeledStatement && labeledLoop(target) == n
					if target != nil && !contains(n, target) && !own {
						report(c, x, EK2003)
						// A retained do IIFE is an implementation boundary, not
						// an additional source-function error (VIP-34).
						coverCodes(c, x, 1107)
					}
				}
				// The completion of a do expression is a synthesized return
				// spanning its last expression; only a source return leaves.
				if x.Kind == ast.KindReturnStatement && isReturnKeyword(file, x) {
					report(c, x, EK2002)
					// A head return has no enclosing function body to TypeScript.
					coverCodes(c, x, 1108)
				}
				return x.ForEachChild(body)
			}
			// Chapter 2 forbids these jumps in "head binding initialization or
			// the body": both run inside the per-item callback.
			if init := n.AsForInOrOfStatement().Initializer; init != nil {
				body(init)
			}
			body(n.AsForInOrOfStatement().Statement)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// VIP-20/detail 288 uses ordinary assignability to Stream<any, any, any>.
// Channel extraction alone also admits incomplete objects with a variance
// marker, and cannot recognize any, never or constrained type parameters.
func forTryOperandType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	base := streamInterface(c)
	if base == nil {
		return false
	}
	any := c.GetAnyType()
	return c.IsTypeAssignableTo(t, c.NewTypeReference(base, []*checker.Type{any, any, any}))
}

func isReturnKeyword(file *ast.SourceFile, n *ast.Node) bool {
	r := scanner.GetRangeOfTokenAtPosition(file, n.Pos())
	return file.Text()[r.Pos():r.End()] == "return"
}

// labeledJumpTarget returns the statement a labeled break or continue names,
// looking through do expressions, whose invoked arrows jumpTarget stops at.
func labeledJumpTarget(file *ast.SourceFile, jump *ast.Node) *ast.Node {
	label := jump.Label().Text()
	for n := jump.Parent; n != nil && (!isFunctionBoundary(n) || isDoArrow(file, n)); n = n.Parent {
		if n.Kind == ast.KindLabeledStatement && n.AsLabeledStatement().Label.Text() == label {
			return n
		}
	}
	return nil
}
