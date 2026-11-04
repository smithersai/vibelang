package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type catchExecutionDiagnosticsKey struct{}

func catchExecutionMismatchStarts(c *checker.Checker) map[*ast.SourceFile][]int {
	return c.ExtensionState(catchExecutionDiagnosticsKey{}, func() any { return map[*ast.SourceFile][]int{} }).(map[*ast.SourceFile][]int)
}

func init() {
	checker.RegisterDiagnosticsFilterHook(func(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
		starts := catchExecutionMismatchStarts(c)[file]
		if len(starts) == 0 {
			return ds
		}
		return slices.DeleteFunc(slices.Clone(ds), func(d *ast.Diagnostic) bool {
			return d.Source() == "" && (d.Code() == 2322 || d.Code() == 2739 || d.Code() == 2740) && slices.Contains(starts, d.Pos()) && strings.Contains(d.String(), "Effect<unknown, unknown, unknown>")
		})
	})

	tsFormFixCodes = append(tsFormFixCodes, EK0505.Code)
	tsFormRules[EK0505.Code] = &tsFormRule{
		message:   EK0505,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      catchExecutionRewrite,
		diagnosed: isCatchExecutionHead,
	}
	ls.RegisterCodeFixProvider(catchExecutionIntentFix)
}

// Inspect source operators only. In particular, do not descend into a call's
// arguments or skip source parentheses. A try can itself be represented by
// a flagged parenthesized operand, so recognize execution before barriers.
func isCatchExecutionHead(n *ast.Node) bool {
	if n == nil {
		return false
	}
	if n.Flags&ast.NodeFlagsVibeLangTry != 0 || isTryCall(n) || tryOperationName(n) != "" || fiberHelper(n) == "$join" {
		return true
	}
	return ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "fork" && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

func catchExecutionHeads(n *ast.Node, visit func(*ast.Node)) {
	if n == nil {
		return
	}
	if isCatchExecutionHead(n) {
		visit(n)
		return
	}
	switch n.Kind {
	case ast.KindPrefixUnaryExpression:
		catchExecutionHeads(n.AsPrefixUnaryExpression().Operand, visit)
	case ast.KindPostfixUnaryExpression:
		catchExecutionHeads(n.AsPostfixUnaryExpression().Operand, visit)
	case ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindTypeAssertionExpression, ast.KindNonNullExpression, ast.KindExpressionWithTypeArguments,
		ast.KindTypeOfExpression, ast.KindVoidExpression, ast.KindDeleteExpression:
		catchExecutionHeads(n.Expression(), visit)
	case ast.KindBinaryExpression:
		catchExecutionHeads(n.AsBinaryExpression().Left, visit)
		catchExecutionHeads(n.AsBinaryExpression().Right, visit)
	}
}

func checkCatchExecutionHead(c *checker.Checker, file *ast.SourceFile, call, left, fallback *ast.Node) bool {
	if malformedCatchHandler(call, fallback) != nil {
		return false
	}
	found := false
	catchExecutionHeads(left, func(head *ast.Node) {
		found = true
		d := reportAt(c, file, tsFormSpan(file, head), EK0505)
		if rewrite := catchExecutionRewrite(c, file, head); rewrite != nil {
			if rewrite.fixable() {
				note(d, "vibelang --fix can {0}.", rewrite.description)
			} else if rewrite.why != "" {
				note(d, "{0}", rewrite.why)
			}
		}
	})
	if found {
		// Match diagnostic anchors: satisfies points at its keyword,
		// while the source execution head starts at its operand.
		catchExecutionMismatchStarts(c)[file] = append(catchExecutionMismatchStarts(c)[file], scanner.GetErrorRangeForNode(file, left).Pos())
	}
	return found
}

// Retain the old catch operand's execution as an explicit Effect program.
// Grouping a scalar execution would instead give catch a non-Effect operand.
// Refuse source jumps, which an explicit function boundary could retarget.
func catchExecutionRewrite(c *checker.Checker, file *ast.SourceFile, head *ast.Node) *formRewrite {
	var call *ast.Node
	for n := head.Parent; n != nil; n = n.Parent {
		if catchExpressionOf(n) != nil {
			call = n
			break
		}
	}
	if call == nil {
		return nil
	}
	left, _ := catchParts(call)
	if left == head && fiberHelper(head) == "$join" && c != nil {
		qualifier, imports := catchExecutionModule(c, file, head, "Fiber")
		replacement := qualifier + ".join(" + nodeText(file, head.Arguments()[0]) + ")"
		edits := []sourceEdit{{nodeStart(file, head), head.End(), replacement}}
		return &formRewrite{edits: append(edits, imports...), description: "catch the joined fiber's failure without capturing its owner"}
	}
	var containsFork func(*ast.Node) bool
	containsFork = func(n *ast.Node) bool {
		return ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "fork" && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 || n.ForEachChild(containsFork)
	}
	if containsFork(left) {
		if left != head || !ast.IsCallExpression(head) || !ast.IsIdentifier(head.Expression()) || head.Expression().Text() != "fork" || len(head.Arguments()) != 1 || c == nil {
			return &formRewrite{why: "Choose the intended fork and catch boundary; wrapping this head could change its fiber's owner."}
		}
		qualifier, imports := catchExecutionModule(c, file, head, "Effect")
		handler := call.Arguments()[1]
		handlerText := nodeText(file, handler)
		if !isMarkedEffect(ast.SkipParentheses(handler)) {
			parameter := (&freshNames{file: file}).freshName("$e")
			// map contextually types the original literal, including a
			// zero-argument handler, without inventing a direct invocation.
			handlerText = "(" + parameter + ") => " + qualifier + ".map(" + qualifier + ".succeed(" + parameter + "), " + handlerText + ")"
		}
		replacement := "fork " + qualifier + ".catch(" + nodeText(file, head.Arguments()[0]) + ", " + handlerText + ")"
		edits := []sourceEdit{{nodeStart(file, call), call.End(), replacement}}
		return &formRewrite{edits: append(edits, imports...), description: "handle the failure on the forked fiber, retaining caller-side operand evaluation"}
	}
	var jump func(*ast.Node) bool
	jump = func(n *ast.Node) bool {
		switch n.Kind {
		case ast.KindReturnStatement, ast.KindBreakStatement, ast.KindContinueStatement:
			return true
		}
		return n.ForEachChild(jump)
	}
	if jump(left) {
		return &formRewrite{why: "An explicit effect block could retarget a source jump; choose the intended execution and catch boundary."}
	}
	text := nodeText(file, left)
	if text == "" {
		return nil
	}
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, left), left.End(), "(effect { return " + text + "\n})"}}, description: "keep the running left side in an effect block"}
}

