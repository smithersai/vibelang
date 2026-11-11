package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK1801: VIP-18 accepts only arrays of Effects. {0} is the operation.
var EK1801 = message(1801, errorCategory, "{0} requires an array or tuple of Effects.")

// tryOperationHints gives each VIP-18 operation an EK1801 hint that keeps its
// meaning. Only try.all has an object counterpart, the all global; a race or
// an any written with it would become an all.
var tryOperationHints = map[string]string{
	"try.all":        "Use try all({ … }, { concurrency: \"unbounded\" }) for an object.",
	"try.race":       "Race an array of Effects, such as try.race [a(), b()].",
	"try.any":        "Pass an array of Effects, such as try.any [a(), b()].",
	"try.allSettled": "Pass an array of Effects, such as try.allSettled [a(), b()].",
}

func init() {
	checker.RegisterCallArgumentDiagnosticsFilterHook(filterRejectedTryOperationArgumentDiagnostics)
	registry[EK1801.Code] = EK1801
	fileChecks = append(fileChecks, checkTryOperations)
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
				note(report(c, operand, EK1801, name), tryOperationHints[name])
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// VIP-18 uses native array assignability, including any, never, generic
// constraints and the project's null-checking options.
func tryOperationArrayType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	base := analyzerFor(c).programEffectInterface()
	if base == nil {
		return false
	}
	any := c.GetAnyType()
	effect := c.NewTypeReference(base, []*checker.Type{any, any, any})
	return c.IsTypeAssignableTo(t, c.CreateArrayType(effect, true))
}

// trySettledLiteral returns a no-spread source literal. Spread operands keep
// one native source-array construction before mapping its elements.
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

// The call hook receives only the synthesized helper's applicability errors.
// Written literal contexts, calls and assignments retain their own checks.
func filterRejectedTryOperationArgumentDiagnostics(c *checker.Checker, call *ast.Node, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	if len(diagnostics) == 0 || !ast.IsCallExpression(call) || len(call.Arguments()) != 1 ||
		!isVibeLangFile(ast.GetSourceFileOfNode(call)) || inHatch(call) || !inEffectCode(call) || tryOperationName(call) == "" {
		return diagnostics
	}
	operand := call.Arguments()[0]
	if !ast.NodeIsMissing(operand) {
		if t := c.GetTypeAtLocation(operand); t != nil && !tryOperationArrayType(c, t) {
			return nil
		}
	}
	return diagnostics
}

// nativeTryAllCall keeps branch allocation in the project's Effect instance.
func (tx *lowering) nativeTryAllCall(node *ast.Node) *ast.Node {
	f := tx.Factory()
	operand := tx.Visitor().VisitNode(node.Arguments()[0])
	if tryOperationName(node) == "try.allSettled" {
		mapMember := f.NewPropertyAccessExpression(operand, nil, f.NewIdentifier("map"), ast.NodeFlagsNone)
		exit := f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("exit"), ast.NodeFlagsNone)
		operand = f.NewCallExpression(mapMember, nil, nil, f.NewNodeList([]*ast.Node{exit}), ast.NodeFlagsNone)
	}
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("all"), ast.NodeFlagsNone)
	options := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil, f.NewIdentifier("concurrency"), nil, nil, f.NewStringLiteral("unbounded", ast.TokenFlagsNone)),
	}), false /*multiLine*/)
	return f.UpdateCallExpression(node.AsCallExpression(), callee, node.QuestionDotToken(), nil /*typeArguments*/, f.NewNodeList([]*ast.Node{operand, options}), node.Flags)
}
