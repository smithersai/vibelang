package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Lambdas (rule 3). A lambda takes the form it is written in (VIP-1, VIP-2):
//
//	plain             (x) => body                  as written
//	Effect function   effect (x) => body           (x) => $gen(function* () { return body })
//	program           effect { body }              $gen(function* () { body })
//
// No position changes a lambda's form, and no argument passes by name.

// isLambda reports whether node is a lambda: an arrow
// function or a function expression written in the source, or a method of
// an object literal, with a body, neither async nor a generator.
func isLambda(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindArrowFunction:
		arrow := node.AsArrowFunction()
		if arrow.EqualsGreaterThanToken == nil || arrow.EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
			return false
		}
	case ast.KindFunctionExpression:
		if node.AsFunctionExpression().AsteriskToken != nil {
			return false
		}
	case ast.KindMethodDeclaration:
		if node.Parent == nil || node.Parent.Kind != ast.KindObjectLiteralExpression || node.AsMethodDeclaration().AsteriskToken != nil {
			return false
		}
	default:
		return false
	}
	return node.Body() != nil && node.Flags&ast.NodeFlagsReparsed == 0 && !ast.HasSyntacticModifier(node, ast.ModifierFlagsAsync)
}

// lambda lowers fn, a lambda, in the form it is written in (VIP-1, VIP-2):
// effect (x) => body is an Effect function, effect { … } is a program, and
// a lambda with no modifier is plain, whatever position it stands in.
func (p *projector) lambda(fn *ast.Node, e env) {
	form := FormPlain
	if fn.Flags&ast.NodeFlagsVibeLangEffect != 0 {
		form = FormEffectFn
		if r := p.forms.(*Resolver); ast.IsArrowFunction(fn) && ast.IsBlock(fn.Body()) && len(fn.Parameters()) == 0 && r.effectBlocks[effectBlockMark(r.file, fn)] {
			form = FormProgram
		}
	}
	if p.lintEffectArrows[p.tokenStart(fn)] {
		// A Lint projection keeps the arrow the keyword was written over.
		form = FormEffectFn
	}
	switch form {
	case FormEffectFn:
		p.effectLambda(fn)
	case FormProgram:
		p.programLambda(fn, false)
	default:
		if contractOf(fn.Type()) == contractPlain {
			p.checkPlainContractEffects(fn)
		}
		p.visitChildren(fn, env{})
	}
}

// choice reports EK9005 at d's node when the rules leave the form to the
// user (Decision.Choice), with the resolver's message.
func (p *projector) choice(d Decision, at *ast.Node) {
	if d.Choice == nil {
		return
	}
	if d.Node != nil {
		at = d.Node
	}
	start := p.tokenStart(at)
	p.diagnostics = append(p.diagnostics, Diagnostic{
		Start:   start,
		Length:  max(at.End()-start, 0),
		Code:    CodeFormChoice,
		Message: d.Choice.Message(),
	})
}

// effectLambda lowers fn in the Effect function form. A block body becomes
// its generator, as a function declaration's does; an expression body is
// the value the generator returns.
func (p *projector) effectLambda(fn *ast.Node) {
	body := fn.Body()
	if body.Kind == ast.KindBlock {
		p.functionLike(fn, body)
		return
	}
	// (x) => expr   (x) => $gen(function* () { return expr })
	fn.ForEachChild(func(child *ast.Node) bool {
		if child != body {
			p.visit(child, env{})
		}
		return false
	})
	if kind := contractOf(fn.Type()); kind == contractInfer {
		p.unprojected(fn.Type())
	}
	arg := "expr"
	if usesThis(body) {
		arg = "expr self"
	}
	start := p.tokenStart(body)
	p.plan.mark(editEffectBody, partOpen, start, start, arg)
	p.visit(body, expressionEnv())
	p.plan.mark(editEffectBody, partClose, body.End(), body.End(), arg)
}

// expressionEnv returns the env of a generator whose body is one
// expression, a lambda's, which owns its forks as a block body does (D353).
func expressionEnv() env {
	e := newEffectEnv()
	e.frame.expression = true
	return e
}

// programLambda lowers fn, a lambda without parameters, in the program
// form: the lambda becomes its generator, an Effect value; with dual, an
// Effect value that is also a function returning it.
func (p *projector) programLambda(fn *ast.Node, dual bool) {
	body := fn.Body()
	start := p.tokenStart(fn)
	bodyStart := p.tokenStart(body)
	arg := ""
	if body.Kind != ast.KindBlock {
		arg = "expr"
	}
	if usesThis(body) {
		arg += " self"
	}
	if dual {
		p.plan.mark(editDual, partOpen, start, start, "")
	}
	p.plan.mark(editProgram, partOpen, start, bodyStart, arg)
	if body.Kind == ast.KindBlock {
		p.visitList(body.Statements(), newEffectEnv())
	} else {
		p.visit(body, expressionEnv())
	}
	p.plan.mark(editProgram, partClose, fn.End(), fn.End(), arg)
	if dual {
		p.plan.mark(editDual, partClose, fn.End(), fn.End(), "")
	}
}

