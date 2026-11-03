package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK1801: VIP-18 accepts only arrays of Effects.
var EK1801 = message(1801, errorCategory, "{0} requires an array or tuple of Effects. Use try all({ … }, { concurrency: \"unbounded\" }) for an object.")

func init() {
	registry[EK1801.Code] = EK1801
	fileChecks = append(fileChecks, checkTryOperations)
	tsFormFixCodes = append(tsFormFixCodes, EK1801.Code)
	ls.RegisterCodeFixProvider(tryOperationObjectFix)
}

func tryOperationName(node *ast.Node) string {
	if node == nil || !ast.IsCallExpression(node) || len(node.Arguments()) != 1 {
		return ""
	}
	callee := node.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch callee.Text() {
	case "$tryAll":
		return "try.all"
	case "$tryRace":
		return "try.race"
	case "$tryAny":
		return "try.any"
	case "$tryAllSettled":
		return "try.allSettled"
	}
	return ""
}

func checkTryOperations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := tryOperationName(node); name != "" {
			operand := node.Arguments()[0]
			t := c.GetTypeAtLocation(operand)
			valid := tryOperationArrayType(c, t)
			if t != nil && !valid {
				report(c, operand, EK1801, name)
				cover(c, node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// An object already contains Effects: all is its direct, mechanical repair.
var tryOperationObjectFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1801.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var actions []*ls.CodeAction
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if tryOperationName(node) == "try.all" {
				operand := node.Arguments()[0]
				if nodeStart(fix.SourceFile, operand) == fix.Span.Pos() && ast.SkipParentheses(operand).Kind == ast.KindObjectLiteralExpression {
					name := "$tryAllEffects"
					for strings.Contains(fix.SourceFile.Text(), name) {
						name += "_"
					}
					text := "(try " + name + "(" + expressionText(fix.SourceFile, operand) + ", { concurrency: \"unbounded\" }))"
					at := tryOperationImportPosition(fix.SourceFile)
					imported := "import { all as " + name + " } from \"effect/Effect\"\n"
					if at > 0 && fix.SourceFile.Text()[at-1] != '\n' {
						imported = "\n" + imported
					}
					changes := replaceRange(fix, nodeStart(fix.SourceFile, node), node.End(), text)
					if at == nodeStart(fix.SourceFile, node) {
						changes[0].NewText = imported + text
					} else {
						changes = append(changes, replaceRange(fix, at, at, imported)...)
					}
					actions = append(actions, &ls.CodeAction{Description: "Write try all for an object", Changes: changes})
				}
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		return actions, nil
	},
}

// Array constraints and derived array interfaces have the same numeric
// element type as their array base. Never is a valid empty element type.
func tryOperationArrayType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsNever != 0 {
		return true
	}
	if t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !tryOperationArrayType(c, member) {
				return false
			}
		}
		return true
	}
	t = c.GetApparentType(t)
	if !c.IsArrayLikeType(t) {
		return false
	}
	element := c.GetIndexTypeOfType(t, c.GetNumberType())
	return element != nil && tryOperationEffectType(c, element)
}

func tryOperationEffectType(c *checker.Checker, t *checker.Type) bool {
	return isEffectOperandType(c, t)
}

// Keep file comments and directive prologues before an inserted import.
func tryOperationImportPosition(file *ast.SourceFile) int {
	if len(file.Statements.Nodes) == 0 {
		return len(file.Text())
	}
	at := nodeStart(file, file.Statements.Nodes[0])
	for _, statement := range file.Statements.Nodes {
		if statement.Kind != ast.KindExpressionStatement || statement.Expression().Kind != ast.KindStringLiteral {
			break
		}
		at = statement.End()
	}
	return at
}

// trySettledLiteral returns a no-spread source literal. Spread operands keep
// the helper's single source-array construction and native iterator behavior.
func trySettledLiteral(node *ast.Node) *ast.Node {
	if tryOperationName(node) != "try.allSettled" {
		return nil
	}
	operand := ast.SkipParentheses(node.Arguments()[0])
	if !ast.IsArrayLiteralExpression(operand) || slices.ContainsFunc(operand.Elements(), ast.IsSpreadElement) {
		return nil
	}
	return operand
}

// visitTrySettledLiteral emits the VIP-18 per-element counterpart directly:
// mapping a compiler-created literal would add an observable prototype call.
func (tx *lowering) visitTrySettledLiteral(node *ast.Node) *ast.Node {
	f := tx.Factory()
	operand := trySettledLiteral(node)
	invoke := func(name string, args ...*ast.Node) *ast.Node {
		member := f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier(name), ast.NodeFlagsNone)
		return f.NewCallExpression(member, nil, nil, f.NewNodeList(args), ast.NodeFlagsNone)
	}
	elements := make([]*ast.Node, 0, len(operand.Elements()))
	for _, element := range operand.Elements() {
		exited := invoke("exit", tx.Visitor().VisitNode(element))
		tx.EmitContext().SetOriginal(exited, element)
		exited.Loc = element.Loc
		elements = append(elements, exited)
	}
	array := f.NewArrayLiteralExpression(f.NewNodeList(elements), false)
	tx.EmitContext().SetOriginal(array, operand)
	array.Loc = operand.Loc
	options := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil, f.NewIdentifier("concurrency"), nil, nil, f.NewStringLiteral("unbounded", ast.TokenFlagsNone)),
	}), false)
	call := invoke("all", array, options)
	tx.EmitContext().SetOriginal(call, node)
	call.Loc = node.Loc
	if tx.inEffect && tx.plan.runsCall(node) {
		run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), call)
		tx.EmitContext().SetOriginal(run, node)
		run.Loc = node.Loc
		return run
	}
	return call
}
