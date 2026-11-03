package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Effect TypeScript's yield* e runs e; VIP-5 spells that try e. A redundant
// yield* before a try yielding a value loses the delegator; a returned Effect
// still runs. Do not turn an
// emission into an Effect run, or make parameter initialization suspend.
func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK2104.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2104.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK2104.Code},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			node := reportedNode(fix.SourceFile, fix.Span, ast.IsYieldExpression)
			if node == nil {
				return nil, nil
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			if !yieldActivationFixable(node) {
				return nil, nil
			}
			operand := node.Expression()
			alreadyRun := isTry(ast.SkipParentheses(operand))
			effectOperand := isEffectType(c, c.GetTypeAtLocation(operand))
			removeDelegator := alreadyRun && !effectOperand
			if !alreadyRun && !effectOperand {
				return nil, nil
			}
			start := nodeStart(fix.SourceFile, node)
			star := node.AsYieldExpression().AsteriskToken
			operandStart := nodeStart(fix.SourceFile, operand)
			text := fix.SourceFile.Text()
			// Preserve comments on either side of the star.
			gap := text[start+len("yield"):nodeStart(fix.SourceFile, star)] + text[star.End():operandStart]
			prefix := ""
			if !removeDelegator {
				prefix = "try "
			}
			if strings.TrimSpace(gap) != "" {
				prefix += strings.TrimLeft(gap, " \t")
			}
			// A line comment must not leave a line terminator after return.
			// Put the comment inside grouping and retain its terminating newline.
			grouped := strings.TrimSpace(gap) != "" && strings.ContainsAny(gap, "\r\n")
			if grouped {
				if removeDelegator {
					prefix = "(" + strings.TrimLeft(gap, " \t")
				} else {
					prefix = "try (" + strings.TrimLeft(gap, " \t")
				}
			} else if !removeDelegator && (alreadyRun || tryOperandNeedsParentheses(c, operand)) {
				prefix += "("
				grouped = true
			}
			edits := replaceRange(fix, start, operandStart, prefix)
			if grouped {
				edits = append(edits, replaceRange(fix, operand.End(), operand.End(), ")")...)
			}
			return []*ls.CodeAction{{Description: "Write try to run the Effect", Changes: edits}}, nil
		},
	})
}

func yieldActivationFixable(node *ast.Node) bool {
	if !ast.IsYieldExpression(node) || node.AsYieldExpression().AsteriskToken == nil || node.Expression() == nil ||
		!parser.VibeLangYieldOutsideProducer(node) {
		return false
	}
	for n, child := node.Parent, node; n != nil; child, n = n, n.Parent {
		if n.Kind == ast.KindParameter {
			return false
		}
		if ast.IsFunctionLike(n) && child == n.Body() &&
			!(n.Kind == ast.KindArrowFunction && n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 && n.Flags&ast.NodeFlagsVibeLangEffect == 0) {
			return n.Flags&ast.NodeFlagsVibeLangEffect != 0 && ast.GetFunctionFlags(n)&ast.FunctionFlagsGenerator == 0
		}
	}
	return false
}
