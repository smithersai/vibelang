package parser

import (
	"slices"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A return in a do expression in a parameter default acts as return at the
// top of the body (VIP-2): a plain function returns the value, an async
// function fulfills with it and an effect function's call gives an Effect
// that succeeds with it, before later defaults or the body run. Chapter
// 002, "Destructuring and parameter defaults", keeps the parameter list's
// own semantics: defaults run in order, a default reads a later parameter in
// its temporal dead zone, and a closure in a default shares the body's
// binding.
//
// The parameter list stays the function's signature, so its length and its
// declaration output do not change. Defaults in its simple-parameter suffix
// move together, including earlier defaults that can capture a later
// parameter. The statement lowering lifts their do expressions:
//
//	function f(a: number = do { return 9 }, b = g()) { body }
//
//	function f(a: number = (void 0)!, b = (void 0)!) {
//	  const $parameter1 = a, $parameter2 = b
//	  {
//	    let a: typeof $parameter1 = $parameter1 !== void 0 ? $parameter1 : do { return 9 }
//	    let b = $parameter2 !== void 0 ? $parameter2 : g()
//	    { body }
//	  }
//	}
//
// The declarations bind the names in order into fresh let bindings, so a
// later parameter is in its temporal dead zone while an earlier default runs,
// and the body, in its own block, cannot shadow a name a default reads. A
// parameter without a type takes the type of its moved default
// (VibeLangMovedParameterDefault). An effect function's lowering runs the
// moved defaults at the call, before Effect.gen, and returns Effect.succeed
// of a returned value (vibelang/effect_parameters_lower.go,
// VibeLangHasMovedDefaults); a producer's lowering likewise returns an empty
// Stream (vibelang/producers.go). Generators, constructors, a
// parameter list with a binding pattern from the returning default on or
// combining a binding pattern with a rest parameter, and a default that
// suspends (try, await or yield,
// which a parameter list cannot do) keep the do expression as a function and
// its EK0204.
var movedParameterDefaultsKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()
var movedDefaultParametersKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()
var movedDefaultFunctionsKey = ast.NewSourceFileDataKey[map[*ast.Node]bool]()

// VibeLangHasMovedDefaults reports whether fn's body begins with moved
// parameter defaults: `{ temps…; { shadows…; { body } } }`.
func VibeLangHasMovedDefaults(fn *ast.Node) bool {
	if fn == nil {
		return false
	}
	file := ast.GetSourceFileOfNode(fn)
	if file == nil {
		return false
	}
	return file.GetOrComputeData(movedDefaultFunctionsKey, func(*ast.SourceFile) map[*ast.Node]bool { return nil })[fn]
}

// VibeLangMovedDefaultsSourceBody returns the source body nested after moved
// defaults, or nil when fn has no moved defaults. Native declaration checks
// still compare its bindings with the source parameters.
func VibeLangMovedDefaultsSourceBody(fn *ast.Node) *ast.Node {
	if !VibeLangHasMovedDefaults(fn) {
		return nil
	}
	outer := fn.Body().AsBlock().Statements.Nodes
	middle := outer[len(outer)-1].AsBlock().Statements.Nodes
	return middle[len(middle)-1]
}

// VibeLangMovedParameterDefault returns the expression whose type parameter
// takes when its default moved into the body: the lowered default, or nil.
func VibeLangMovedParameterDefault(parameter *ast.Node) *ast.Node {
	if parameter == nil || parameter.Kind != ast.KindParameter {
		return nil
	}
	file := ast.GetSourceFileOfNode(parameter)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(movedParameterDefaultsKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })[parameter]
}

// VibeLangParameterForMovedDefault returns the source parameter of an
// initializer moved into the body, so its contextual type stays the source
// parameter's written or contextual type.
func VibeLangParameterForMovedDefault(value *ast.Node) *ast.Node {
	if value == nil {
		return nil
	}
	file := ast.GetSourceFileOfNode(value)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(movedDefaultParametersKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })[value]
}

// moveParameterDefaults rewrites every function whose parameter default holds
// a do expression that returns, and returns each moved parameter's default.
func (p *Parser) moveParameterDefaults() map[*ast.Node]*ast.Node {
	if p.opts.VibeLangDoAsFunction {
		return nil
	}
	first := map[*ast.Node]int{}
	var functions []*ast.Node
	for _, d := range p.vibelangDoOrder {
		parameter := p.doParameterOf(d)
		if parameter == nil || !p.doReturns(d) {
			continue
		}
		fn := parameter.Parent
		index := slices.Index(fn.Parameters(), parameter)
		if index < 0 {
			continue
		}
		if at, seen := first[fn]; !seen {
			functions = append(functions, fn)
			first[fn] = index
		} else if index < at {
			first[fn] = index
		}
	}
	moved := map[*ast.Node]*ast.Node{}
	for _, fn := range functions {
		from := first[fn]
		// Earlier defaults must close over the same cells as the body.
		// Keep a preceding binding pattern in its original parameter scope.
		for i := from - 1; i >= 0; i-- {
			parameter := fn.Parameters()[i]
			if !ast.IsIdentifier(parameter.Name()) || parameter.AsParameterDeclaration().DotDotDotToken != nil {
				break
			}
			if parameter.Initializer() != nil {
				from = i
			}
		}
		if movableDefaults(fn, from) {
			p.moveDefaults(fn, from, moved)
		}
	}
	return moved
}

