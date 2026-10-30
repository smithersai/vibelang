package vibelangmapper

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// programCollection converts stored iterable and record elements only when
// the resolved parameter explicitly asks for programs (D49). Literal
// containers keep their element walk, including its by-name boundaries.
func (p *projector) programCollection(node *ast.Node, e env) bool {
	switch node.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindCallExpression:
	default:
		return false
	}
	d := p.forms.Argument(node)
	if d.Call == nil || len(d.Steps) != 0 || d.Class != 0 {
		return false
	}
	r := p.forms.(*Resolver)
	elem, _, ambiguous, _ := r.classAt(d.Call, d.Callee, d.Argument, []PathStep{{Element: true}})
	prop, _, propAmbiguous, _ := r.classAt(d.Call, d.Callee, d.Argument, []PathStep{{Property: ""}})
	if elem != ClassProgram && prop != ClassProgram {
		return false
	}
	if ambiguous || propAmbiguous {
		p.formChoice(node, "Annotate the callee's collection parameter as an iterable or record of Effects; its overloads disagree about program elements.")
		return false
	}
	start := p.tokenStart(node)
	p.plan.mark(editProgramValue, partOpen, start, start, "collection")
	p.visit(node, e)
	p.plan.mark(editProgramValue, partClose, node.End(), node.End(), "collection")
	return true
}

// programPipeArgument uses the first stage's declared data-last signature
// to recognize D8's program input. Unknown stages retain ordinary TypeScript
// checking; no argument-position heuristic decides their input form.
func (p *projector) programPipeArgument(node *ast.Node, e env) bool {
	if !p.programPipeInput(node) {
		return false
	}
	if isLambda(node) && len(node.Parameters()) == 0 {
		p.programLambda(node, false)
	} else if formsHoldsCall(node) {
		p.delayedProgram(node)
	} else {
		return p.programValue(node, Decision{Class: ClassProgram}, e)
	}
	return true
}

// programPipeInput shares the projector's pipe argument routing with the
// editor diagnostic walk, including an undecidable first-stage diagnostic.
func (p *projector) programPipeInput(node *ast.Node) bool {
	d := p.forms.Argument(node)
	if d.Call == nil || d.Argument != 0 || len(d.Steps) != 0 || len(d.Call.Arguments()) < 2 {
		return false
	}
	if d.Callee.Canonical != "effect/Function#pipe" {
		return false
	}

	stage := ast.SkipParentheses(d.Call.Arguments()[1])
	r := p.forms.(*Resolver)
	var candidates []Signature
	program := true
	if stage.Kind == ast.KindCallExpression {
		sigs, _ := r.signaturesOf(r.Callee(stage))
		candidates = formsCandidates(sigs, len(stage.Arguments()))
		for _, s := range candidates {
			program = program && s.DataLast
		}
	} else if root, chain, ok := formsNameChain(stage); ok {
		sigs, _ := r.signaturesOf(r.calleeOf(root, chain, 0))
		candidates = formsCandidates(sigs, 1)
		for _, s := range candidates {
			program = program && s.Param(0).Top == ClassProgram
		}
	}
	if len(candidates) == 0 {
		if p.programInputUnannotated(node) {
			p.formChoice(stage, "Annotate the pipe stage's input as an Effect or a plain function; the mapper cannot decide whether to pass the initial function as a program.")
		}
		return false
	}
	return program
}

