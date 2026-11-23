package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// isPipeExpression recognizes the parser's D154 binary node. The body can
// hold a catch expression (D237), whose thunks must see the same topic.
func isPipeExpression(node *ast.Node) bool {
	return node.Kind == ast.KindBinaryExpression && node.Flags&ast.NodeFlagsVibeLang != 0 && node.AsBinaryExpression().OperatorToken.Kind == ast.KindBarToken
}

// pipeExpression binds a lexical topic: a value evaluated once, or a cold
// program at a by-name parameter. Each execution owns its binding, so nested
// thunks and returned lambdas retain the evaluation that created them.
func (p *projector) pipeExpression(node *ast.Node, e env) {
	binary := node.AsBinaryExpression()
	if ast.NodeIsMissing(binary.Left) || ast.NodeIsMissing(binary.Right) {
		// Parser recovery uses zero-width operands. Replacing their surrounding
		// tokens would overlap the wrapper inserted at the same position. Keep
		// this incomplete expression verbatim for the host's syntax diagnostics,
		// while still lowering the valid statements that follow it.
		return
	}
	if !p.pipeValueTopics(node) {
		return
	}

	if p.pipeTopics == nil {
		p.pipeTopics = map[*ast.Node]string{}
	}
	topic := p.freshWord("$topic")
	p.names.words[topic] = true
	p.pipeTopics[node] = topic
	if p.ctx.Lint && !e.effect {
		// No function boundary: the input may hold a yield or an await, and a
		// linter reads no scope into the name it never sees reported.
		start := p.tokenStart(node)
		p.plan.insert(start, "("+topic+" = ")
		p.visit(binary.Left, e)
		p.plan.replace(binary.Left.End(), p.tokenStart(binary.Right), ", ")
		p.visit(binary.Right, e)
		p.plan.insert(node.End(), ")")
		return
	}
	start := p.tokenStart(node)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	if e.effect {
		p.plan.mark(editRun, partOpen, start, start, "")
		p.plan.mark(editProgram, partOpen, start, start, selfArg(node))
	} else {
		p.plan.insert(start, "(() => ")
	}
	p.plan.insert(start, "{ const "+topic+" = ")
	// The input is the value written, evaluated once where the pipe stands.
	p.visit(binary.Left, e)
	p.plan.replace(binary.Left.End(), p.tokenStart(binary.Right), "; return ")
	p.visit(binary.Right, e)
	p.plan.insert(node.End(), " }")
	if e.effect {
		p.plan.mark(editProgram, partClose, node.End(), node.End(), "")
		p.plan.mark(editRun, partClose, node.End(), node.End(), "")
	} else {
		p.plan.insert(node.End(), ")()")
	}
}

// pipeValueTopics checks that the pipe's body uses its topic (EK2301). A
// topic is always the input's value: no parameter makes it a program.
func (p *projector) pipeValueTopics(pipe *ast.Node) bool {
	topics := 0
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isPipeExpression(node) {
			// Topics in a nested pipe's input still belong to this pipe.
			return visit(node.AsBinaryExpression().Left)
		}
		if formsIsTopic(node) {
			topics++
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(pipe.AsBinaryExpression().Right)
	if topics == 0 {
		p.diagnostics = append(p.diagnostics, Diagnostic{
			Start: p.tokenStart(pipe.AsBinaryExpression().OperatorToken), Length: len("|>"), Code: 2301,
			Message: "A pipe body must use its topic (%); the input value would otherwise be discarded.",
		})
		return false
	}
	return true
}

// pipeTopic resolves % through the syntax tree, so a topic in a nested
// pipe's input still belongs to the outer pipe and catch thunks keep scope.
func (p *projector) pipeTopic(node *ast.Node) {
	for n := node; n.Parent != nil; n = n.Parent {
		if isPipeExpression(n.Parent) && n.Parent.AsBinaryExpression().Right == n {
			if topic := p.pipeTopics[n.Parent]; topic != "" {
				p.plan.replace(p.tokenStart(node), node.End(), topic)
				return
			}
		}
	}
	p.unprojected(node)
}
