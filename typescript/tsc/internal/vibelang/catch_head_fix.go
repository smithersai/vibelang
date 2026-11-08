package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	// A head whose execution formerly supplied the caught Effect may now
	// produce a non-Effect. Keep its old recovery boundary explicitly.
	for _, code := range []int32{2322, 2345} {
		nativeFixCodes = append(nativeFixCodes, code)
		tsFormFixCodes = append(tsFormFixCodes, code)
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2322, 2345}, GetCodeActions: catchHeadBoundaryActions})
	// The operand check owns EK0506 and filters its native assignability
	// error. Offer the preserving boundary fix for that diagnostic too.
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0506.Code}, GetCodeActions: catchHeadBoundaryActions})
}

func catchHeadBoundaryRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if catchExpressionOf(call) == nil || !inEffectCode(call) || !inlineCatchLeft(call.Arguments()[0]) {
		return nil
	}
	fn := call.Arguments()[0]
	if catchHeadBoundaryChangesOwner(c, file, fn.Body()) {
		return nil
	}
	value := inlineCatchOperandType(c, call)
	if value.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 || isEffectValueType(c, value) || len(analyzerFor(c).flowOf(fn.Body()).runs) == 0 {
		return nil
	}
	text := "(effect { return " + nodeText(file, fn) + " })"
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, fn), fn.End(), text}}, description: "an effect block around the catch head"}
}

func catchHeadBoundaryActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	c.GetDiagnostics(ctx, fix.SourceFile)
	var chosen *formRewrite
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		node.ForEachChild(visit)
		if chosen != nil || catchExpressionOf(node) == nil {
			return false
		}
		fn := node.Arguments()[0]
		if nodeStart(fix.SourceFile, fn) > fix.Span.Pos() || fn.End() < fix.Span.End() {
			return false
		}
		if rewrite := catchHeadBoundaryRewrite(c, fix.SourceFile, node); rewrite.fixable() {
			chosen = rewrite
		}
		return false
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if !chosen.fixable() {
		return nil, nil
	}
	edit := chosen.edits[0]
	return []*ls.CodeAction{{Description: "Keep the previous catch boundary with an effect block", Changes: replaceRange(fix, edit.start, edit.end, edit.text)}}, nil
}

// An explicit Effect activation must not retarget source jumps or take over
// compiler-managed resources/children from the enclosing activation. It must
// also retain a property narrowing that the new function would forget.
func catchHeadBoundaryChangesOwner(c *checker.Checker, file *ast.SourceFile, body *ast.Node) bool {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) && !isCalledInPlace(n) && !isCatchLeftFunction(n) {
			return false
		}
		if ast.IsPropertyAccessExpression(n) && readsNarrowedProperty(c, n) {
			return true
		}
		if n.Kind == ast.KindVariableDeclarationList && isUsingList(n) {
			return true
		}
		if ast.IsCallExpression(n) && analyzerFor(c).isPreludeFork(n) {
			return true
		}
		if n.Kind == ast.KindReturnStatement || ast.IsBreakOrContinueStatement(n) {
			if n.Pos() >= 0 && n.Pos() < len(file.Text()) {
				token := scanner.GetRangeOfTokenAtPosition(file, n.Pos())
				switch file.Text()[token.Pos():token.End()] {
				case "return", "break", "continue":
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(body)
}
