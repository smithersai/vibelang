package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// provide blocks (D130, D172).
//
//	provide UsersLive {
//	  return greet("42")
//	}
//
// runs its statements with the services UsersLive provides. The parser reads
// it as a Block flagged NodeFlagsVibeLang whose first statement is the layer
// expression, so the checker treats the statements as code of the enclosing
// function: a return returns from it. The analyzer gives the block the
// errors of its statements and the layer, and the requirements of its
// statements that the layer does not provide plus the layer's own. The
// lowering runs the statements as a region closure under Effect.provide:
//
//	const completion = yield* Effect.provide(Effect.fnUntraced(function* f$provide() {
//	  return { kind: "return", value: yield* greet("42") };
//	})(), UsersLive);
//	if (completion.kind === "return") return completion.value;
//
// The keyword matches Effect.provide.

// EK1201: a provide statement at module scope requires effect code.
var moduleProvideDiagnostic = message(1201, errorCategory, "A provide block requires effect code. Move it into an effect function or an effect { } block.")

func init() {
	registry[moduleProvideDiagnostic.Code] = moduleProvideDiagnostic
	fileChecks = append(fileChecks, checkProvideBlocks, checkProvideProviders)
	ls.RegisterQuickInfoHook(providerQuickInfo)
}

// isProvideBlock reports whether node is the block of a provide statement.
func isProvideBlock(node *ast.Node) bool {
	return node.Kind == ast.KindBlock && node.Flags&ast.NodeFlagsVibeLang != 0
}

// isProvideLayer reports whether node is the statement that holds the layer
// expression of a provide block.
func isProvideLayer(node *ast.Node) bool {
	return node.Kind == ast.KindExpressionStatement && node.Flags&ast.NodeFlagsVibeLang != 0
}

// provideLayer returns the layer expression of block, a provide block.
func provideLayer(block *ast.Node) *ast.Node {
	return block.AsBlock().Statements.Nodes[0].Expression()
}

// hasProvideBlock reports whether fn's own body has a provide block, which makes it
// an Effect: the block runs Effect.provide.
func hasProvideBlock(fn *ast.Node) bool {
	if fn.Body() == nil {
		return false
	}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		return isProvideBlock(n) || n.ForEachChild(visit)
	}
	return visit(fn.Body())
}

// provideFlow collects what can escape a provide block: the errors of its
// statements and of building the layer, and the requirements of its
// statements that the layer does not provide, plus the layer's own.
func (a *analyzer) provideFlow(block *ast.Node) *effectInfo {
	c := a.checker
	layer := provideLayer(block)
	info := a.flowOf(layer)
	body := &effectInfo{}
	for _, statement := range block.AsBlock().Statements.Nodes[1:] {
		body.add(a.flowOf(statement))
	}
	if info.effect == nil {
		info.effect = body.effect
	}
	provided, errors, needs := providerChannelsOf(c, layer)
	info.addErrors(body)
	for i, requirement := range body.requirements {
		for _, member := range unionMembers(requirement) {
			switch {
			case provided == nil:
				info.addRequirement(member, body.requirementSources[i])
			case c.IsTypeAssignableTo(member, provided):
			case member.Flags()&checker.TypeFlagsInstantiable != 0:
				// A generic requirement, such as a function's type parameter R,
				// keeps what the block does not provide: Exclude<R, I>, as
				// Effect.provideService and Effect.provide leave it.
				info.addRequirement(c.ExcludeType(member, provided), body.requirementSources[i])
			default:
				info.addRequirement(member, body.requirementSources[i])
			}
		}
	}
	if errors != nil && errors.Flags()&checker.TypeFlagsNever == 0 {
		info.addError(errors, layer)
	}
	if needs != nil && needs.Flags()&checker.TypeFlagsNever == 0 {
		info.addRequirement(needs, layer)
	}
	return info
}

// providerInfo records the services present on every path, and all possible
// construction errors and inputs (D362). nonempty counts required list elements.
type providerInfo struct {
	provided, errors, needs *checker.Type
	valid, nonempty         bool
	layer                   bool // every alternative is one layer, usable as a list element
}

func emptyProvider(c *checker.Checker) providerInfo {
	never := c.GetNeverType()
	return providerInfo{provided: never, errors: never, needs: never, valid: true}
}

