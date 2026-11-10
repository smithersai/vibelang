package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A workflow's body is a plan the compiler derives before anything runs
// (VIP-55, "workflow"): every try in it names a durable step, and everything
// else is pure. These checks refuse the forms the plan cannot hold.

var (
	// EK5504: try on something that is not a durable call in a workflow body. {0} is the operand.
	EK5504 = message(5504, errorCategory, "In a workflow, try runs a durable step: a task, a workflow, W.child(…), or try.all, try.race or try.any over those. {0} is not one; move this work into a task.")
	// EK5505: a workflow body reads the clock, randomness or a module-level let. {0} is the read.
	EK5505 = message(5505, errorCategory, "A workflow's plan is decided before it runs, so its body reads no clock, randomness or module-level let: {0}. Move the read into a task and use its result.")
	// EK5506: a loop or a reassignment in a workflow body. {0} is the workflow.
	EK5506 = message(5506, errorCategory, "A workflow's plan is fixed before it runs, so {0} has no loops and no reassignments. Write the repeated work as a task, or run steps at once with try.all.")
	// EK5507: a workflow that reaches itself through try W(…). {0} is the workflow, {1} the call.
	EK5507 = message(5507, errorCategory, "{0} reaches itself through try {1}(…), and its plan would never end. A workflow's steps never run the workflow again.")
	// EK5508: W.to(…) that is not a return operand. {0} is the handoff.
	EK5508 = message(5508, errorCategory, "{0} ends this round and starts the next, so it stands only as a return operand: return {0}.")
	// EK5509: a retryPolicy with neither maxAttempts nor expirationMs.
	EK5509 = message(5509, warningCategory, "This retryPolicy has neither maxAttempts nor expirationMs, so it never gives up. Bound it with one of them.")
)

func init() {
	for _, m := range []*Message{EK5504, EK5505, EK5506, EK5507, EK5508, EK5509} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkWorkflowBodies)
}

// isDurableValue reports whether expression's type is the runtime's Task or
// Workflow, whose calls are durable steps.
func isDurableValue(c *checker.Checker, expression *ast.Node, names ...string) bool {
	t := c.GetTypeAtLocation(expression)
	if t == nil {
		return false
	}
	for _, name := range names {
		if isRuntimeSymbol(c, t.Symbol(), name) {
			return true
		}
	}
	return false
}

// isDurableCall reports whether node is a call of a task or a workflow, or
// W.child(…).
func isDurableCall(c *checker.Checker, node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	if !ast.IsCallExpression(node) || durableKind(node) != "" {
		return false
	}
	callee := node.Expression()
	if isDurableValue(c, callee, "Task", "Workflow") {
		return true
	}
	return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "child" && isDurableValue(c, callee.Expression(), "Workflow")
}

// tryOperationElements returns the elements of try.all [ … ], try.race and
// try.any, which the parser writes as $tryAll([ … ]) and the like, or nil.
func tryOperationElements(node *ast.Node) []*ast.Node {
	if !ast.IsCallExpression(node) || len(node.Arguments()) != 1 || !ast.IsIdentifier(node.Expression()) || node.Expression().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	switch node.Expression().Text() {
	case "$tryAll", "$tryRace", "$tryAny":
	default:
		return nil
	}
	argument := ast.SkipParentheses(node.Arguments()[0])
	if !ast.IsArrayLiteralExpression(argument) {
		return []*ast.Node{argument}
	}
	return argument.AsArrayLiteralExpression().Elements.Nodes
}

// workflowName returns the declared name of the workflow whose body is fn.
func workflowName(fn *ast.Node) string {
	declaration := fn.Parent.Parent
	if ast.IsVariableDeclaration(declaration) && declaration.Name() != nil && ast.IsIdentifier(declaration.Name()) {
		return declaration.Name().Text()
	}
	return "W"
}

