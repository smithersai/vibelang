package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// wire (design D27) composes layers into one: wire(UsersLive, MailerLive,
// DatabaseLive, ConfigLive). The runtime's wire folds its arguments with
// Layer.provideMerge from the last to the first, so each argument may use
// what the arguments after it provide. The compiler reads each argument's
// Layer<Out, E, In> type and emits the arguments in an order where every
// consumer comes before its providers, keeping source order among
// independent arguments. It reports a duplicate provider (EK3202), a cycle
// (EK3203), and an argument whose type does not name its outputs (EK3204).
// An input that no argument provides stays in the result's In, as with
// Layer.provide, and is reported with the provider that needs it where the
// program's requirements must be empty, at a runner (EK9211).

// layerTypeID names the variance property of every Effect 4 Layer:
// `readonly [TypeId]: { _ROut: Contravariant<ROut>; _E; _RIn }`.
const layerTypeID = "~effect/Layer"

func init() { fileChecks = append(fileChecks, checkWires, checkRunners) }

// anyProgram and anyMain are EK9211's and EK3205's text for a program whose
// type is any, such as an Effect.gen program after EK1002, whose services
// TypeScript's type cannot name. {0} is the program.
var (
	anyProgram = EK9211.With("{0} has type any, so the services it needs are unknown.")
	anyMain    = EK3205.With("{0} has type any, so the services it needs are unknown.")
)

// wireArgument is what one layer of a wire call provides and needs: an
// argument, or an element that a spread argument lists (wireArguments).
type wireArgument struct {
	node    *ast.Node
	index   int             // the element of node, a spread tuple, that the layer is, or -1 for node itself
	outputs []*checker.Type // the services it provides
	inputs  []*checker.Type // the services it needs
	opaque  bool            // its type does not name its outputs (EK3204)
	spread  bool            // a spread argument whose elements wire cannot list (EK3204)
}

// text returns the layer's source text for a message: node's, or
// node[index] for an element of a spread tuple.
func (a wireArgument) text() string {
	text := scanner.GetTextOfNode(a.node)
	if a.index >= 0 {
		text += "[" + strconv.Itoa(a.index) + "]"
	}
	return text
}

// wireGraph is the provider graph of one wire call.
type wireGraph struct {
	arguments  []wireArgument
	needs      [][]int // needs[i] lists the arguments that provide what argument i needs
	duplicates map[*checker.Type][]int
	cycle      []int // a cycle of arguments, the first repeated last, or nil
	order      []int // the emission order: consumers before providers
}

// isWireCall reports whether call calls the runtime's wire, by the symbol
// its callee resolves to, whatever it is spelled: the prelude's wire, an
// import under any name, or a namespace import's member, Runtime.wire.
func isWireCall(c *checker.Checker, call *ast.Node) bool {
	return ast.IsCallExpression(call) && runtimeExportOf(c, ast.SkipParentheses(call.Expression())) == "wire"
}

// isRuntimeExport reports whether expr, an identifier, names the export name
// of vibelang-runtime, through an import or the prelude.
func isRuntimeExport(c *checker.Checker, expr *ast.Node, name string) bool {
	return ast.IsIdentifier(expr) && expr.Text() == name && runtimeExportOf(c, expr) == name
}

// runtimeExportOf returns the name of the vibelang-runtime export that
// expr, an identifier or a property access, resolves to through imports
// and the prelude, or "" when it resolves to anything else.
func runtimeExportOf(c *checker.Checker, expr *ast.Node) string {
	if !ast.IsIdentifier(expr) && !ast.IsPropertyAccessExpression(expr) {
		return ""
	}
	symbol := c.GetSymbolAtLocation(expr)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.ValueDeclaration() == nil || packageNameOf(c, ast.GetSourceFileOfNode(symbol.ValueDeclaration())) != "vibelang-runtime" {
		return ""
	}
	return symbol.Name()
}

// packageNameOf returns the name in the package.json nearest to file.
func packageNameOf(c *checker.Checker, file *ast.SourceFile) string {
	program := c.Program()
	directory := program.GetNearestAncestorDirectoryWithPackageJson(file.FileName().Directory())
	if directory == "" {
		return ""
	}
	if info := program.GetPackageJsonInfo(directory.ResolveFile("package.json")); info.Exists() {
		if name, ok := info.Contents.Name.GetValue(); ok {
			return name
		}
	}
	return ""
}

