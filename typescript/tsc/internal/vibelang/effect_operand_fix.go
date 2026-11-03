package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0502.Code, EK0506.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0502.Code, EK0506.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK0502.Code, EK0506.Code},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			var actions []*ls.CodeAction
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if node.End() < fix.Span.Pos() || node.Pos() > fix.Span.End() {
					return false
				}
				if fix.ErrorCode == EK0506.Code {
					if call := catchExpressionOf(node); call != nil && markedForm(call.Arguments()[0]) != formNone {
						left, _ := catchParts(call)
						if nodeStart(fix.SourceFile, left) == fix.Span.Pos() {
							text := "effect { return " + nodeText(fix.SourceFile, left) + " }"
							actions = append(actions, &ls.CodeAction{Description: "Write an explicit effect block for the catch operand", Changes: replaceRange(fix, nodeStart(fix.SourceFile, left), left.End(), text)})
							return false
						}
					}
					return node.ForEachChild(visit)
				}
				operand := tryOperand(node)
				if triedFlag(node) {
					operand = node
				}
				if operand != nil {
					at := nodeStart(fix.SourceFile, operand)
					if triedFlag(operand) {
						at = tryKeyword(fix.SourceFile, operand).Pos()
					}
					if at != fix.Span.Pos() {
						return node.ForEachChild(visit)
					}
					t := effectOperandType(c, operand)
					if catchExpressionOf(ast.SkipParentheses(operand)) != nil && !isEffectOperandType(c, t) {
						keyword := tryKeyword(fix.SourceFile, node)
						end := keyword.End()
						for end < len(fix.SourceFile.Text()) && fix.SourceFile.Text()[end] == ' ' {
							end++
						}
						actions = append(actions, &ls.CodeAction{Description: "Write the catch expression alone", Changes: replaceRange(fix, keyword.Pos(), end, "")})
						return false
					}
					optional := ast.IsOptionalChain(ast.SkipParentheses(operand))
					// Unknown call results bypassed the old operand check. An erased
					// assertion preserves their unchecked delegation. Optional calls
					// formerly lifted the absent branch to successful undefined.
					if t != nil && (t.Flags()&checker.TypeFlagsUnknown != 0 || optional) {
						start, end := nodeStart(fix.SourceFile, operand), operand.End()
						text := nodeText(fix.SourceFile, operand)
						if triedFlag(operand) {
							start = tryKeyword(fix.SourceFile, operand).End()
							text = triedText(fix.SourceFile, operand)
						}
						replacement := " (" + text + " as unknown!!)"
						if optional {
							replacement = " (" + text + " ?? effect { return undefined })"
						}
						actions = append(actions, &ls.CodeAction{Description: "Write explicit legacy operand behavior", Changes: replaceRange(fix, start, end, replacement)})
						return false
					}
				}
				return node.ForEachChild(visit)
			}
			fix.SourceFile.AsNode().ForEachChild(visit)
			return actions, nil
		},
	})
}

// A legacy try around a malformed catch can become invalid only after the
// handler repair. Remove that redundant keyword in the same edit, so the
// normal fix gate never has to accept a temporary new EK0502.
func legacyCatchTryRemoval(file *ast.SourceFile, call *ast.Node) *core.TextChange {
	site := outerParentheses(call)
	if site.Parent != nil && isTryCall(site.Parent) {
		site = site.Parent
	} else if !triedFlag(site) {
		return nil
	}
	keyword := tryKeyword(file, site)
	end := keyword.End()
	for end < len(file.Text()) && file.Text()[end] == ' ' {
		end++
	}
	return &core.TextChange{TextRange: core.NewTextRange(keyword.Pos(), end)}
}