// blockArgument returns call's block param, the arrow the parser writes for
// `f(args) { block }` (D188, D376), or nil.
func blockArgument(call *ast.Node) *ast.Node {
	arguments := call.Arguments()
	if len(arguments) == 0 {
		return nil
	}
	last := arguments[len(arguments)-1]
	if last.Kind != ast.KindArrowFunction || last.Body() == nil || last.Body().Kind != ast.KindBlock {
		return nil
	}
	arrow := last.AsArrowFunction().EqualsGreaterThanToken
	if arrow == nil || arrow.Flags&ast.NodeFlagsReparsed == 0 || len(last.Parameters()) != 0 {
		return nil
	}
	return last
}

// blockCall lowers call, `f(args) { block }`, with its block as the call's
// last argument, `f(args, block)` (D376). The block takes the form the
// resolver decides.
func (p *projector) blockCall(call *ast.Node, block *ast.Node, e env) {
	d := p.forms.Block(call)
	p.choice(d, block)
	arguments := call.Arguments()
	written := arguments[:len(arguments)-1]
	body := block.Body()
	brace := p.tokenStart(body)
	closing := body.End() - 1
	if brace >= len(p.text) || p.text[brace] != '{' || p.text[closing] != '}' {
		p.unprojected(block)
		return
	}
	// The source's own ) before the block, or -1 for `f { block }`.
	paren := -1
	for i := brace - 1; i >= 0; i-- {
		if c := p.text[i]; c == ' ' || c == '\t' {
			continue
		} else if c == ')' {
			paren = i
		}
		break
	}
	for _, argument := range written {
		p.callArgument(argument, e)
	}
	var open string
	switch {
	case paren < 0:
		open = "("
	case len(written) > 0:
		open = ", "
	default:
		open = ""
	}
	from := brace
	if paren >= 0 {
		from = paren
	}
	p.plan.replace(from, brace, open)
	form := d.Form
	switch form {
	case FormEffectFn:
		p.plan.mark(editEffectBody, partOpen, brace, brace, "block "+selfArg(body))
		p.visitList(body.Statements(), newEffectEnv())
		p.plan.mark(editEffectBody, partClose, block.End(), block.End(), "block")
	case FormProgram, FormDual:
		if form == FormDual {
			p.plan.mark(editDual, partOpen, brace, brace, "")
		}
		p.plan.mark(editProgram, partOpen, brace, brace, selfArg(body))
		p.visitList(body.Statements(), newEffectEnv())
		p.plan.mark(editProgram, partClose, block.End(), block.End(), "")
		if form == FormDual {
			p.plan.mark(editDual, partClose, block.End(), block.End(), "")
		}
	default:
		p.plan.insert(brace, "() => ")
		p.visitList(body.Statements(), env{trailingBlock: true})
	}
	p.plan.insert(block.End(), ")")
}

// callArguments walks call's arguments: a block param where the resolver
// places it, and an argument its callee takes by name
// as a program. It reports whether it lowered a block param, which closes
// the call itself.
func (p *projector) callArguments(call *ast.Node, e env) bool {
	if block := blockArgument(call); block != nil {
		p.blockCall(call, block, e)
		return true
	}
	for _, argument := range call.Arguments() {
		p.callArgument(argument, e)
	}
	return false
}

// callArgument follows literal containers to the resolver's element and
// property paths. APIs such as Effect.all take programs inside a container;
// visiting only its outer array would run those programs before the API.
func (p *projector) callArgument(argument *ast.Node, e env) {
	// An argument is the value written: no position makes it a program. The
	// walk still follows literal containers itself, so a pattern holder in
	// one is visited whole.
	if argument.Flags&ast.NodeFlagsVibeLangTry != 0 {
		// A written try marks the whole argument, parentheses included.
		p.visit(argument, e)
		return
	}
	if argument.Kind == ast.KindParenthesizedExpression && p.isMatchForm(argument) {
		// A pattern holder spans the complete written is expression. Its
		// generated tests may share an earlier span; unwrapping the holder
		// would visit those tests as independent source edits.
		p.visit(argument, e)
		return
	}
	switch argument.Kind {
	case ast.KindParenthesizedExpression, ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindNonNullExpression:
		p.callArgument(argument.Expression(), e)
		if argument.Type() != nil {
			p.visit(argument.Type(), env{})
		}
	case ast.KindArrayLiteralExpression:
		for _, element := range argument.Elements() {
			p.callArgument(element, e)
		}
	case ast.KindObjectLiteralExpression:
		p.rememberComputedNames(argument, e)
		for _, property := range argument.Properties() {
			if property.Kind == ast.KindPropertyAssignment {
				p.visit(property.Name(), e)
				p.callArgument(property.Initializer(), e)
			} else {
				p.visit(property, e)
			}
		}
	default:
		p.visit(argument, e)
	}
}