// layerParts reads Out and In from t, a Layer<Out, E, In>, as lists of
// services. opaque reports an Out of any or unknown, which names no
// service. ok is false when t is not a Layer.
func layerParts(c *checker.Checker, t *checker.Type) (outputs, inputs []*checker.Type, opaque, ok bool) {
	variance := c.GetTypeOfPropertyOfType(t, layerTypeID)
	if variance == nil {
		return nil, nil, false, false
	}
	out := c.GetTypeOfPropertyOfType(variance, "_ROut") // (_: ROut) => void
	in := c.GetTypeOfPropertyOfType(variance, "_RIn")   // (_: never) => RIn
	if out == nil || in == nil {
		return nil, nil, false, false
	}
	if out.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return nil, nil, true, true // Layer.Any: { _ROut: any, _E: any, _RIn: any }
	}
	outSignatures := c.GetSignaturesOfType(out, checker.SignatureKindCall)
	inSignatures := c.GetSignaturesOfType(in, checker.SignatureKindCall)
	if len(outSignatures) != 1 || len(inSignatures) != 1 {
		return nil, nil, false, false
	}
	outType := c.GetTypeAtPosition(outSignatures[0], 0)
	if outType.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return nil, unionMembers(c.GetReturnTypeOfSignature(inSignatures[0])), true, true
	}
	return unionMembers(outType), unionMembers(c.GetReturnTypeOfSignature(inSignatures[0])), false, true
}

// unionMembers returns the members of t, a union, or t alone; never has none.
func unionMembers(t *checker.Type) []*checker.Type {
	switch {
	case t.Flags()&checker.TypeFlagsNever != 0:
		return nil
	case t.Flags()&checker.TypeFlagsUnion != 0:
		return t.Types()
	}
	return []*checker.Type{t}
}

// wireArguments lists the layers of call, a wire call: its arguments, and
// for a spread argument the elements it lists, so wire(...[UsersLive,
// DatabaseLive] as const) is planned as wire(UsersLive, DatabaseLive). A
// spread array literal lists its elements, and a spread identifier whose type
// is a tuple of fixed length lists its elements by index. Any other spread
// hides its layers, and EK3204 reports it.
func wireArguments(c *checker.Checker, call *ast.Node) []wireArgument {
	var arguments []wireArgument
	layer := func(node *ast.Node, index int, t *checker.Type) {
		outputs, inputs, opaque, _ := layerParts(c, t)
		arguments = append(arguments, wireArgument{node: node, index: index, outputs: outputs, inputs: inputs, opaque: opaque})
	}
	var add func(node *ast.Node)
	add = func(node *ast.Node) {
		if !ast.IsSpreadElement(node) {
			layer(node, -1, c.GetTypeAtLocation(node))
			return
		}
		if list := ast.SkipOuterExpressions(node.Expression(), ast.OEKAll); ast.IsArrayLiteralExpression(list) {
			for _, element := range list.AsArrayLiteralExpression().Elements.Nodes {
				add(element)
			}
			return
		}
		if elements := fixedTupleElements(c, node.Expression()); elements != nil {
			for k, element := range elements {
				layer(node.Expression(), k, element)
			}
			return
		}
		arguments = append(arguments, wireArgument{node: node, index: -1, spread: true})
	}
	for _, argument := range call.Arguments() {
		add(argument)
	}
	return arguments
}

// fixedTupleElements returns the element types of expression, an identifier
// whose type is a tuple with only required elements, or nil.
func fixedTupleElements(c *checker.Checker, expression *ast.Node) []*checker.Type {
	if !ast.IsIdentifier(expression) {
		return nil
	}
	t := c.GetTypeAtLocation(expression)
	if !checker.IsTupleType(t) {
		return nil
	}
	flags := t.Target().AsTupleType().ElementFlags()
	elements := c.GetTypeArguments(t)
	if len(elements) < len(flags) {
		return nil
	}
	for _, flag := range flags {
		if flag&checker.ElementFlagsRequired == 0 {
			return nil
		}
	}
	return elements[:len(flags)]
}

