package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// isCatchExpression recognizes the parser's D236 call, rather than a
// source function that happens to be named $catchExpression. Its two
// arguments are thunks: the left side and a fallback or written handler.
func isCatchExpression(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || len(node.Arguments()) != 2 {
		return false
	}
	callee := node.Expression()
	return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$catchExpression"
}

// catchExpression runs the left side inside $catch and defers the fallback
// until an expected failure (D236-D238). Program and Effect-body edits keep
// both renderings' generator boundaries and preserve the handler's contextual
// error type. No completion records are needed for expression values.
func (p *projector) catchExpression(call *ast.Node, e env) {
	if _, hatch := p.forms.(*Resolver).inHatch(call); hatch {
		return
	}
	start := p.tokenStart(call)
	if !e.effect {
		p.diagnostics = append(p.diagnostics, Diagnostic{
			Start: start, Length: call.End() - start, Code: 1001,
			Message: "A catch expression runs a program. Move it into an Effect function with an explicit contract.",
		})
	} else {
		if p.statementStarts[start] {
			p.plan.insert(start, ";")
			delete(p.statementStarts, start)
		}
		p.plan.mark(editRun, partOpen, start, start, "")
	}
	p.plan.insert(start, helperRef("$catch")+"(")
	left, handler := call.Arguments()[0].Body(), call.Arguments()[1]
	p.catchProgram(left)
	if handler.Kind == ast.KindArrowFunction && handler.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
		fallback := handler.Body()
		p.plan.replace(left.End(), p.tokenStart(fallback), ", () => ")
		p.catchProgram(fallback)
	} else {
		p.plan.replace(left.End(), p.tokenStart(handler), ", ")
		p.effectLambda(handler)
		if handler.End() < call.End() {
			// The arrow keeps its handler kind; its source parentheses are
			// outside its AST range and must not close the generated call.
			p.plan.replace(handler.End(), call.End(), "")
		}
	}
	p.plan.insert(call.End(), ")")
	if e.effect {
		p.plan.mark(editRun, partClose, call.End(), call.End(), "")
	}
}

// checkCatchExpressionHatches reports D239 independently of lowering, so
// unsupported enclosing forms cannot hide an illegal catch in TypeScript.
func (p *projector) checkCatchExpressionHatches() {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isCatchExpression(node) {
			if _, hatch := p.forms.(*Resolver).inHatch(node); hatch {
				p.diagnostics = append(p.diagnostics, Diagnostic{
					Start: p.tokenStart(node.Expression()), Length: len("catch"), Code: 2114,
					Message: "A catch expression is VibeLang syntax, but a hatch body is plain TypeScript. Move the catch out of the hatch, or use a try statement inside it.",
				})
			}
		}
		return node.ForEachChild(visit)
	}
	visit(p.file.AsNode())
}

// catchProgram makes an operand a lazy program, preserving this and keeping
// its calls and failures inside the catch rather than at the enclosing call.
func (p *projector) catchProgram(operand *ast.Node) {
	start := p.tokenStart(operand)
	arg := "expr " + selfArg(operand)
	callee := p.catchNarrowingCallee(operand)
	witness := ""
	if callee != nil {
		// A checking-only IIFE reads the callee's type in the enclosing flow,
		// before the generator boundary. Its default parameter retains that
		// type inside the generator; execution keeps the original property
		// read, receiver, and evaluation order (including getters).
		witness = p.names.fresh("$catchCallee")
		p.names.words[witness] = true
		p.plan.witness(start, "(("+witness+" = "+p.text[p.tokenStart(callee):callee.End()]+") => ")
	}
	p.plan.mark(editProgram, partOpen, start, start, arg)
	p.visit(operand, expressionEnv())
	if callee != nil {
		// Record these after visiting so the cast opens inside the call's
		// $run, not around its success value. Outer catch witnesses close
		// last when catch operands nest, retaining the outer guard's type.
		p.plan.witness(p.tokenStart(callee), "(")
		p.plan.witness(callee.End(), " as typeof "+witness+")")
	}
	p.plan.mark(editProgram, partClose, operand.End(), operand.End(), arg)
	if callee != nil {
		p.plan.witness(operand.End(), ")()")
	}
}

// catchNarrowingCallee finds an optional function property read first by this
// operand, possibly through nested catches. The written local shape proves
// that the property exists and is callable. Restricting the witness to this
// first callee avoids moving type reads across assignments, conditionals or
// user callbacks inside the operand. Fallbacks retain their own arrow's flow.
func (p *projector) catchNarrowingCallee(operand *ast.Node) *ast.Node {
	operand = ast.SkipParentheses(operand)
	for isCatchExpression(operand) {
		operand = ast.SkipParentheses(operand.Arguments()[0].Body())
	}
	if !ast.IsCallExpression(operand) || operand.QuestionDotToken() != nil {
		return nil
	}
	callee := ast.SkipParentheses(operand.Expression())
	if !ast.IsAccessExpression(callee) || callee.QuestionDotToken() != nil || !ast.IsIdentifier(callee.Expression()) {
		return nil
	}
	name := ""
	if ast.IsPropertyAccessExpression(callee) {
		name = callee.Name().Text()
	} else if key := callee.AsElementAccessExpression().ArgumentExpression; ast.IsStringLiteral(key) {
		name = key.Text()
	} else {
		return nil
	}
	r := p.forms.(*Resolver)
	shape := r.typeLiteral(p.dataReceiverType(callee.Expression(), 0), 0)
	if shape == nil {
		return nil
	}
	for _, member := range shape.Members() {
		key, ok := formsPropertyName(member)
		if !ok || key != name || member.QuestionToken() == nil {
			continue
		}
		class := r.classOfType(member.Type(), 0)
		if class&(ClassPlainFn|ClassEffectFn) != 0 && class&ClassProgram == 0 {
			return callee
		}
	}
	return nil
}