// combineProviders joins a list's outputs, but intersects a union's outputs:
// only one union member is present at run time. Both add every member's E/R.
func combineProviders(c *checker.Checker, parts []providerInfo, union bool) providerInfo {
	result := emptyProvider(c)
	result.layer = len(parts) > 0
	var outs, errs, ins []*checker.Type
	for _, part := range parts {
		result.valid = result.valid && part.valid
		result.layer = result.layer && part.layer
		result.nonempty = result.nonempty || part.nonempty
		outs = append(outs, part.provided)
		errs = append(errs, part.errors)
		ins = append(ins, part.needs)
	}
	if union && len(parts) > 0 {
		result.provided = c.GetIntersectionType(outs)
		result.nonempty = true
		for _, part := range parts {
			result.nonempty = result.nonempty && part.nonempty
		}
	} else {
		result.provided = c.GetUnionType(outs)
	}
	result.errors, result.needs = c.GetUnionType(errs), c.GetUnionType(ins)
	if !result.valid {
		result.provided = c.GetNeverType()
	}
	return result
}

// providerExpression reads array literals element by element (D175): their
// inferred element union can erase a layer's outputs through contravariance.
func providerExpression(c *checker.Checker, expression *ast.Node) providerInfo {
	list := ast.SkipParentheses(expression)
	if !ast.IsArrayLiteralExpression(list) {
		return providerType(c, c.GetTypeAtLocation(expression))
	}
	var parts []providerInfo
	for _, element := range list.AsArrayLiteralExpression().Elements.Nodes {
		if ast.IsSpreadElement(element) {
			parts = append(parts, providerSpread(c, c.GetTypeAtLocation(element.Expression())))
		} else {
			part := providerExpression(c, element)
			part.valid = part.valid && part.layer
			parts = append(parts, part)
		}
	}
	result := combineProviders(c, parts, false)
	result.valid = result.valid && result.nonempty
	result.layer = false // the list itself is not a layer
	return result
}

func providerChannelsOf(c *checker.Checker, expression *ast.Node) (provided, errors, needs *checker.Type) {
	info := providerExpression(c, expression)
	return info.provided, info.errors, info.needs
}

func providerType(c *checker.Checker, t *checker.Type) providerInfo {
	result := emptyProvider(c)
	if t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 {
		result.valid = false
		return result
	}
	if t.Flags()&checker.TypeFlagsInstantiable != 0 {
		if constraint := c.GetBaseConstraintOfType(t); constraint != nil && constraint != t {
			return providerType(c, constraint)
		}
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		var parts []providerInfo
		for _, member := range t.Types() {
			parts = append(parts, providerType(c, member))
		}
		return combineProviders(c, parts, true)
	}
	if out, e, in := layerChannels(c, t); out != nil && e != nil && in != nil {
		return providerInfo{provided: out, errors: e, needs: in, valid: true, nonempty: true, layer: true}
	}
	if services := contextServices(c, t); services != nil {
		result.provided, result.nonempty = services, true
		return result
	}
	if checker.IsTupleType(t) {
		result = providerTuple(c, t)
		result.valid = result.valid && result.nonempty
		return result
	}
	result.valid = false // an array's element type promises no element is present
	return result
}

func providerTuple(c *checker.Checker, t *checker.Type) providerInfo {
	var parts []providerInfo
	flags := t.TargetTupleType().ElementFlags()
	for i, element := range c.GetTypeArguments(t) {
		var part providerInfo
		switch {
		case flags[i]&checker.ElementFlagsVariadic != 0:
			part = providerSpread(c, element)
		case flags[i]&checker.ElementFlagsRequired != 0:
			part = providerType(c, element)
		default:
			part = providerType(c, c.RemoveMissingOrUndefinedType(element))
			part.provided, part.nonempty = c.GetNeverType(), false
		}
		if flags[i]&checker.ElementFlagsVariadic == 0 {
			part.valid = part.valid && part.layer
		}
		parts = append(parts, part)
	}
	result := combineProviders(c, parts, false)
	result.layer = false
	return result
}

