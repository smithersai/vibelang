package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Forms (rule 3: form resolution, L1). A lambda, a block param, and an
// argument a callee takes by name each take the form the forms resolver
// decides from the file's syntax and the generated forms table
// (forms_resolve.go):
//
//	plain             (x) => body                  as written
//	Effect function   (x) => body                  (x) => $gen(function* () { return body })
//	program           () => body                   $gen(function* () { return body })
//	dual              () => body                   $dual($gen(function* () { return body }))
//
// The dual is a parameterless lambda that is both a program and a function
// that returns it; the prelude types it Effect<A, E, R> & (() => Effect<A, E, R>).
// Where the rules cannot decide (Decision.Choice), the projector reports
// EK9100 with the resolver's message and lowers the default's guess.

// isLambda reports whether node is a lambda the forms decide: an arrow
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

// lambda lowers fn, a lambda, to the form the resolver decides for it.
func (p *projector) lambda(fn *ast.Node, e env) {
	d := p.forms.Lambda(fn)
	form := d.Form
	if p.d4ServiceMember(fn) || p.providedMember(fn) && contractOf(fn.Type()) != contractPlain {
		// D173 gives the implementation the service member form, including pure methods.
		form = FormEffectFn
	} else {
		p.choice(d, fn)
	}

	if form == FormPlain && d.Call == nil && d.Provenance == FromFallback && fn.Type() == nil && p.keyLookupLambda(fn) {
		form = FormEffectFn
	}
	if form == FormProgram && len(fn.Parameters()) > 0 {
		// A program takes no arguments; one written with parameters is an
		// Effect function, which TypeScript then reports at the position.
		form = FormEffectFn
	}
	if fn.Kind == ast.KindMethodDeclaration && (form == FormProgram || form == FormDual) {
		form = FormEffectFn
	}
	if form == FormDual && d.Call == nil {
		// A dual no call takes is a function value, as the fork types it:
		// returned or bound, it reads as () => Effect<A, E, R>.
		form = FormEffectFn
	}
	if p.lintEffectArrows[p.tokenStart(fn)] {
		form = FormEffectFn
	}
	switch form {
	case FormFactory:
		p.rejectFactoryCallback(fn, p.forms.Argument(fn))
		p.factory(fn)
	case FormEffectFn:
		p.effectLambda(fn)
	case FormProgram, FormDual:
		p.programLambda(fn, form == FormDual)
	default:
		if contractOf(fn.Type()) == contractPlain || d.Provenance == FromAnnotation || d.Provenance == FromService {
			p.checkPlainContractEffects(fn)
		}
		p.plainLambda(fn)
	}
}

// plainLambda unwraps a contract's success channel when the receiving
// position requires a plain callback (D9/D67). Keeping Effect here would
// promise a program even though the plain body returns its success value.
func (p *projector) plainLambda(fn *ast.Node) {
	ret := fn.Type()
	if ret == nil || !(isEffectType(ret) || isWrittenEffectReference(ret)) || len(ret.TypeArguments()) == 0 {
		p.visitChildren(fn, env{})
		return
	}
	success := ret.TypeArguments()[0]
	if success.Kind == ast.KindInferType {
		p.plan.replace(p.colonBefore(ret), ret.End(), "")
	} else {
		p.plan.replace(p.tokenStart(ret), p.tokenStart(success), "")
		p.visit(success, env{})
		p.plan.replace(success.End(), ret.End(), "")
	}
	fn.ForEachChild(func(child *ast.Node) bool {
		if child != ret {
			p.visit(child, env{})
		}
		return false
	})
}

// providedMember recognizes direct methods and function-valued properties of
// a D173 provider, without treating nested objects as service implementations.
func (p *projector) providedMember(fn *ast.Node) bool {
	member := fn
	if fn.Parent != nil && fn.Parent.Kind == ast.KindPropertyAssignment && fn.Parent.Initializer() == fn {
		member = fn.Parent
	}
	object := member.Parent
	return object != nil && object.Kind == ast.KindObjectLiteralExpression && object.Parent != nil && isProvideService(object.Parent) && object.Parent.Arguments()[2] == object
}

// choice reports EK9100 at d's node when the rules leave the form to the
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
	p.callbackParameters(fn)
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

// byNameArgument lowers argument, an argument of a call in any context,
// to a program when its callee takes it by name (D147): the expression runs
// when the callee runs the program, not where the call stands.
func (p *projector) byNameArgument(argument *ast.Node, e env) bool {
	if isLambda(argument) || formsIsTopic(argument) || argument.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	d := p.forms.Argument(argument)
	if !d.ByName {
		return p.programValue(argument, d, e)
	}
	// D265 holds only an initializer call. A compound field initializer
	// still needs D147's delayed body, including an absent conditional arm.
	// Named function values keep D7's conversion above.
	subject := ast.SkipParentheses(argument)
	if (ast.IsCallExpression(subject) || ast.IsTaggedTemplateExpression(subject)) && p.forms.(*Resolver).holdsProgram(argument) {
		p.visit(argument, e)
		return true
	}
	p.delayedProgram(argument)
	return true
}