// doParameterOf returns the parameter whose default holds d, with no source
// function between them, or nil.
func (p *Parser) doParameterOf(d *doExpression) *ast.Node {
	child := d.call
	for n := child.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsClassLike(n) || ast.IsFunctionLike(n) && !p.isDoArrow(n) {
			return nil
		}
		if n.Kind == ast.KindParameter {
			if child == n.Initializer() {
				return n
			}
			return nil
		}
	}
	return nil
}

// doReturns reports a return statement in the block of d, nested do blocks
// included.
func (p *Parser) doReturns(d *doExpression) bool {
	returns := false
	forEachDoStatementThrough(d.block, func(n *ast.Node) {
		if n.Kind == ast.KindReturnStatement {
			returns = true
		}
	}, p.isDoArrow)
	return returns
}

// movableDefaults reports whether the defaults of fn from index from on can
// move into its body.
func movableDefaults(fn *ast.Node, from int) bool {
	switch fn.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
	default:
		return false
	}
	if fn.Body() == nil || isGeneratorFunction(fn) && fn.Flags&ast.NodeFlagsVibeLangEffect == 0 {
		return false // a native generator binds its parameters when it is called, before its first next
	}
	hasRest := false
	for _, parameter := range fn.Parameters()[from:] {
		if !ast.IsIdentifier(parameter.Name()) || defaultSuspends(parameter.Initializer()) {
			return false
		}
		hasRest = hasRest || parameter.AsParameterDeclaration().DotDotDotToken != nil
	}
	if hasRest {
		// A rest array moves with the identifier bindings. A preceding
		// pattern still owns its native parameter environment; it cannot
		// capture the moved rest binding yet.
		for _, parameter := range fn.Parameters() {
			if !ast.IsIdentifier(parameter.Name()) {
				return false
			}
		}
	}
	return true
}

// defaultSuspends reports a try, await or yield in init outside any source
// function: a parameter list is not effect code, and the moved default must
// not become some (EK0501, EK0102 and EK2104 report it where it stands).
func defaultSuspends(init *ast.Node) bool {
	found := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if found || ast.IsClassLike(n) || ast.IsFunctionLike(n) && !isSynthesizedArrow(n) {
			return false
		}
		if n.Kind == ast.KindAwaitExpression || n.Kind == ast.KindYieldExpression || n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			found = true
			return false
		}
		return n.ForEachChild(visit)
	}
	if init != nil {
		visit(init)
	}
	return found
}

func isGeneratorFunction(fn *ast.Node) bool {
	switch fn.Kind {
	case ast.KindFunctionDeclaration:
		return fn.AsFunctionDeclaration().AsteriskToken != nil
	case ast.KindFunctionExpression:
		return fn.AsFunctionExpression().AsteriskToken != nil
	case ast.KindMethodDeclaration:
		return fn.AsMethodDeclaration().AsteriskToken != nil
	}
	return false
}