// checkWorkflowBodies reports what a workflow body cannot hold (EK5504 to
// EK5507), and an unbounded retry policy on a task (EK5509).
func checkWorkflowBodies(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if kind := durableKind(node); kind != "" {
			if len(node.Arguments()) >= 2 {
				checkRetryPolicy(c, node.Arguments()[1])
			}
			if kind == "workflow" && len(node.Arguments()) == 4 {
				checkWorkflowBody(c, file, node.Arguments()[3])
			}
		}
		if isHandoff(c, node) && !isReturnOperand(node) {
			report(c, node, EK5508, handoffText(file, node))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkRetryPolicy reports EK5509 at a written retryPolicy object literal
// with neither maxAttempts nor expirationMs.
func checkRetryPolicy(c *checker.Checker, options *ast.Node) {
	if !ast.IsObjectLiteralExpression(options) {
		return
	}
	for _, property := range options.AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(property) || property.Name() == nil || property.Name().Text() != "retryPolicy" {
			continue
		}
		policy := ast.SkipParentheses(property.Initializer())
		if !ast.IsObjectLiteralExpression(policy) {
			continue
		}
		bounded := false
		for _, field := range policy.AsObjectLiteralExpression().Properties.Nodes {
			if field.Name() != nil && (field.Name().Text() == "maxAttempts" || field.Name().Text() == "expirationMs") || ast.IsSpreadAssignment(field) {
				bounded = true
			}
		}
		if !bounded {
			report(c, property.Name(), EK5509)
		}
	}
}

// checkWorkflowBody checks fn, a workflow's effect call.
func checkWorkflowBody(c *checker.Checker, file *ast.SourceFile, fn *ast.Node) {
	name := workflowName(fn)
	self := fn.Parent
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		own := nearestFunction(node) == fn
		switch {
		case !own:
		case node.Kind == ast.KindForStatement || node.Kind == ast.KindForInStatement || node.Kind == ast.KindForOfStatement || node.Kind == ast.KindWhileStatement || node.Kind == ast.KindDoStatement:
			report(c, node, EK5506, name)
		case node.Kind == ast.KindBinaryExpression:
			if ast.IsAssignmentOperator(node.AsBinaryExpression().OperatorToken.Kind) && ast.IsIdentifier(ast.SkipParentheses(node.AsBinaryExpression().Left)) && !insideLoop(node, fn) {
				report(c, node.AsBinaryExpression().Left, EK5506, name)
			}
		case node.Kind == ast.KindPrefixUnaryExpression || node.Kind == ast.KindPostfixUnaryExpression:
			if isIncrementOrDecrement(node) && !insideLoop(node, fn) {
				report(c, node, EK5506, name)
			}
		}
		if read := impureRead(c, node, fn); read != "" {
			report(c, node, EK5505, read)
		}
		if operand := triedOperand(node); operand != nil && effectCodeOwner(node) == fn {
			if elements := tryOperationElements(operand); elements != nil {
				for _, element := range elements {
					if !isDurableCall(c, element) {
						report(c, element, EK5504, nodeText(file, element))
					}
				}
			} else if !isDurableCall(c, operand) {
				report(c, operand, EK5504, nodeText(file, operand))
			} else if reaches(c, operand, self, map[*ast.Node]bool{}) {
				report(c, operand, EK5507, name, entityText(ast.SkipParentheses(operand).Expression()))
			}
		}
		return node.ForEachChild(visit)
	}
	if body := fn.Body(); body != nil {
		body.ForEachChild(visit)
	}
}

func isIncrementOrDecrement(node *ast.Node) bool {
	var operator ast.Kind
	var operand *ast.Node
	if node.Kind == ast.KindPrefixUnaryExpression {
		operator, operand = node.AsPrefixUnaryExpression().Operator, node.AsPrefixUnaryExpression().Operand
	} else {
		operator, operand = node.AsPostfixUnaryExpression().Operator, node.AsPostfixUnaryExpression().Operand
	}
	return (operator == ast.KindPlusPlusToken || operator == ast.KindMinusMinusToken) && ast.IsIdentifier(ast.SkipParentheses(operand))
}

// triedOperand returns what a try in node runs: the call of try f(), the
// operand of try p, or the try.all, try.race or try.any operation itself.
func triedOperand(node *ast.Node) *ast.Node {
	if ast.IsCallExpression(node) && node.Flags&ast.NodeFlagsVibeLangTry != 0 {
		return node
	}
	if operand := tryOperand(node); operand != nil {
		return operand
	}
	if tryOperationElements(node) != nil {
		return node
	}
	return nil
}

