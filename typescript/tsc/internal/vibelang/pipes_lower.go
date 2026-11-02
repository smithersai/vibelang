package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Lowering pipes (pipes.go). A pipe compiles to its body, with each topic
// replaced by one of three things:
//
//	x |> f(args)(%)                    x.pipe(f(args)) (normalized by the parser)
//
//	fetchUser(id) |> retry(%, policy)    retry(Effect.suspend(() => fetchUser(id)), policy)
//	user |> greet(%)                     greet(user)
//	user |> greet(%, %.name)             (topic = user, greet(topic, topic.name))
//
// A topic passed by name becomes a program that evaluates the left side
// (byNameProgram). A topic used once, and evaluated after only values that
// can neither run code nor change (stableValue, order.go), becomes the left
// side itself. Otherwise the left side runs once into a variable, and each
// topic reads it; a function in the body that reads the topic takes the
// variable's value when it is created, so it keeps that value after the pipe
// runs again.

// pipeMode is how a pipe compiles.
type pipeMode uint8

const (
	pipeTemp       pipeMode = iota // (topic = left, body)
	pipeSubstitute                 // body, with left where its one topic stands
	pipeByName                     // body, with a program that evaluates left where each topic stands
)

// planPipe decides how pipe compiles.
func (p *plan) planPipe(a *analyzer, pipe *ast.Node) {
	topics := topicsOf(pipe)
	switch {
	case len(topics) != 0 && !slices.ContainsFunc(topics, func(topic *ast.Node) bool { return !a.isByName(topic) }):
		p.pipes[pipe] = pipeByName
	case len(topics) == 1 && topicFirst(a.checker, pipe.AsBinaryExpression().Right, topics[0]):
		p.pipes[pipe] = pipeSubstitute
	default:
		p.pipes[pipe] = pipeTemp
		for _, topic := range topics {
			if closure := topicClosure(pipe, topic); closure != nil && !slices.Contains(p.topicClosures[closure], pipe) {
				p.topicClosures[closure] = append(p.topicClosures[closure], pipe)
			}
		}
	}
}

// topicFirst reports whether evaluating node, which holds topic, always
// evaluates topic, and evaluates nothing before it that the left side could
// change or that could have an effect: only stable values (order.go). A let
// the left side assigns, or a getter, must run after it.
func topicFirst(c *checker.Checker, node, topic *ast.Node) bool {
	if node == topic {
		return true
	}
	if isFunctionBoundary(node) {
		return false // the topic is evaluated when the function runs, if ever
	}
	child := topic
	for child.Parent != node {
		child = child.Parent
	}
	if evaluatedSometimes(node, child) {
		return false
	}
	before := true
	node.ForEachChild(func(operand *ast.Node) bool {
		if operand == child {
			return true
		}
		if evaluatedBefore(node, operand) && !stableValue(c, operand) {
			before = false
			return true
		}
		return false
	})
	return before && topicFirst(c, child, topic)
}

// evaluatedBefore reports whether operand, a child of node before the one
// that holds the topic, is evaluated: not a punctuation or operator token, a
// type, or the name a property access reads.
func evaluatedBefore(node, operand *ast.Node) bool {
	switch {
	case ast.IsTypeNode(operand), ast.IsTokenKind(operand.Kind) && !ast.IsExpression(operand):
		return false
	case ast.IsPropertyAccessExpression(node) && operand == node.Name():
		return false
	}
	return true
}

// evaluatedSometimes reports whether node evaluates child only on some
// paths: a branch of a conditional, the right side of && || ??, or what
// follows ?. in an optional chain.
func evaluatedSometimes(node, child *ast.Node) bool {
	switch {
	case node.Kind == ast.KindConditionalExpression:
		return child != node.AsConditionalExpression().Condition
	case node.Kind == ast.KindBinaryExpression:
		switch node.AsBinaryExpression().OperatorToken.Kind {
		case ast.KindAmpersandAmpersandToken, ast.KindBarBarToken, ast.KindQuestionQuestionToken,
			ast.KindAmpersandAmpersandEqualsToken, ast.KindBarBarEqualsToken, ast.KindQuestionQuestionEqualsToken:
			return child == node.AsBinaryExpression().Right
		}
	case node.Flags&ast.NodeFlagsOptionalChain != 0:
		return child != node.Expression()
	}
	return false
}