// moveDefaults moves the defaults of fn from index from on into its body and
// records each default in moved under its parameter. Every generated node
// stands at the body's start, after the parameters, so no generated read
// precedes its declaration.
func (p *Parser) moveDefaults(fn *ast.Node, from int, moved map[*ast.Node]*ast.Node) {
	body := fn.Body()
	at := p.skipRangeTrivia(body.Loc)
	undefined := func(at core.TextRange) *ast.Node {
		return p.vibelangSpanning(p.factory.NewVoidExpression(p.mNumber(0, at)), at)
	}
	var temps, shadows []*ast.Node
	for _, parameter := range fn.Parameters()[from:] {
		name := parameter.Name()
		p.vibelangParameterTemps++
		temp := "$parameter" + strconv.Itoa(p.vibelangParameterTemps)
		temps = append(temps, p.mConst(p.mTemp(temp, at), ast.NodeFlagsConst, p.mIdent(name.Text(), at), at))
		value := p.mTemp(temp, at)
		if init := parameter.Initializer(); init != nil {
			moved[parameter] = init
			loc := init.Loc
			parameter.AsParameterDeclaration().Initializer = p.vibelangSpanning(p.factory.NewNonNullExpression(undefined(loc), ast.NodeFlagsNone), loc)
			p.overrideParentInImmediateChildren(parameter)
			test := p.mBinary(p.mTemp(temp, at), ast.KindExclamationEqualsEqualsToken, undefined(at), at)
			value = p.vibelangSpanning(p.factory.NewConditionalExpression(test, p.mToken(ast.KindQuestionToken, at), p.mTemp(temp, at), p.mToken(ast.KindColonToken, at), init), loc)
		}
		shadow := p.mConst(p.mIdent(name.Text(), name.Loc), ast.NodeFlagsLet, value, at)
		if init := moved[parameter]; anonymousDoValue(init) {
			// Native binding defaults preserve inferred function/class names,
			// including what a class's static initializers observe.
			field := p.vibelangSpanning(p.factory.NewBindingElement(nil, p.mIdent("value", at), p.mIdent(name.Text(), name.Loc), init), parameter.Loc)
			pattern := p.vibelangSpanning(p.factory.NewBindingPattern(ast.KindObjectBindingPattern, p.newNodeList(parameter.Loc, []*ast.Node{field})), parameter.Loc)
			property := p.vibelangSpanning(p.factory.NewPropertyAssignment(nil, p.mIdent("value", at), nil, nil, p.mTemp(temp, at)), at)
			object := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(at, []*ast.Node{property}), false), at)
			shadow = p.mConst(pattern, ast.NodeFlagsLet, object, at)
		}
		// A moved earlier parameter remains declared before the source
		// defaults that read it, even though its statement runs in the body.
		declaration := shadow.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
		declaration.Loc = core.NewTextRange(parameter.Pos(), declaration.End())

		if parameter.Type() != nil {
			// A written type constrains the moved default as it did in the
			// parameter list. An untyped parameter's type comes from the
			// default (VibeLangMovedParameterDefault), so an annotation here
			// would make the default its own contextual type.
			declaration := shadow.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
			typeNode := p.vibelangSynthesized(p.factory.NewTypeQueryNode(p.mTemp(temp, at), nil), at)
			if anonymousDoValue(moved[parameter]) {
				member := p.vibelangSynthesized(p.factory.NewPropertySignatureDeclaration(nil, p.mIdent("value", at), nil, typeNode, nil), at)
				typeNode = p.vibelangSynthesized(p.factory.NewTypeLiteralNode(p.newNodeList(at, []*ast.Node{member})), at)
			}
			declaration.AsVariableDeclaration().Type = typeNode
			p.overrideParentInImmediateChildren(declaration)
		}
		shadows = append(shadows, shadow)
	}
	inner := body
	if body.Kind != ast.KindBlock {
		inner = p.mBlock([]*ast.Node{p.vibelangSpanning(p.factory.NewReturnStatement(body), body.Loc)}, body.Loc)
	}
	middle := p.mBlock(append(shadows, inner), body.Loc)
	replacement := p.mBlock(append(temps, middle), body.Loc)
	switch fn.Kind {
	case ast.KindFunctionDeclaration:
		fn.AsFunctionDeclaration().Body = replacement
	case ast.KindFunctionExpression:
		fn.AsFunctionExpression().Body = replacement
	case ast.KindArrowFunction:
		fn.AsArrowFunction().Body = replacement
	case ast.KindMethodDeclaration:
		fn.AsMethodDeclaration().Body = replacement
	}
	p.overrideParentInImmediateChildren(fn)
}

// registerMovedDefaults asks the conditional lowering to record what each
// moved default becomes (doLowering.conditional keeps a registered default's
// lowered value).
func (l *doLowering) registerMovedDefaults(moved map[*ast.Node]*ast.Node) {
	if len(moved) == 0 {
		return
	}
	if l.bindingDefaultValues == nil {
		l.bindingDefaultValues = map[*ast.Node]*ast.Node{}
	}
	for _, init := range moved {
		l.bindingDefaultValues[init] = nil
	}
}

// recordMovedParameterDefaults gives the checker each moved default as
// lowered: the value a lifted default takes, or the default itself where it
// stayed an expression.
func (p *Parser) recordMovedParameterDefaults(file *ast.SourceFile, l *doLowering, moved map[*ast.Node]*ast.Node) {
	if len(moved) == 0 {
		return
	}
	values := map[*ast.Node]*ast.Node{}
	parameters := map[*ast.Node]*ast.Node{}
	functions := map[*ast.Node]bool{}
	for parameter, init := range moved {
		value := l.bindingDefaultValues[init]
		if value == nil {
			value = init
		}
		values[parameter] = value
		parameters[value] = parameter
		parameters[init] = parameter
		functions[parameter.Parent] = true
	}
	file.GetOrComputeData(movedParameterDefaultsKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return values })
	file.GetOrComputeData(movedDefaultParametersKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return parameters })
	file.GetOrComputeData(movedDefaultFunctionsKey, func(*ast.SourceFile) map[*ast.Node]bool { return functions })
}