// impureRead names what node reads that a plan cannot depend on: the clock,
// randomness, or a module-level let, or returns "".
func impureRead(c *checker.Checker, node *ast.Node, fn *ast.Node) string {
	switch {
	case ast.IsCallExpression(node) && ast.IsPropertyAccessExpression(node.Expression()):
		callee := node.Expression()
		if object := callee.Expression(); ast.IsIdentifier(object) {
			switch object.Text() + "." + callee.Name().Text() {
			case "Date.now", "Math.random", "performance.now", "crypto.randomUUID", "crypto.getRandomValues":
				return entityText(callee) + "()"
			}
		}
	case ast.IsNewExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "Date" &&
		(node.Arguments() == nil || len(node.Arguments()) == 0):
		return "new Date()"
	case ast.IsIdentifier(node) && node.Parent != nil && !(ast.IsPropertyAccessExpression(node.Parent) && node.Parent.Name() == node) &&
		!(ast.IsDeclaration(node.Parent) && node.Parent.Name() == node) && !ast.IsPropertyAssignment(node.Parent):
		symbol := c.GetSymbolAtLocation(node)
		if symbol == nil || symbol.ValueDeclaration() == nil {
			return ""
		}
		declaration := symbol.ValueDeclaration()
		// A module-level let or var: const bindings never change.
		if !ast.IsVariableDeclaration(declaration) || declaration.Parent == nil || !ast.IsVariableDeclarationList(declaration.Parent) ||
			declaration.Parent.Flags&ast.NodeFlagsConst != 0 {
			return ""
		}
		statement := declaration.Parent.Parent
		if statement == nil || statement.Parent == nil || !ast.IsSourceFile(statement.Parent) || ast.GetSourceFileOfNode(declaration) != ast.GetSourceFileOfNode(node) ||
			ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
			return ""
		}
		return node.Text()
	}
	return ""
}

// reaches reports whether call, a durable call, runs the workflow whose
// declaration call is self, directly or through the workflows it runs.
// W.child(…) starts a separate run, so it reaches nothing.
func reaches(c *checker.Checker, call *ast.Node, self *ast.Node, seen map[*ast.Node]bool) bool {
	call = ast.SkipParentheses(call)
	if !isDurableValue(c, call.Expression(), "Workflow") {
		return false
	}
	symbol := c.GetSymbolAtLocation(call.Expression())
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.ValueDeclaration() == nil || !ast.IsVariableDeclaration(symbol.ValueDeclaration()) {
		return false
	}
	declared := symbol.ValueDeclaration().Initializer()
	if declared == nil || durableKind(declared) != "workflow" || len(declared.Arguments()) != 4 {
		return false
	}
	if declared == self {
		return true
	}
	if seen[declared] {
		return false
	}
	seen[declared] = true
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found {
			return true
		}
		if operand := triedOperand(node); operand != nil {
			for _, element := range append([]*ast.Node{operand}, tryOperationElements(operand)...) {
				if ast.IsCallExpression(ast.SkipParentheses(element)) && reaches(c, element, self, seen) {
					found = true
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	if body := declared.Arguments()[3].Body(); body != nil {
		body.ForEachChild(visit)
	}
	return found
}

// nearestFunction returns the function-like node that encloses node.
func nearestFunction(node *ast.Node) *ast.Node {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return n
		}
	}
	return nil
}

// insideLoop reports whether node stands in a loop of fn's own body, which
// carries the one EK5506 for its reassignments.
func insideLoop(node *ast.Node, fn *ast.Node) bool {
	for n := node.Parent; n != nil && n != fn; n = n.Parent {
		switch n.Kind {
		case ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement, ast.KindWhileStatement, ast.KindDoStatement:
			return true
		}
	}
	return false
}

// isHandoff reports whether node is W.to(…) on a workflow, or the
// $handoff(…) the parser writes for one in W's own body.
func isHandoff(c *checker.Checker, node *ast.Node) bool {
	if !ast.IsCallExpression(node) {
		return false
	}
	callee := node.Expression()
	if ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && callee.Text() == "$handoff" {
		return true
	}
	return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "to" && isDurableValue(c, callee.Expression(), "Workflow")
}

// handoffText is a handoff as written.
func handoffText(file *ast.SourceFile, node *ast.Node) string {
	return nodeText(file, node)
}

// isReturnOperand reports whether node, through parentheses, is a return
// statement's expression.
func isReturnOperand(node *ast.Node) bool {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	return node.Parent != nil && ast.IsReturnStatement(node.Parent)
}
