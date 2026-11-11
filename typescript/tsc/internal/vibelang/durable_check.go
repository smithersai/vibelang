package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Durable declarations (VIP-55, parser/vibelang_durable.go). A task records
// into a workflow run, so it is called only from a workflow's effect call:
// anywhere else there is no run to record into (EK5502). Every type at a
// durable boundary has a schema form, or it is EK2109 (VIP-44), checked as a
// schema declaration's fields are.

// EK5502: a task called outside a workflow's effect call (VIP-55). {0} is the task.
var EK5502 = message(5502, errorCategory, "{0} is a task, which runs only as a step of a workflow. Call it from a workflow's `effect call`, or write it as an `effect function`.")

func init() {
	registry[EK5502.Code] = EK5502
	fileChecks = append(fileChecks, checkTaskCalls)
}

// durableKind returns "task" or "workflow" when call is the call a task or
// workflow declaration writes, $task<S>()(…) or $workflow(…), and "" otherwise.
func durableKind(call *ast.Node) string {
	if call == nil || !ast.IsCallExpression(call) {
		return ""
	}
	callee := call.Expression()
	if ast.IsCallExpression(callee) {
		callee = callee.Expression()
	}
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
		return ""
	}
	switch callee.Text() {
	case "$task":
		return "task"
	case "$workflow":
		return "workflow"
	}
	return ""
}

// isWorkflowBody reports whether fn is a workflow declaration's effect call.
func isWorkflowBody(fn *ast.Node) bool {
	call := fn.Parent
	return call != nil && durableKind(call) == "workflow" && len(call.Arguments()) >= 4 && call.Arguments()[3] == fn
}

// isTaskValue reports whether expression's type is a task, the runtime's Task.
func isTaskValue(c *checker.Checker, expression *ast.Node) bool {
	t := c.GetTypeAtLocation(expression)
	return t != nil && isRuntimeSymbol(c, t.Symbol(), "Task")
}

// checkTaskCalls reports EK5502 at each call of a task outside a workflow's
// effect call.
func checkTaskCalls(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || !builtinsOn(c, file) { // EK3013 gates them (experimental_gate.go)
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if durableKind(node) != "" && len(node.Arguments()) >= 3 {
			checkDurableSchemas(c, file, node.Arguments()[2])
		}
		if ast.IsCallExpression(node) && durableKind(node) == "" && isTaskValue(c, node.Expression()) {
			if owner := effectCodeOwner(node); owner == nil || !isWorkflowBody(owner) {
				report(c, node.Expression(), EK5502, entityText(node.Expression()))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkDurableSchemas reports EK2109 at each boundary type of a task or
// workflow, schemas the object the parser derived from them, that has no
// schema form.
func checkDurableSchemas(c *checker.Checker, file *ast.SourceFile, schemas *ast.Node) {
	if !ast.IsObjectLiteralExpression(schemas) {
		return
	}
	for _, property := range schemas.AsObjectLiteralExpression().Properties.Nodes {
		value := property.Initializer()
		if value == nil {
			continue
		}
		if ast.IsObjectLiteralExpression(value) {
			for _, field := range value.AsObjectLiteralExpression().Properties.Nodes {
				if field.Initializer() != nil {
					checkSchemaValue(c, file, field.Initializer(), field.Initializer())
				}
			}
			continue
		}
		checkSchemaValue(c, file, value, value)
	}
}