// graphOfWire builds the provider graph of call, a wire call.
func graphOfWire(c *checker.Checker, call *ast.Node) *wireGraph {
	g := &wireGraph{duplicates: map[*checker.Type][]int{}, arguments: wireArguments(c, call)}
	providers := map[*checker.Type][]int{}
	for i, a := range g.arguments {
		for _, output := range a.outputs {
			providers[output] = append(providers[output], i)
		}
	}
	for output, indexes := range providers {
		if len(indexes) > 1 {
			g.duplicates[output] = indexes
		}
	}
	g.needs = make([][]int, len(g.arguments))
	for i, a := range g.arguments {
		for _, input := range a.inputs {
			for _, j := range providers[input] {
				if j != i && !slices.Contains(g.needs[i], j) {
					g.needs[i] = append(g.needs[i], j)
				}
			}
		}
	}
	g.cycle = findCycle(g.needs)
	g.order = consumersFirst(g.needs)
	return g
}

// findCycle returns a cycle in the graph needs describes, the first node
// repeated at the end, or nil.
func findCycle(needs [][]int) []int {
	const (
		unvisited = iota
		visiting
		done
	)
	state := make([]int, len(needs))
	var path, cycle []int
	var visit func(i int) bool
	visit = func(i int) bool {
		switch state[i] {
		case visiting:
			start := slices.Index(path, i)
			cycle = append(slices.Clone(path[start:]), i)
			return true
		case done:
			return false
		}
		state[i] = visiting
		path = append(path, i)
		for _, j := range needs[i] {
			if visit(j) {
				return true
			}
		}
		path = path[:len(path)-1]
		state[i] = done
		return false
	}
	for i := range needs {
		if visit(i) {
			return cycle
		}
	}
	return nil
}

// consumersFirst returns a topological order of the graph needs describes in
// which every node comes before the nodes it needs, choosing the lowest
// index among the nodes that are ready. With a cycle it returns source order.
func consumersFirst(needs [][]int) []int {
	waiting := make([]int, len(needs)) // how many consumers of each node are not yet placed
	for _, js := range needs {
		for _, j := range js {
			waiting[j]++
		}
	}
	var order []int
	placed := make([]bool, len(needs))
	for len(order) < len(needs) {
		next := -1
		for i := range needs {
			if !placed[i] && waiting[i] == 0 {
				next = i
				break
			}
		}
		if next < 0 {
			order = order[:0]
			for i := range needs {
				order = append(order, i)
			}
			return order
		}
		placed[next] = true
		order = append(order, next)
		for _, j := range needs[next] {
			waiting[j]--
		}
	}
	return order
}