// programValue lowers argument, a name or a member at a position that takes
// a program (D7). Known plain functions use Effect.sync, preserving D24 data
// results; other values use $asProgram and keep their existing form.
func (p *projector) programValue(argument *ast.Node, d Decision, e env) bool {
	p.rejectFactoryCallback(argument, d)
	if d.Class&ClassProgram == 0 || d.Class&(ClassEffectFn|ClassPlainFn) != 0 {
		return false
	}
	switch argument.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression:
	default:
		return false
	}
	kind := ""
	if ast.IsIdentifier(argument) {
		r := p.forms.(*Resolver)
		fn := r.binding(argument, argument.Text())
		if fn != nil && ast.IsVariableDeclaration(fn) && fn.Initializer() != nil {
			fn = ast.SkipParentheses(fn.Initializer())
		}
		if fn != nil && ast.IsFunctionLike(fn) && len(fn.TypeParameters()) == 0 {
			zero := true
			for _, parameter := range fn.Parameters() {
				if parameter.Initializer() == nil && parameter.QuestionToken() == nil && parameter.AsParameterDeclaration().DotDotDotToken == nil {
					zero = false
				}
			}
			plain := isLambda(fn) && r.Lambda(fn).Form == FormPlain || fn.Kind == ast.KindFunctionDeclaration && fn.Type() != nil && contractOf(fn.Type()) == contractPlain
			if zero && plain {
				kind = "plain"
			}
		}
	}
	start := p.tokenStart(argument)
	p.plan.mark(editProgramValue, partOpen, start, start, kind)
	p.visit(argument, e)
	p.plan.mark(editProgramValue, partClose, argument.End(), argument.End(), kind)
	return true
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
		p.visitList(body.Statements(), env{})
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
	// D268 adapts imported values only in plain callback positions. The
	// phantom brand selects the type; the runtime marker alone selects the call.
	// Known Effect imports have no brand: leave generic stages in their
	// contextual position rather than introducing an inference boundary.
	root := argument
	for ast.IsPropertyAccessExpression(root) {
		root = root.Expression()
	}
	if ast.IsIdentifier(root) && p.names.importedFrom[root.Text()] != "" && !p.isEffectImport(root.Text()) && p.forms.Argument(argument).Class == ClassPlainFn {
		p.plan.insert(p.tokenStart(argument), helperRef("$adapt")+"(")
		p.plan.insert(argument.End(), ")")
		return
	}
	if p.programPipeArgument(argument, e) || p.programCollection(argument, e) || p.byNameArgument(argument, e) {
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
		for _, property := range argument.Properties() {
			if property.Kind == ast.KindPropertyAssignment {
				p.visit(property.Name(), e)
				p.callArgument(property.Initializer(), e)
			} else if property.Kind == ast.KindShorthandPropertyAssignment && p.forms.Argument(property.Name()).Class&ClassProgram != 0 {
				p.plan.insert(p.tokenStart(property), property.Name().Text()+": ")
				p.callArgument(property.Name(), e)
			} else {
				p.visit(property, e)
			}
		}
	default:
		p.visit(argument, e)
	}
}

// d4ServiceMember preserves D4's bare Effect type in a local service's
// written contract even when a value import also binds the name Effect.
// The forms resolver resolves that import as a namespace; projection of
// the declaration already treats its bare type spelling as the D4 alias.
func (p *projector) d4ServiceMember(fn *ast.Node) bool {
	if !p.names.shadowsPreludeType("Effect") {
		return false
	}
	member, object := fn, fn.Parent
	if object != nil && object.Kind == ast.KindPropertyAssignment && object.Initializer() == fn {
		member, object = object, object.Parent
	}
	if object == nil || object.Kind != ast.KindObjectLiteralExpression {
		return false
	}
	resolver, ok := p.forms.(*Resolver)
	if !ok {
		return false
	}
	key := resolver.providedKey(object)
	if key == nil || !ast.IsIdentifier(key) {
		return false
	}
	service := resolver.serviceClassOf(key)
	if service == nil || member.Name() == nil {
		return false
	}
	for _, declaration := range service.Members() {
		if declaration.Name() != nil && declaration.Name().Text() == member.Name().Text() && ast.IsMethodDeclaration(declaration) {
			ret := declaration.Type()
			return ret != nil && isWrittenEffectReference(ret) && ret.AsTypeReferenceNode().TypeName.Kind == ast.KindIdentifier
		}
	}
	return false
}