// A spread array contributes E/R, but promises no outputs. Required tuple
// elements keep their outputs, even beside an array spread in the same list.
func providerSpread(c *checker.Checker, t *checker.Type) providerInfo {
	if t.Flags()&checker.TypeFlagsInstantiable != 0 {
		if constraint := c.GetBaseConstraintOfType(t); constraint != nil && constraint != t {
			return providerSpread(c, constraint)
		}
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		var parts []providerInfo
		for _, member := range t.Types() {
			parts = append(parts, providerSpread(c, member))
		}
		return combineProviders(c, parts, true)
	}
	if checker.IsTupleType(t) {
		return providerTuple(c, t)
	}
	if c.IsArrayType(t) {
		element := c.GetElementTypeOfArrayType(t)
		if element.Flags()&checker.TypeFlagsNever != 0 {
			return emptyProvider(c)
		}
		part := providerType(c, element)
		part.valid = part.valid && part.layer
		part.provided, part.nonempty = c.GetNeverType(), false
		return part
	}
	result := emptyProvider(c)
	result.valid = false
	return result
}

// contextServices returns the services a Context<Services> holds, or nil
// when t is not a Context. Its variance struct holds Services
// contravariantly.
func contextServices(c *checker.Checker, t *checker.Type) *checker.Type {
	for _, property := range c.GetPropertiesOfType(t) {
		services := c.GetTypeOfPropertyOfType(c.GetTypeOfSymbol(property), "_Services")
		if services == nil {
			continue
		}
		signatures := c.GetSignaturesOfType(services, checker.SignatureKindCall)
		if len(signatures) == 1 && len(signatures[0].Parameters()) == 1 {
			return c.GetTypeOfSymbol(signatures[0].Parameters()[0])
		}
	}
	return nil
}

// layerChannels returns what a Layer<ROut, E, RIn> provides, fails with, and
// needs, or nils when t is not a Layer. The Layer's variance struct holds
// ROut contravariantly, as a function's parameter, and E and RIn
// covariantly, as return types.
func layerChannels(c *checker.Checker, t *checker.Type) (provided, errors, needs *checker.Type) {
	for _, property := range c.GetPropertiesOfType(t) {
		variance := c.GetTypeOfSymbol(property)
		out := c.GetTypeOfPropertyOfType(variance, "_ROut")
		e := c.GetTypeOfPropertyOfType(variance, "_E")
		in := c.GetTypeOfPropertyOfType(variance, "_RIn")
		if out == nil || e == nil || in == nil {
			continue
		}
		parameter := func(f *checker.Type) *checker.Type {
			signatures := c.GetSignaturesOfType(f, checker.SignatureKindCall)
			if len(signatures) != 1 || len(signatures[0].Parameters()) != 1 {
				return nil
			}
			return c.GetTypeOfSymbol(signatures[0].Parameters()[0])
		}
		result := func(f *checker.Type) *checker.Type {
			signatures := c.GetSignaturesOfType(f, checker.SignatureKindCall)
			if len(signatures) != 1 {
				return nil
			}
			return c.GetReturnTypeOfSignature(signatures[0])
		}
		return parameter(out), result(e), result(in)
	}
	return nil, nil, nil
}

// visitProvideBlock lowers node, a provide block, to a region closure that runs
// under Effect.provide with the block's layer. A block with a Key = value
// provider runs under $provideEntries instead, which provides each such
// service as Effect.provideService does and builds only the other layers the
// block lists:
//
//	provide Clock = testClock { ... }          $provideEntries(run, [$provideService(Clock, "Clock", testClock)])
//	provide AppLive, Clock = testClock { ... } $provideEntries(run, [AppLive, $provideService(Clock, "Clock", testClock)])
func (tx *lowering) visitProvideBlock(node *ast.Node) *ast.Node {
	f := tx.Factory()
	layer := tx.Visitor().VisitNode(provideLayer(node))
	services := slices.ContainsFunc(providerList(provideLayer(node)), isServiceProvider)
	if services && !ast.IsArrayLiteralExpression(layer) {
		layer = f.NewArrayLiteralExpression(f.NewNodeList([]*ast.Node{layer}), false /*multiLine*/)
	}
	r := &region{}
	statements := tx.regionStatements(r, node)
	run := tx.runNow(tx.regionFunction(r, "provide", nil, node, statements), node)
	if services {
		run = tx.runtimeCall("$provideEntries", run, layer)
	} else {
		provide := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("provide"), ast.NodeFlagsNone)
		run = f.NewCallExpression(provide, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{run, layer}), ast.NodeFlagsNone)
	}
	return tx.runRegion(node, run, r)
}