// checkWires reports EK3202, EK3203, and EK3204 for the wire calls in file.
func checkWires(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isWireCall(c, node) {
			checkWire(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkWire(c *checker.Checker, call *ast.Node) {
	g := graphOfWire(c, call)
	for _, a := range g.arguments {
		switch {
		case a.spread:
			note(report(c, a.node, EK3204.With("{0} spreads layers that wire cannot list one by one, so wire cannot place them."), scanner.GetTextOfNode(a.node)), "Pass each layer as an argument, or spread an array literal.")
		case a.opaque:
			note(report(c, a.node, EK3204, a.text()), "Compose it with Layer.provide instead.")
		}
	}
	reported := map[int]bool{}
	for i, a := range g.arguments {
		for _, output := range a.outputs {
			indexes := g.duplicates[output]
			if len(indexes) < 2 || indexes[len(indexes)-1] != i || reported[i] {
				continue
			}
			reported[i] = true
			names := make([]string, len(indexes))
			for k, index := range indexes {
				names[k] = g.arguments[index].text()
			}
			report(c, a.node, EK3202, c.TypeToString(output), strings.Join(names, " and "))
		}
	}
	if g.cycle != nil {
		var steps []string
		for k, i := range g.cycle {
			steps = append(steps, g.arguments[i].text())
			if k+1 < len(g.cycle) {
				if service := neededFrom(g, i, g.cycle[k+1]); service != nil {
					steps = append(steps, c.TypeToString(service))
				}
			}
		}
		d := report(c, call, EK3203, strings.Join(steps, " → "))
		note(d, "Build the services on the cycle in one layer, or drop a need on it: a layer cannot need, through others, a service it provides.")
	}
}

// neededFrom returns a service that argument i needs and argument j provides.
func neededFrom(g *wireGraph, i, j int) *checker.Type {
	for _, input := range g.arguments[i].inputs {
		if slices.Contains(g.arguments[j].outputs, input) {
			return input
		}
	}
	return nil
}

// planWire records the order in which the lowering emits call's arguments,
// when call is a wire call whose arguments are not already in that order.
func (p *servicePlan) planWire(c *checker.Checker, call *ast.Node) {
	if !isWireCall(c, call) {
		return
	}
	g := graphOfWire(c, call)
	if g.cycle == nil && !slices.IsSorted(g.order) {
		p.wireOrders[call] = g.order
		if len(g.arguments) != len(call.Arguments()) || slices.ContainsFunc(g.arguments, func(a wireArgument) bool { return a.index >= 0 }) {
			p.wireLists[call] = g.arguments
		}
	}
}

// visitWireCall emits a wire call with its arguments in dependency order.
// The argument expressions still run in source order, each once (order.go):
// only the layers they make change places.
func (tx *lowering) visitWireCall(node *ast.Node) *ast.Node {
	visited := tx.visitWireArguments(node)
	callee := tx.Visitor().VisitNode(node.Expression())
	// The operands are the layers wireArguments lists when a spread lists
	// them, each from its own source node (an element of a spread array
	// literal, or the spread tuple itself).
	sources := node.Arguments()
	if list := tx.plan.wireLists[node]; list != nil {
		sources = make([]*ast.Node, len(list))
		for k, a := range list {
			sources[k] = a.node
		}
	}
	arguments := tx.inOrder(visited.Nodes, sources, tx.plan.wireOrders[node])
	f := tx.Factory()
	return f.UpdateCallExpression(node.AsCallExpression(), callee, nil /*questionDotToken*/, node.TypeArgumentList(), f.NewNodeList(arguments), ast.NodeFlagsNone)
}

// visitWireArguments visits the layers of node, a wire call, in source
// order: its arguments, or, when a spread argument lists layers, the layers
// wireArguments lists, a spread tuple's elements as tuple[index].
func (tx *lowering) visitWireArguments(node *ast.Node) *ast.NodeList {
	list := tx.plan.wireLists[node]
	if list == nil {
		return tx.Visitor().VisitNodes(node.ArgumentList())
	}
	f := tx.Factory()
	layers := make([]*ast.Node, len(list))
	for k, a := range list {
		layer := tx.Visitor().VisitNode(a.node)
		if a.index >= 0 {
			layer = f.NewElementAccessExpression(f.DeepCloneNode(layer), nil /*questionDotToken*/, f.NewNumericLiteral(strconv.Itoa(a.index), ast.TokenFlagsNone), ast.NodeFlagsNone)
		}
		layers[k] = layer
	}
	return f.NewNodeList(layers)
}

// A runnerSite is where a runner gets the program checkProgram checks.
type runnerSite int

const (
	runnerCall  runnerSite = iota // the argument of a root runner's call
	runnerTest                    // a test that it.effect registers
	runnerEntry                   // an entry module's main, which its entry statement runs (D135)
)

// checkRunners reports EK9211 at a runner whose program still needs a
// service that a wire call in the program leaves unprovided: the dependency
// path names the provider that needs it. An entry module's main is checked
// as a root runner's program, since its entry statement runs it with
// NodeRuntime.runMain or the runtime's copy of it (D135, D122), with the
// services of the platform layer the entry provides it (D312): EK3205, a
// warning, since a module that exports main may also be a library whose
// importer, maybe in another program, provides its services. A main that
// another module of the program imports is not checked (mainImported).
// EK3205 also says which platform import would provide what it names.
func checkRunners(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			switch {
			case isRootRunner(c, node) && len(node.Arguments()) > 0:
				checkProgram(c, node.Arguments()[0], nil /*accepted*/, runnerCall)
			case isTestRegistration(c, node):
				checkTest(c, node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if main := entryMain(c, file); main != nil && runnerRequirements(c, c.GetTypeAtLocation(main.Name())) != nil && !mainImported(c, file) {
		_, provided := entryBundles(c, file, main)
		if d := checkProgram(c, main.Name(), provided, runnerEntry); d != nil {
			if platform := platformNote(c, file, neededServices(c, main)); platform != "" {
				note(d, platform)
			}
		}
	}
}

// mainImported reports whether another module of the program can bind
// file's main: it imports main or file's namespace, re-exports them, or
// imports file dynamically. Such a main is also a function that module runs
// with the services it provides, as an application's entry or a test does
// (D135), so only the host starting file directly would run it without them.
func mainImported(c *checker.Checker, file *ast.SourceFile) bool {
	for _, other := range c.Program().SourceFiles() {
		if other == file || other.IsDeclarationFile {
			continue
		}
		for _, specifier := range other.Imports() {
			if !bindsMain(specifier.Parent) {
				continue
			}
			if module := c.ResolveExternalModuleName(specifier, nil /*importAttributesType*/); module != nil && module.ValueDeclaration() == file.AsNode() {
				return true
			}
		}
	}
	return false
}

// bindsMain reports whether node, the import, export or call that holds a
// module specifier, can bind the module's export named main.
func bindsMain(node *ast.Node) bool {
	named := func(elements []*ast.Node) bool {
		for _, element := range elements {
			if !element.IsTypeOnly() && moduleExportNameText(element.PropertyNameOrName()) == "main" {
				return true
			}
		}
		return false
	}
	switch {
	case ast.IsImportDeclaration(node):
		clause := node.ImportClause()
		if clause == nil || clause.IsTypeOnly() {
			return false // import "./m.vibe", import type { … } from "./m.vibe"
		}
		switch bindings := clause.AsImportClause().NamedBindings; {
		case bindings == nil:
			return false // a default import
		case ast.IsNamespaceImport(bindings):
			return true
		default:
			return named(bindings.Elements())
		}
	case ast.IsExportDeclaration(node):
		d := node.AsExportDeclaration()
		if d.IsTypeOnly {
			return false
		}
		if d.ExportClause == nil || d.ExportClause.Kind == ast.KindNamespaceExport {
			return true // export * from "./m.vibe", export * as m from "./m.vibe"
		}
		return named(d.ExportClause.Elements())
	case node.Kind == ast.KindLiteralType:
		return false // import("./m.vibe").T names a type
	}
	return true // import("./m.vibe"), require("./m.js"), import m = require("./m.js")
}

// checkTest checks the program of a test that it.effect registers against
// what the test provides: Scope, and the services of an enclosing layer(…),
// which the type of its parameter says.
func checkTest(c *checker.Checker, call *ast.Node) {
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return
	}
	for i, program := range call.Arguments() {
		if accepted := runnerRequirements(c, c.GetTypeAtPosition(signature, i)); accepted != nil {
			checkProgram(c, program, accepted, runnerTest)
			return
		}
	}
}

// checkProgram reports EK9211 for the services that program, the program a
// runner receives, needs and accepted does not include: a root runner such
// as Effect.runPromise or NodeRuntime.runMain starts with an empty Context,
// so accepted is nil. TypeScript would report that the program's type does
// not fit the parameter; EK9211 names the services instead, and the wire
// arguments that need them. For an entry module, program is main's name,
// and the code is EK3205. It returns the diagnostic it reports, or nil.
func checkProgram(c *checker.Checker, program *ast.Node, accepted *checker.Type, site runnerSite) *ast.Diagnostic {
	needed := runnerRequirements(c, c.GetTypeAtLocation(program))
	if needed == nil {
		return nil
	}
	if needed.Flags()&checker.TypeFlagsAny != 0 {
		m := anyProgram
		if site == runnerEntry {
			m = anyMain
		}
		d := report(c, program, m, scanner.GetTextOfNode(program))
		note(d, "TypeScript gives a program type any where it cannot type it, as after an error in its declaration: fix that error, or write the program's type, A!E!R.")
		if site != runnerEntry {
			coverArgument(c, program)
		}
		return d
	}
	var names, paths []string
	var missing []*checker.Type
	for _, service := range unionMembers(needed) {
		if site == runnerEntry && provides(c, accepted, service) || site != runnerEntry && accepted != nil && c.IsTypeAssignableTo(service, accepted) {
			continue
		}
		if service.Flags()&(checker.TypeFlagsUnknown|checker.TypeFlagsAny) != 0 {
			continue // R of a call TypeScript rejected, such as a Layer.effect whose service does not fit: that error is the one to fix
		}
		names = append(names, c.TypeToString(service))
		missing = append(missing, service)
		for _, needer := range servicesFor(c).wireNeeders(service) {
			paths = append(paths, scanner.GetTextOfNode(needer)+" needs "+c.TypeToString(service))
		}
	}
	if len(names) == 0 {
		return nil
	}
	code := EK9211
	if site == runnerEntry {
		code = EK3205
	}
	namesText := strings.Join(names, ", ")
	if site == runnerEntry {
		namesText = diagnosticListText(names, ", ")
	}
	d := report(c, program, code, namesText)
	visiblePaths := paths
	if site == runnerEntry && len(visiblePaths) > diagnosticListLimit {
		visiblePaths = visiblePaths[:diagnosticListLimit]
	}
	for _, path := range visiblePaths {
		note(d, "{0}, and no argument of its wire provides it.", path)
	}
	switch {
	case len(paths) > 0:
		note(d, "Add a provider of {0} to wire.", namesText)
	case site == runnerTest:
		note(d, "Provide it inside the test with provide layer { … }, or register the test inside layer(…).")
	case site == runnerEntry:
		noteEntryLayers(c, d, missing)
	default:
		note(d, "Provide it inside the program with provide layer { … }, or at this runner with Effect.provide(() => …, layer).")
	}
	if site != runnerEntry {
		coverArgument(c, program)
	}
	return d
}

// noteEntryLayers adds to d, EK3205 at an entry module's main, how to provide
// each service of missing inside main: with the layers that EK4402 names for
// it (platformServiceOf), or with a layer the program has.
func noteEntryLayers(c *checker.Checker, d *ast.Diagnostic, missing []*checker.Type) {
	var others []string
	for _, service := range missing {
		if s := platformServiceOf(c, service); s != nil && s.provider != "" {
			note(d, "Provide {0} inside main with provide layer { … }, where layer is {1}.", c.TypeToString(service), s.provider)
		} else {
			others = append(others, c.TypeToString(service))
		}
	}
	switch {
	case len(others) == len(missing):
		note(d, "Provide it inside main with provide layer { … }.")
	case len(others) > 0:
		note(d, "Provide {0} inside main with provide layer { … }.", strings.Join(others, ", "))
	}
}

// runnerRequirements returns R of t, an Effect or a function that returns one,
// or nil for any other type.
func runnerRequirements(c *checker.Checker, t *checker.Type) *checker.Type {
	if r := varianceChannel(c, t, "_R"); r != nil {
		return r
	}
	if signatures := c.GetSignaturesOfType(t, checker.SignatureKindCall); len(signatures) == 1 {
		return varianceChannel(c, c.GetReturnTypeOfSignature(signatures[0]), "_R")
	}
	return nil
}

// wireNeeders returns the wire arguments, anywhere in the program, that need
// service while no argument of their wire call provides it.
func (s *services) wireNeeders(service *checker.Type) []*ast.Node {
	if s.unprovided == nil {
		s.unprovided = map[*checker.Type][]*ast.Node{}
		for _, file := range s.checker.Program().SourceFiles() {
			if !isVibeLangFile(file) {
				continue
			}
			var visit func(node *ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isWireCall(s.checker, node) {
					g := graphOfWire(s.checker, node)
					for i, a := range g.arguments {
						for _, input := range a.inputs {
							if !providedBy(g, input, i) {
								s.unprovided[input] = append(s.unprovided[input], a.node)
							}
						}
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		}
	}
	return s.unprovided[service]
}

// providedBy reports whether an argument of g other than i provides service.
func providedBy(g *wireGraph, service *checker.Type, i int) bool {
	for j, a := range g.arguments {
		if j != i && slices.Contains(a.outputs, service) {
			return true
		}
	}
	return false
}