// The editor also offers VIP-5's direct try repair. The first action is
// the migration that retains the running left side; --fix takes that one.
var catchExecutionIntentFix = &ls.CodeFixProvider{
	Source: diagnosticSource, ErrorCodes: []int32{EK0505.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		preserving, err := typeScriptFormFix.GetCodeActions(ctx, fix)
		if err != nil {
			return nil, err
		}
		head := tsFormNodeAt(fix.SourceFile, fix.Span, isCatchExecutionHead)
		if len(preserving) == 0 || head == nil || !isTry(head) {
			return preserving, nil
		}
		var call *ast.Node
		for n := head.Parent; n != nil; n = n.Parent {
			if catchExpressionOf(n) != nil {
				call = n
				break
			}
		}
		if call == nil {
			return preserving, nil
		}
		left, _ := catchParts(call)
		if left != head || !strings.HasPrefix(nodeText(fix.SourceFile, head), "try") {
			return preserving, nil
		}
		start := nodeStart(fix.SourceFile, head)
		return append(preserving, &ls.CodeAction{Description: "Remove try and let catch run the Effect", Changes: replaceRange(fix, start, start+3, "")}), nil
	},
}

func catchExecutionModule(c *checker.Checker, file *ast.SourceFile, at *ast.Node, name string) (string, []sourceEdit) {
	visible := c.ResolveName(name, at, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
	if visible != nil && c.GetTypeOnlyAliasDeclaration(visible) == nil {
		resolved := visible
		if visible.Flags()&ast.SymbolFlagsAlias != 0 {
			resolved = c.GetAliasedSymbol(visible)
		}
		if resolved == effectModuleNamespace(c, file, name) {
			return name, nil
		}
	}
	fresh := (&freshNames{file: file}).freshName("$catch" + name)
	pos := tryOperationImportPosition(file)
	return fresh, []sourceEdit{{pos, pos, "import * as " + fresh + " from \"effect/" + name + "\"\n"}}
}