// checkProvideBlocks reports EK1201 at a provide block that no function encloses:
// a module's top level only declares, and such a block would run a program.
func checkProvideBlocks(c *checker.Checker, file *ast.SourceFile) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if isProvideBlock(n) {
			report(c, n, moduleProvideDiagnostic)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkProvideProviders reports EK3207 for a provider whose type cannot
// promise a layer, a Context, or a non-empty list on every path (D362).
func checkProvideProviders(c *checker.Checker, file *ast.SourceFile) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isProvideBlock(n) {
			provider := provideLayer(n)
			if !providerExpression(c, provider).valid {
				report(c, provider, EK3207)
			}
		} else if provider, _ := effectProvideArguments(c, n); provider != nil && !providerExpression(c, provider).valid {
			report(c, provider, EK3207)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// effectProvideArguments distinguishes Effect.provide(self, provider) from
// Effect.provide(provider, options), using the resolved overload's parameters.
func effectProvideArguments(c *checker.Checker, call *ast.Node) (provider, self *ast.Node) {
	if !ast.IsCallExpression(call) || !isVibeLangFile(ast.GetSourceFileOfNode(call)) ||
		!isExportOf(c, call, "effect", "Effect", []string{"provide"}) {
		return nil, nil
	}
	signature := c.GetResolvedSignature(call)
	args := call.Arguments()
	if signature == nil || len(signature.Parameters()) == 0 || len(args) == 0 {
		return nil, nil
	}
	if signature.Parameters()[0].Name() == "self" {
		if len(args) < 2 {
			return nil, nil
		}
		return args[1], args[0]
	}
	return args[0], nil
}

// Effect's tuple overload extracts outputs from Layers[number], which joins
// alternatives and optional/rest elements. D362 instead uses only guaranteed
// outputs, in both direct and curried calls, including a stored curried function.
func providedCallType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	if t == nil {
		return t
	}
	provider, self := effectProvideArguments(c, call)
	if provider == nil {
		return t
	}
	info := providerExpression(c, provider)
	result := func(returned, program *checker.Type) *checker.Type {
		if !isEffectType(c, returned) || !isEffectType(c, program) {
			return returned
		}
		return c.NewTypeReference(effectInterface(c, returned), []*checker.Type{
			channelType(c, returned, "_A"),
			c.GetUnionType([]*checker.Type{channelType(c, program, "_E"), info.errors}),
			c.GetUnionType([]*checker.Type{c.ExcludeType(channelType(c, program, "_R"), info.provided), info.needs}),
		})
	}
	if self != nil {
		program := c.GetTypeAtLocation(self)
		if signature := singleCallSignature(c, program); signature != nil {
			program = c.GetReturnTypeOfSignature(signature)
		} else if analyzerFor(c).isByName(self) {
			program = analyzerFor(c).byNameType(self, program)
		}
		return result(t, program)
	}
	signature := singleCallSignature(c, t)
	if signature == nil || len(signature.Parameters()) != 1 {
		return t
	}
	returned := result(c.GetReturnTypeOfSignature(signature), c.GetTypeOfSymbol(signature.Parameters()[0]))
	return c.NewFunctionType(nil, []*checker.Signature{c.SignatureWithReturnType(signature, returned)})
}

// providerCall returns the $provideService call that the parser wrote for a
// Key = value provider (D173) when node is part of its key, or nil.
func providerCall(node *ast.Node) *ast.Node {
	for n := node; n != nil; n = n.Parent {
		if !ast.IsCallExpression(n) {
			continue
		}
		callee := n.Expression()
		if !ast.IsIdentifier(callee) || callee.Text() != "$provideService" || callee.Flags&ast.NodeFlagsReparsed == 0 {
			return nil
		}
		args := n.Arguments()
		if len(args) != 3 || node.Pos() < args[0].Pos() || node.End() > args[0].End() {
			return nil
		}
		return n
	}
	return nil
}

// providerQuickInfo adds a line to a hover over the key of a Key = value
// provider naming the service the block receives. A module whose export of
// the same name is the key, such as Random, names that export: Random.Random.
func providerQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	call := providerCall(node)
	if call == nil {
		return "", ""
	}
	args := call.Arguments()
	key := scanner.GetSourceTextOfNodeFromSourceFile(ast.GetSourceFileOfNode(call), args[0], false /*includeTrivia*/)
	name := args[1].Text()
	if c.GetPropertyOfType(c.GetTypeAtLocation(args[0]), name) != nil {
		key += "." + name
	}
	return "", "Provides the service `" + key + "` to this provide block's statements."
}