// topicClosure returns the expression to rebind topic in when a function in
// pipe's body reads it: the outermost function or class between them, or the
// object literal that holds that function when it is a method. It returns nil
// when no function holds topic.
func topicClosure(pipe, topic *ast.Node) *ast.Node {
	var closure *ast.Node
	for n := topic; n != pipe; n = n.Parent {
		if isFunctionBoundary(n) {
			closure = n
		}
	}
	for closure != nil && !ast.IsExpression(closure) {
		closure = closure.Parent
	}
	return closure
}

// visitPipe lowers left |> body.
func (tx *lowering) visitPipe(node *ast.Node) *ast.Node {
	pipe := node.AsBinaryExpression()
	switch tx.plan.pipes[node] {
	case pipeByName, pipeSubstitute:
		// visitTopic and byNameProgram evaluate the left side where the topic stands.
		return tx.Visitor().VisitNode(pipe.Right)
	}
	f := tx.Factory()
	topic := f.NewUniqueName("topic")
	tx.EmitContext().AddVariableDeclaration(topic)
	left := tx.Visitor().VisitNode(pipe.Left)
	if tx.topicNames == nil {
		tx.topicNames = map[*ast.Node]*ast.IdentifierNode{}
	}
	tx.topicNames[node] = topic
	body := tx.Visitor().VisitNode(pipe.Right)
	delete(tx.topicNames, node)
	assign := f.NewBinaryExpression(nil /*modifiers*/, topic, nil /*typeNode*/, f.NewToken(ast.KindEqualsToken), left)
	sequence := f.NewBinaryExpression(nil /*modifiers*/, assign, nil /*typeNode*/, f.NewToken(ast.KindCommaToken), body)
	lowered := f.NewParenthesizedExpression(sequence)
	tx.EmitContext().SetOriginal(lowered, node)
	return lowered
}

// visitTopic lowers a topic that its pipe evaluates as a value: the left
// side itself, or the variable that holds its value.
func (tx *lowering) visitTopic(node *ast.Node) *ast.Node {
	pipe := pipeOfTopic(node)
	if pipe == nil {
		return node // EK1007
	}
	if tx.plan.pipes[pipe] == pipeSubstitute {
		return tx.Visitor().VisitNode(pipe.AsBinaryExpression().Left)
	}
	if topic := tx.topicNames[pipe]; topic != nil {
		return topic
	}
	return node
}

// visitTopicClosure lowers closure, a function in the body of each of pipes
// that reads its topic, inside an arrow function that takes the topics'
// current values: ((topic_1) => closure)(topic).
func (tx *lowering) visitTopicClosure(closure *ast.Node, pipes []*ast.Node) *ast.Node {
	f := tx.Factory()
	var parameters, arguments []*ast.Node
	outer := map[*ast.Node]*ast.IdentifierNode{}
	for _, pipe := range pipes {
		value := tx.topicNames[pipe]
		if value == nil {
			continue
		}
		inner := f.NewUniqueName("topic")
		outer[pipe] = value
		tx.topicNames[pipe] = inner
		parameters = append(parameters, f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, inner, nil /*questionToken*/, nil /*type*/, nil /*initializer*/))
		arguments = append(arguments, value)
	}
	if tx.rebinding == nil {
		tx.rebinding = map[*ast.Node]bool{}
	}
	tx.rebinding[closure] = true
	visited := tx.visit(closure)
	delete(tx.rebinding, closure)
	for pipe, value := range outer {
		tx.topicNames[pipe] = value
	}
	if len(parameters) == 0 {
		return visited
	}
	arrow := tx.generatedThunk(parameters, visited)
	lowered := f.NewCallExpression(f.NewParenthesizedExpression(arrow), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(lowered, closure)
	return lowered
}