// pipeProgramTopic reads only this pipe's topics, including a nested pipe's
// input. The resolver's parameter contracts determine the evaluation boundary.
func (p *projector) pipeProgramTopic(pipe *ast.Node) bool {
	program := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isPipeExpression(n) {
			return visit(n.AsBinaryExpression().Left)
		}
		if formsIsTopic(n) {
			program = program || p.forms.Argument(n).ByName
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(pipe.AsBinaryExpression().Right)
	return program
}

// plainArrayPipeStage recognizes the pinned Array.map/reduce data-last
// calls used as pipe stages. D152's predicateCall handles Effect duals from
// its shared table; Array's ordinary JavaScript forms need only this extra
// pipe boundary to preserve their generic signatures.
func (p *projector) plainArrayPipeStage(call *ast.Node, key string) bool {
	if key != "effect/Array#map" && key != "effect/Array#reduce" {
		return false
	}
	d := p.forms.Argument(call)
	if d.Call == nil || d.Argument == 0 || len(d.Steps) != 0 || d.Callee.Canonical != "effect/Function#pipe" {
		return false
	}
	r := p.forms.(*Resolver)
	candidates := formsCandidates(r.table.Signatures(key), len(call.Arguments()))
	if len(candidates) == 0 {
		return false
	}
	for _, s := range candidates {
		if s.Self {
			return false
		}
	}
	return true
}

// moduleCall visits cold call arguments with the same by-name rules as a
// body call, without running the enclosing module-level call itself.
func (p *projector) moduleCall(call *ast.Node, e env) {
	// D152 also applies to cold calls and plain callbacks outside a hatch.
	// Inside its TypeScript island, keep JavaScript member semantics (D148).
	_, island := p.forms.(*Resolver).inHatch(call)
	parent := call.Parent
	if !island && !(parent != nil && p.isHatchCall(parent) && len(parent.Arguments()) > 0 && parent.Arguments()[0] == call) && p.dataMethod(call, e) {
		return
	}
	if !p.plainBuiltinCall(call) {
		p.visit(call.Expression(), e)
	}
	p.visitList(call.TypeArguments(), e)
	p.callArguments(call, e)
}

// programCallChannels distinguishes yields of composed program functions.
// Otherwise TypeScript can collapse two same-success Effects before $gen
// extracts their errors, losing a pipeline's explicit subtype error union.
// The call-site witness is checking-only; executable editRun stays unchanged.
func (p *projector) programCallChannels(call *ast.Node) string {
	callee := call.Expression()
	if !ast.IsIdentifier(callee) {
		return ""
	}
	r := p.forms.(*Resolver)
	decl := r.binding(callee, callee.Text())
	if decl == nil || !isProjectedFunction(decl) || contractOf(decl.Type()) == contractPlain {
		return ""
	}
	composed := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n != decl.Body() && ast.IsFunctionLike(n) {
			return false
		}
		if n.Kind == ast.KindCallExpression && r.Callee(n).Canonical == "effect/Function#pipe" {
			composed = true
			return false
		}
		if isPipeExpression(n) {
			composed = true
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(decl.Body())
	if composed {
		return "channels " + strconv.Itoa(p.tokenStart(call))
	}
	return ""
}

// programInputUnannotated identifies an undecided parameterless function
// input, following its lexical initializer rather than guessing from its name.
func (p *projector) programInputUnannotated(n *ast.Node) bool {
	n = ast.SkipParentheses(n)
	if isLambda(n) {
		return len(n.Parameters()) == 0 && n.Type() == nil
	}
	if ast.IsIdentifier(n) {
		r := p.forms.(*Resolver)
		if d := r.binding(n, n.Text()); d != nil && d.Kind == ast.KindVariableDeclaration && d.Type() == nil && d.Initializer() != nil {
			init := ast.SkipParentheses(d.Initializer())
			return isLambda(init) && len(init.Parameters()) == 0 && init.Type() == nil
		}
	}
	return false
}

// plainMatchPipeStage keeps the pinned Match stage constructors contextual.
// Running their generic function result through $run instantiates it before
// pipe supplies its input, losing the matcher's remaining union and result.
func (p *projector) plainMatchPipeStage(call *ast.Node, key string) bool {
	switch key {
	case "effect/Match#when", "effect/Match#orElse":
		d := p.forms.Argument(call)
		return d.Call != nil && d.Argument > 0 && len(d.Steps) == 0 && d.Callee.Canonical == "effect/Function#pipe"
	}
	return false
}

// holdsProgram recognizes declared consts (D269) and fields (D265) without a
// checker, using the same parameter, declared-type, and service shapes as
// lambda form resolution. Only the initializer call is cold; its operands
// keep the surrounding evaluation rules.
func (r *Resolver) holdsProgram(expr *ast.Node) bool {
	if decl := HeldConstDeclaration(expr); decl != nil {
		return r.factoryEffectType(decl.Type(), 0) != nil
	}
	node := expr
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	field := node.Parent
	if field == nil || !ast.IsPropertyAssignment(field) || field.Initializer() != node {
		return false
	}
	if d := r.Argument(node); d.Class == ClassProgram {
		return true
	}
	if cls, _, ok := r.annotatedMember(node); ok && cls == ClassProgram {
		return true
	}
	cls, _, ok := r.serviceMember(node)
	return ok && cls == ClassProgram
}

// HeldConstDeclaration returns the const declaration with a declared type
// whose initializer is expr (D269), or nil. Parentheses, a type assertion, a
// satisfies clause and a non-null assertion leave the initializer's value as
// it is, so expr may stand inside them. A conditional's value is one of its
// branches, so expr may also be a branch, though never the condition, which
// the conditional evaluates to choose the branch. A pipe's value is its body's
// (D154), so expr may also be a pipe's body, though never its left side: the
// body builds the program and the left side keeps its parameter position.
// The caller decides whether the declared type is an Effect.
func HeldConstDeclaration(expr *ast.Node) *ast.Node {
	node := expr
	for parent := node.Parent; parent != nil; parent = node.Parent {
		if ast.IsOuterExpression(parent, ast.OEKParentheses|ast.OEKAssertions) ||
			(ast.IsConditionalExpression(parent) && parent.AsConditionalExpression().Condition != node) ||
			(isPipeExpression(parent) && parent.AsBinaryExpression().Right == node) {
			node = parent
			continue
		}
		break
	}
	decl := node.Parent
	if decl == nil || !ast.IsVariableDeclaration(decl) || decl.Initializer() != node || decl.Type() == nil {
		return nil
	}
	if list := decl.Parent; list == nil || list.Kind != ast.KindVariableDeclarationList || list.Flags&ast.NodeFlagsConst == 0 {
		return nil
	}
	return decl
}

// D147: an explicit Effect assertion describes the delayed program, not
// the value returned inside its generator. Non-null wrappers stay transparent.
func (p *projector) delayedProgram(node *ast.Node) {
	subject := ast.SkipParentheses(node)
	for subject.Kind == ast.KindNonNullExpression {
		subject = ast.SkipParentheses(subject.Expression())
	}
	operand := node
	if (subject.Kind == ast.KindAsExpression || subject.Kind == ast.KindTypeAssertionExpression) && p.forms.(*Resolver).isEffectTypeNode(subject.Type(), 0) {
		operand = subject.Expression()
	}
	start := p.tokenStart(operand)
	arg := "expr " + selfArg(operand)
	p.plan.mark(editProgram, partOpen, start, start, arg)
	p.visit(operand, expressionEnv())
	p.plan.mark(editProgram, partClose, operand.End(), operand.End(), arg)
}
