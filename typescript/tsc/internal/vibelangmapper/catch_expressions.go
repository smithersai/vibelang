package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

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

// catchExpression passes the evaluated left operand to $catch. Construction
// and written execution in that operand stay in the enclosing activation;
// $catch runs the resulting Effect and invokes its handler only on failure.
func (p *projector) catchExpression(call *ast.Node, e env) {
	if _, hatch := p.forms.(*Resolver).inHatch(call); hatch {
		return
	}
	start := p.tokenStart(call)
	if e.effect {
		if p.statementStarts[start] {
			p.plan.insert(start, ";")
			delete(p.statementStarts, start)
		}
		p.plan.mark(editRun, partOpen, start, start, "")
	}
	p.plan.insert(start, helperRef("$catch")+"(")
	left, handler := call.Arguments()[0].Body(), call.Arguments()[1]
	operandEnv := e
	operandEnv.holdCalls = true
	p.visit(left, operandEnv)
	if handler.Kind == ast.KindArrowFunction && handler.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
		fallback := handler.Body()
		p.plan.replace(left.End(), p.tokenStart(fallback), ", () => ")
		p.catchProgram(fallback)
	} else {
		p.plan.replace(left.End(), p.tokenStart(handler), ", ")
		if handler.Flags&ast.NodeFlagsVibeLangEffect != 0 {
			p.effectLambda(handler)
		} else {
			p.plainCatchHandler(handler)
		}
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

// checkSourceCatchPlacement runs before inferred lowering forms can change
// the execution environment. Catch placement is owned by source syntax.
func (p *projector) checkSourceCatchPlacement() {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isCatchExpression(node) {
			_, hatch := p.forms.(*Resolver).inHatch(node)
			if !hatch && !sourceCatchEffectCode(node) {
				p.diagnostics = append(p.diagnostics, Diagnostic{
					Start: p.tokenStart(node.Expression()), Length: len("catch"), Code: 504,
					Message: "Catch outside effect code. Run an Effect with try inside effect code; use a function literal as the catch handler.",
				})
			}
		}
		return node.ForEachChild(visit)
	}
	p.file.AsNode().ForEachChild(visit)
}

func sourceCatchProgramArrow(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindArrowFunction &&
		node.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0
}

// Synthetic immediate calls and the left operand thunk do not introduce
// a callable boundary in the authored program.
func sourceCatchTransparentFunction(fn *ast.Node) bool {
	if isCatchExpression(fn.Parent) && fn.Parent.Arguments()[0] == fn {
		return true
	}
	if !sourceCatchProgramArrow(fn) {
		return false
	}
	parent := fn.Parent
	return parent != nil && ast.IsParenthesizedExpression(parent) && parent.Parent != nil &&
		ast.IsCallExpression(parent.Parent) && parent.Parent.Expression() == parent
}

func sourceCatchDecoratedClass(class *ast.Node) bool {
	if ast.HasDecorators(class) {
		return true
	}
	for _, member := range class.Members() {
		if ast.HasDecorators(member) {
			return true
		}
		if ast.IsFunctionLike(member) {
			for _, parameter := range member.Parameters() {
				if ast.HasDecorators(parameter) {
					return true
				}
			}
		}
	}
	return false
}

func sourceCatchOwner(node *ast.Node) *ast.Node {
	child := node
	for parent := node.Parent; parent != nil; child, parent = parent, parent.Parent {
		if ast.IsComputedPropertyName(child) && ast.IsFunctionLike(parent) &&
			parent.Parent != nil && ast.IsObjectLiteralExpression(parent.Parent) {
			continue
		}
		if ast.IsExpressionWithTypeArguments(parent) && parent.Parent != nil &&
			ast.IsHeritageClause(parent.Parent) && child != parent.Expression() {
			return nil
		}
		if ast.IsClassLike(parent) && ast.IsHeritageClause(child) &&
			child.AsHeritageClause().Token == ast.KindExtendsKeyword {
			continue
		}
		if ast.IsComputedPropertyName(child) && ast.IsClassElement(parent) && parent.Name() == child &&
			parent.Parent != nil && ast.IsClassLike(parent.Parent) && !sourceCatchDecoratedClass(parent.Parent) {
			parent = parent.Parent
			continue
		}
		boundary := ast.IsFunctionLike(parent) || ast.IsClassLike(parent) ||
			parent.Kind == ast.KindClassStaticBlockDeclaration || parent.Kind == ast.KindEnumDeclaration
		if !boundary || sourceCatchTransparentFunction(parent) {
			continue
		}
		if ast.IsFunctionLike(parent) && parent.Body() != nil && parent.Body() == child {
			return parent
		}
		return nil
	}
	return nil
}

func sourceCatchEffectCode(node *ast.Node) bool {
	owner := sourceCatchOwner(node)
	if owner == nil {
		return false
	}
	if owner.Flags&ast.NodeFlagsVibeLangEffect != 0 {
		return true
	}
	if !sourceCatchProgramArrow(owner) {
		return false
	}
	// Retired trailing-block recovery can still hold an explicit program.
	// Ordinary source functions never acquire effect ownership by inference.
	if call := owner.Parent; call != nil && ast.IsCallExpression(call) {
		args := call.Arguments()
		if len(args) > 0 && args[len(args)-1] == owner && len(owner.Parameters()) == 0 &&
			owner.Body() != nil && owner.Body().Kind == ast.KindBlock {
			text := ast.GetSourceFileOfNode(owner).Text()
			start := scanner.SkipTrivia(text, owner.Pos())
			if start < len(text) && text[start] == '{' {
				return true
			}
		}
	}
	return sourceCatchEffectCode(owner)
}

// plainCatchHandler keeps the written function and lifts only its result.
// The wrapper's arrow leaves the source handler's lexical captures intact.
func (p *projector) plainCatchHandler(handler *ast.Node) {
	errorName := p.names.fresh("$catchError")
	valueParameters := 0
	for _, parameter := range handler.Parameters() {
		if !ast.IsThisParameter(parameter) {
			valueParameters++
		}
	}
	if valueParameters == 0 {
		// A callback with no written parameters still receives the error.
		// Give the call an argument type without changing the source function.
		handlerName := p.names.fresh("$catchHandler")
		resultName := p.names.fresh("$catchResult")
		p.plan.insert(p.tokenStart(handler), "("+errorName+" => "+p.names.prelude("Effect")+".succeed((<"+resultName+",>("+handlerName+": (error: typeof "+errorName+") => "+resultName+") => "+handlerName+"("+errorName+"))(")
		p.visitChildren(handler, env{})
		p.plan.insert(handler.End(), ")))")
		return
	}
	p.plan.insert(p.tokenStart(handler), "("+errorName+" => "+p.names.prelude("Effect")+".succeed((")
	p.visitChildren(handler, env{})
	p.plan.insert(handler.End(), ")("+errorName+")))")
}
