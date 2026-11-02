package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
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
			valid := tryOperationArrayType(c, t) && !tryOperationUsesFunctionConversion(c, node)
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
	if t == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsNever != 0 {
		return true
	}
	return everyMember(t, func(t *checker.Type) bool {
		t = c.GetApparentType(t)
		if c.GetPropertyOfType(t, effectTypeID) == nil {
			return false
		}
		base := analyzerFor(c).programEffectInterface()
		if base == nil {
			return false
		}
		any := c.GetAnyType()
		effect := c.NewTypeReference(base, []*checker.Type{any, any, any})
		return c.IsTypeAssignableTo(t, effect)
	})
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

// While legacy contextual conversions exist, they must not turn functions
// into the Effect values required by VIP-18. Read their selected decision;
// do not infer another form or change conversions in other calls.
func tryOperationUsesFunctionConversion(c *checker.Checker, call *ast.Node) bool {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		owner, _ := ownerCall(node)
		if owner == call {
			switch a.finalConversion(node) {
			case convertProgram, convertSyncProgram, convertPrograms:
				return true
			}
			if isLambda(node) && !isProgramArrow(node) && a.finalForm(node) == formProgram {
				return true
			}
		}
		if isFunctionBoundary(node) {
			return false
		}
		return node.ForEachChild(visit)
	}
	return visit(call.Arguments()[0])
}
