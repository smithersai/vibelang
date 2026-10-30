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
	byName := p.pipeProgramTopic(node)
	if byName {
		p.delayedProgram(binary.Left)
	} else {
		p.visit(binary.Left, e)
	}
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

// pipeValueTopics validates the topic boundary before recording edits. Mixed
// value/program uses and opaque parameter contracts need an annotation rather
// than silently evaluating the input at the wrong time.
func (p *projector) pipeValueTopics(pipe *ast.Node) bool {
	r := p.forms.(*Resolver)
	ok := true
	topics := 0
	program, value := false, false
	var valueTopic *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isPipeExpression(node) {
			// Topics in a nested pipe's input still belong to this pipe.
			return visit(node.AsBinaryExpression().Left)
		}
		if formsIsTopic(node) {
			topics++
			d := p.forms.Argument(node)
			if d.ByName {
				program = true
			} else {
				value = true
				if valueTopic == nil {
					valueTopic = node
				}
			}
			if d.Call != nil {
				sigs, _ := r.signaturesOf(d.Callee)
				if d.Ambiguous || len(formsCandidates(sigs, len(d.Call.Arguments()))) == 0 {
					p.formChoice(node, "The mapper cannot decide whether this pipe topic is a value or a program. Annotate the callee's parameter, or bind the input to an explicitly annotated value before the pipe.")
					ok = false
				}
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(pipe.AsBinaryExpression().Right)
	if topics == 0 {
		p.diagnostics = append(p.diagnostics, Diagnostic{
			Start: p.tokenStart(pipe.AsBinaryExpression().OperatorToken), Length: len("|>"), Code: 1006,
			Message: "A pipe body must use its topic (%); the input value would otherwise be discarded.",
		})
		return false
	}
	if program && value {
		// D155 requires a running left side before a topic can pass it by
		// name. An opaque call does not prove that native condition.
		left := pipe.AsBinaryExpression().Left
		if pauses, _ := p.runningExpressionCalls(left); ok && pauses {
			text := p.text[p.tokenStart(left):left.End()]
			p.fiberDiagnostic(valueTopic, 1008, "% stands for "+text+", which this pipe passes by name to a program elsewhere, so it cannot also be a value here.")
		} else {
			p.formChoice(pipe, "A pipe cannot use its topic as both a program and a value; bind an explicitly annotated value or split the pipe.")
		}
		return false
	}
	return ok
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
