package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Effect language-service rules retained as EK48xx diagnostics. Rules that
// also apply to TypeScript files are implemented in lsrules_ts.go.

var (
	// EK4801 (floatingEffect): a statement that discards an Effect value. {0} is the expression.
	EK4801 = message(4801, errorCategory, "{0} is an Effect value, and this statement discards it without running it.")
	// EK4802: an inferred Effect argument outside a declared Effect position (VIP-1). {0} is the argument.
	EK4802 = message(4802, warningCategory, "{0} infers an Effect in a plain function's generic parameter, so the function receives the unrun program instead of its result.")
	// EK4803 (duplicatePackage): two versions of an Effect package. {0} is the package, {1} the number of versions.
	EK4803 = message(4803, warningCategory, "This program loads {1} versions of {0}, so services, fibers, and types can differ between its modules.")
	// EK4804 (globalErrorInEffectFailure, globalErrorInEffectCatch): an expected failure that is a global Error. {0} is its type.
	EK4804 = message(4804, warningCategory, "This failure is a global {0}, which has no _tag for a catch or a match to tell it apart by.")
	// EK4805 (extendsNativeError): a class that extends Error. {0} is the class, {1} what it extends.
	EK4805 = message(4805, warningCategory, "{0} extends {1}, but a VibeLang failure is an error declaration.")
	// EK4806 (unknownInEffectCatch): Effect.try or Effect.tryPromise whose mapping returns unknown or any. {0} is the type.
	EK4806 = message(4806, warningCategory, "This catch maps the failure to {0}, which tells a catch nothing about what failed.")
	// EK4807 (layerMergeAllWithDependencies): Layer.mergeAll of a layer that needs another. {0} is the dependent layer, {1} the services, {2} the provider.
	EK4807 = message(4807, warningCategory, "{0} needs {1}, which {2} provides, but Layer.mergeAll builds its layers side by side.")
	// EK4808 (multipleEffectProvide): a provide block that is all of another one.
	EK4808 = message(4808, warningCategory, "This provide block contains only another provide block.")
	// EK4809 (leakingRequirements): a service whose every member needs one service. {0} is the service, {1} what each member needs.
	EK4809 = message(4809, warningCategory, "Every member of {0} needs {1}, so each caller must provide it.")
	// EK4810 (unsafeEffectTypeAssertion): an assertion that drops part of a channel. {0} is what it drops, {1} the channel.
	EK4810 = message(4810, warningCategory, "This assertion drops {0} from the Effect's {1} channel, so no contract checks it.")
	// EK4811 (anyUnknownInErrorContext; off by default): any or unknown in a channel. {0} is the source, {1} the type, {2} the channel.
	EK4811 = messageOff(4811, "{0} adds {1} to the {2} channel, where no catch or provide can narrow it.")
	// EK4812 (newPromise): new Promise in VibeLang code.
	EK4812 = message(4812, warningCategory, "new Promise makes a promise, which VibeLang code cannot wait for.")
	// EK4813 (outdatedApi): an Effect 3 name. {0} is the module, {1} the name, {2} the Effect 4 name.
	EK4813 = message(4813, errorCategory, "{0}.{1} is Effect 3 API; Effect 4 calls it {0}.{2}.")
	// EK4814 (overriddenSchemaConstructor): a constructor in a Schema class. {0} is the class.
	EK4814 = message(4814, warningCategory, "{0} overrides the constructor of a Schema class, which runs on every decode as well as on new.")
	// EK4815 (effectInFailure): a throw of an Effect value. {0} is the value.
	EK4815 = message(4815, warningCategory, "{0} is an Effect value, so this throw fails with the program itself.")
	// EK4816 (strictEffectProvide; off by default): a provided layer. {0} is the layer.
	EK4816 = messageOff(4816, "{0} is provided here, which may break scope lifetimes away from an application entry point.")
	// EK4817 (instanceOfSchema; off by default): instanceof a schema class. {0} is the class.
	EK4817 = messageOff(4817, "instanceof {0} tests the class; Schema.is({0}) tests the schema.")
	// EK4818 (preferSchemaOverJson; off by default): JSON.parse or JSON.stringify. {0} is the function.
	EK4818 = messageOff(4818, "JSON.{0} handles JSON without a schema to check it.")
)

// outdatedAPI is EK4813's text for a name that Effect 4 removed.
var outdatedAPI = EK4813.With("{0}.{1} is Effect 3 API, which Effect 4 removed.")

// messageOff returns a warning that is off by default.
func messageOff(code int32, text string) *Message {
	return &Message{Code: code, Category: warningCategory, Text: text, Off: true}
}

func init() {
	lint.RegisterVibeFloatingExclusion(func(expression *ast.Node) bool {
		return isFiberOperator(ast.SkipParentheses(expression)) && !inEffectCode(expression)
	})
	// Ordinary generic repairs are excluded from the historical VIP migration.
	for _, m := range []*Message{EK4801, EK4802, EK4803, EK4804, EK4805, EK4806, EK4807, EK4808, EK4809, EK4810,
		EK4811, EK4812, EK4813, EK4814, EK4815, EK4816, EK4817, EK4818} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkEffectRules)
}

// ruleCheck checks one .vibe file against the rules.
type ruleCheck struct {
	c    *checker.Checker
	a    *analyzer
	file *ast.SourceFile
}

// checkEffectRules reports the EK48xx diagnostics in file.
func checkEffectRules(c *checker.Checker, file *ast.SourceFile) {
	r := &ruleCheck{c: c, a: analyzerFor(c), file: file}
	r.checkDuplicatePackages()
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isProvideBlock(node):
			r.checkProvide(node)
		case ast.IsExpressionStatement(node):
			r.checkFloating(node)
		case ast.IsThrowStatement(node):
			r.checkThrow(node)
		case ast.IsClassLike(node):
			r.checkClass(node)
		case ast.IsAsExpression(node) || ast.IsTypeAssertion(node):
			r.checkAssertion(node)
		case ast.IsNewExpression(node):
			r.checkNew(node)
		case ast.IsCallExpression(node):
			r.checkCall(node)
		case ast.IsPropertyAccessExpression(node):
			r.checkOutdated(node)
		case ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword:
			r.checkInstanceOf(node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkFloating reports EK4801 at statement, an expression statement, when it
// discards an Effect value, or a program it names without calling it, such
// as `interrupt` or a function of no arguments that runs Effects: naming
// one runs nothing (D24), so a program went on past `interrupt`. A call
// that returns a program stays quiet; a call at a module's top level is
// EK1001's. A constructor, an accessor and a class static block are plain
// JavaScript (VIP-1), so a call there that gives an Effect discards it.
func (r *ruleCheck) checkFloating(statement *ast.Node) {
	if lint.Active(optionsFor(r.c, ast.GetSourceFileOfNode(statement))) {
		return // VIP-38: the imported rule owns selected inputs, including off.
	}
	expression := statement.Expression()
	if isProvideLayer(statement) || isDiscardingForm(expression) || isHelperCall(expression) {
		return
	}
	// A running template has invocation diagnostics, just like a call.
	if invocation := ast.SkipParentheses(expression); ast.IsTaggedTemplateExpression(invocation) && r.a.runs(invocation) {
		return
	}
	body := inEffectCode(statement) // plain code runs no Effect (VIP-1)
	// A misplaced fiber operator already has EK1701. Its lowered cold
	// helper is not an ordinary discarded Effect (VIP-17).
	if !body && isFiberOperator(ast.SkipParentheses(expression)) {
		return
	}
	if invocation := ast.SkipParentheses(expression); !body && ast.IsCallExpression(invocation) {
		fn := ast.FindAncestor(statement.Parent, func(n *ast.Node) bool {
			return ast.IsFunctionLike(n) || n.Kind == ast.KindClassStaticBlockDeclaration
		})
		if fn == nil {
			return
		}
		switch fn.Kind {
		case ast.KindConstructor, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindClassStaticBlockDeclaration:
			if !inHatch(statement) && r.a.runs(invocation) {
				return
			}
		}
	}
	message := EK4801
	if t := r.c.GetTypeAtLocation(expression); !isEffectType(r.c, t) {
		if !isProgramReference(expression) || r.a.programOf(t) == nil {
			return
		}
		message = discardedProgram
	}
	d := report(r.c, expression, message, messageText(expression, "This expression"))
	switch {
	case body && inEffectCode(statement):
		note(d, "Run it with try: {0}.", r.runText(expression))
	case inHatch(statement):
		note(d, "A hatch body is TypeScript, where an Effect runs only through a runner. Run it outside the hatch.")
	default:
		note(d, "Plain JavaScript runs no Effect: run it with try inside an effect function, or return it.")
	}
}

// discardedProgram is EK4801's text for a program named by reference. {0} is
// the expression.
var discardedProgram = EK4801.With("{0} is a program, and this statement discards it without running it.")

// isProgramReference reports whether expression names a value without
// computing it: an identifier or a member, as in `interrupt` or
// `Console.log`.
func isProgramReference(expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	return ast.IsIdentifier(expression) || ast.IsPropertyAccessExpression(expression)
}

// isHelperCall reports whether expression is a call that the parser wrote
// for a VibeLang form, such as $await(x) for `await x` or $join(x) for
// `join x`, whose own diagnostics say what is wrong with it.
func isHelperCall(expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	return ast.IsCallExpression(expression) && ast.IsIdentifier(expression.Expression()) && strings.HasPrefix(expression.Expression().Text(), "$")
}

// isDiscardingForm reports whether expression is a form whose value a
// statement means to discard, or that runs on its own: an assignment, void,
// delete, a producer's yield, or an async function's await, which EK0103
// reports when its operand is an Effect.
func isDiscardingForm(expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	switch expression.Kind {
	case ast.KindVoidExpression, ast.KindDeleteExpression, ast.KindYieldExpression, ast.KindAwaitExpression:
		return true
	}
	return ast.IsAssignmentExpression(expression, false)
}

// isEffectSubtype reports whether t is an Effect with structure of its own
// (D24), or a union of such types, as Exit is.
func isEffectSubtype(c *checker.Checker, t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		return len(t.Types()) > 0 && core.Every(t.Types(), func(member *checker.Type) bool { return isEffectSubtype(c, member) })
	}
	return effectInterfaceSymbol(c, t) != nil
}

// checkThrow reports what an Effect function's throw statement fails with:
// an Effect value (EK4815), any or unknown (EK4811), or a global Error
// (EK4804). Only effect code's throw is a typed failure (VIP-4, D282). A
// plain function's throw is EK0401 (Plain code never throws, chapter 3), and
// none of these advisories is about it.
func (r *ruleCheck) checkThrow(statement *ast.Node) {
	fn := ast.GetContainingFunction(statement)
	value := statement.Expression()
	if fn == nil || !isLowerable(fn) || value == nil || !r.a.isEffect(fn) {
		return
	}
	t := r.c.GetTypeAtLocation(value)
	switch {
	case isEffectType(r.c, t):
		note(report(r.c, value, EK4815, messageText(value, "This value")), "Run it instead: {0}.", r.runText(value))
	case t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0:
		note(report(r.c, value, EK4811, "This throw", r.c.TypeToString(t), "E"), "Throw an error declaration's instance.")
	default:
		if name := globalErrorName(r.c, t.Symbol()); name != "" {
			noteErrorDeclaration(report(r.c, value, EK4804, name))
		}
	}
}

// noteErrorDeclaration adds EK4804's repair to d.
func noteErrorDeclaration(d *ast.Diagnostic) {
	note(d, "Declare the failure and throw it: error Failed { message: string }, then throw new Failed({ message }).")
}

// globalErrorNames are the error classes of JavaScript's standard library.
var globalErrorNames = []string{"Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError"}

// globalErrorName returns the name of the standard library's error class
// that symbol declares, its instance type or its constructor, or "".
func globalErrorName(c *checker.Checker, symbol *ast.Symbol) string {
	if symbol == nil || len(symbol.Declarations()) == 0 {
		return ""
	}
	name := strings.TrimSuffix(symbol.Name(), "Constructor")
	if !slices.Contains(globalErrorNames, name) {
		return ""
	}
	if !isGlobal(c, symbol) {
		return ""
	}
	return name
}

// checkClass reports EK4805 for a class that extends a standard library
// error, EK4814 for a constructor in a Schema class, and EK4809 for a
// service whose members all need one service.
func (r *ruleCheck) checkClass(class *ast.Node) {
	if classKindOf(class) == serviceClass {
		r.checkLeakingRequirements(class)
		return
	}
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil {
		return
	}
	base := extends.Expression()
	name := "This class"
	if class.Name() != nil {
		name = class.Name().Text()
	}
	if ast.IsIdentifier(base) {
		if errorName := globalErrorName(r.c, r.c.GetSymbolAtLocation(base)); errorName != "" {
			node := class
			if class.Name() != nil {
				node = class.Name()
			}
			d := report(r.c, node, EK4805, name, errorName)
			if ast.HasSyntacticModifier(class, ast.ModifierFlagsExport) {
				// An error declaration's constructor takes one object of its
				// fields, so it cannot keep the positional constructor
				// new Legacy(message, options) that the class exports.
			} else {
				note(d, "Declare it with error instead, as in error {0} { message: string }, so that catch, match, and is can tell it apart by its _tag.", core.IfElse(class.Name() != nil, name, "Failed"))
			}
		}
		return
	}
	if errorDeclarationBase(class) || !isSchemaValue(r.c, r.c.GetTypeAtLocation(base)) {
		return // an error declaration's constructor is EK1301 (error_constructor.go)
	}
	for _, member := range class.Members() {
		if ast.IsConstructorDeclaration(member) && member.Body() != nil {
			d := reportAt(r.c, r.file, constructorKeywordRange(r.file, member), EK4814, name)
			note(d, "Decoding calls it for each value it decodes. Add a static function that makes an instance instead.")
		}
	}
}

// constructorKeywordRange returns the span of member's constructor keyword.
func constructorKeywordRange(file *ast.SourceFile, member *ast.Node) core.TextRange {
	start := scanner.SkipTrivia(file.Text(), member.Pos())
	if keyword := strings.Index(file.Text()[start:member.End()], "constructor"); keyword >= 0 {
		start += keyword
	}
	return core.NewTextRange(start, start+len("constructor"))
}

// isSchemaValue reports whether t is a schema, such as Schema.String or a
// Schema class.
func isSchemaValue(c *checker.Checker, t *checker.Type) bool {
	if t == nil || c.GetPropertyOfType(c.GetApparentType(t), schemaTypeID) == nil {
		return false
	}
	top := servicesFor(c).effectExport("Schema", "Top")
	return top != nil && c.IsTypeAssignableTo(t, c.GetDeclaredTypeOfSymbol(top))
}

// checkLeakingRequirements reports EK4809 when every Effect member of
// service, at least two, needs the same service: each member's caller must
// then provide what the service's own layer could capture once. Scope is
// exempt, and so is a service whose declaration says @vibelang leakable.
func (r *ruleCheck) checkLeakingRequirements(service *ast.Node) {
	symbol := r.c.GetSymbolAtLocation(service.Name())
	if symbol == nil {
		return
	}
	var shared []*checker.Type
	members := 0
	for _, member := range r.c.GetPropertiesOfType(r.c.GetDeclaredTypeOfSymbol(symbol)) {
		if checker.IsServiceBrandProperty(member) {
			continue
		}
		requirements := memberRequirements(r.c, r.c.GetTypeOfSymbol(member))
		if requirements == nil {
			continue
		}
		var needs []*checker.Type
		for _, t := range requirements.Distributed() {
			if t.Flags()&checker.TypeFlagsNever == 0 && !isScopeType(r.c, t) && !isLeakable(t) {
				needs = append(needs, t)
			}
		}
		if members == 0 {
			shared = needs
		} else {
			shared = slices.DeleteFunc(shared, func(t *checker.Type) bool { return !slices.Contains(needs, t) })
		}
		members++
		if len(shared) == 0 {
			return
		}
	}
	if members < 2 {
		return
	}
	names := make([]string, len(shared))
	for i, t := range shared {
		names[i] = r.c.TypeToString(t)
	}
	d := report(r.c, service.Name(), EK4809, service.Name().Text(), strings.Join(names, " and "))
	note(d, "Read {0} where the layer is built, and drop it from the members' contracts. A service meant to pass along, such as a transaction, says @vibelang leakable in its documentation comment.", names[0])
}

// memberRequirements returns the R of a service member's type: an Effect
// property's, or a method's that returns an Effect. It returns nil for any
// other member.
func memberRequirements(c *checker.Checker, t *checker.Type) *checker.Type {
	if isEffectType(c, t) {
		return channelType(c, t, "_R")
	}
	if signatures := c.GetSignaturesOfType(t, checker.SignatureKindCall); len(signatures) == 1 {
		if result := c.GetReturnTypeOfSignature(signatures[0]); isEffectType(c, result) {
			return channelType(c, result, "_R")
		}
	}
	return nil
}

// isLeakable reports whether the declaration of t, a service, says
// @vibelang leakable in its documentation comment.
func isLeakable(t *checker.Type) bool {
	symbol := t.Symbol()
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(declaration)
		for _, doc := range declaration.JSDoc(file) {
			// The JSDoc node is the comment itself, which GetTextOfNode
			// would skip as trivia, past the node's end.
			if strings.Contains(scanner.GetSourceTextOfNodeFromSourceFile(file, doc, true /*includeTrivia*/), "@vibelang leakable") {
				return true
			}
		}
	}
	return false
}

// checkAssertion reports EK4810 when assertion, an as expression or type
// assertion from one Effect type to another, drops failures or
// requirements.
func (r *ruleCheck) checkAssertion(assertion *ast.Node) {
	channel, dropped := assertionDroppedChannel(r.c, assertion)
	if len(dropped) > 0 {
		d := report(r.c, assertion, EK4810, strings.Join(dropped, " | "), channel)
		note(d, "Remove the assertion, and handle or provide what it drops.")
	}
}

// The diagnostic and repairs use the same test for a channel-dropping assertion.
func assertionDroppedChannel(c *checker.Checker, assertion *ast.Node) (string, []string) {
	source := c.GetTypeAtLocation(assertion.Expression())
	target := c.GetTypeFromTypeNode(assertion.Type())
	if !isEffectType(c, source) || !isEffectType(c, target) {
		return "", nil
	}
	for _, channel := range []struct{ name, property string }{{"E", "_E"}, {"R", "_R"}} {
		from, to := channelType(c, source, channel.property), channelType(c, target, channel.property)
		if from == nil || to == nil {
			continue
		}
		var dropped []string
		for _, t := range from.Distributed() {
			if !c.IsTypeAssignableTo(t, to) {
				dropped = append(dropped, c.TypeToString(t))
			}
		}
		if len(dropped) > 0 {
			return channel.name, dropped
		}
	}
	return "", nil
}

// checkNew reports EK4812 at new Promise outside a hatch, and outside a
// lambda that compiles to a plain callback, such as the one
// Effect.promise(() => new Promise(…)) calls.
func (r *ruleCheck) checkNew(node *ast.Node) {
	callee := node.Expression()
	if !ast.IsIdentifier(callee) || callee.Text() != "Promise" || inHatch(node) || !isGlobal(r.c, r.c.GetSymbolAtLocation(callee)) {
		return
	}
	if fn := ast.GetContainingFunction(node); fn != nil && isLambda(fn) && isLowerable(fn) && !r.a.isEffect(fn) {
		return
	}
	d := report(r.c, callee, EK4812)
	note(d, "Wrap a callback API with callback((resume) => …), or a promise you already have with sync(promise).")
}

// isGlobal reports whether the standard library declares symbol. Other
// declarations may add to it, as effect adds to the global Error.
func isGlobal(c *checker.Checker, symbol *ast.Symbol) bool {
	return symbol != nil && slices.ContainsFunc(symbol.Declarations(), func(d *ast.Node) bool {
		return c.Program().IsSourceFileDefaultLibrary(ast.GetSourceFileOfNode(d).PathKey())
	})
}

// checkCall checks a call: Effect.try's or Effect.tryPromise's mapping (EK4806, EK4804),
// Layer.mergeAll (EK4807), JSON (EK4818), Effect.provide (EK4816), and
// a running call that adds any or unknown to a channel (EK4811).
func (r *ruleCheck) checkCall(call *ast.Node) {
	r.checkInferredEffectArguments(call)
	if inHatch(call) {
		return
	}
	switch module, name := effectFunctionOf(r.c, call.Expression()); {
	case module == "Effect" && (name == "try" || name == "try_" || name == "tryPromise"):
		r.checkTryMapping(call)
		return // EK4806 or EK4804 says what its mapping adds to E
	case module == "Layer" && name == "mergeAll":
		r.checkMergeAll(call)
	case module == "Effect" && name == "provide":
		for _, argument := range call.Arguments() {
			if isLayerType(r.c, r.c.GetTypeAtLocation(argument)) {
				r.checkProvidedLayer(argument)
			}
		}
	}
	if callee := call.Expression(); ast.IsPropertyAccessExpression(callee) && ast.IsIdentifier(callee.Expression()) && callee.Expression().Text() == "JSON" {
		if name := callee.Name().Text(); (name == "parse" || name == "stringify") && isGlobal(r.c, r.c.GetSymbolAtLocation(callee.Expression())) {
			d := report(r.c, callee, EK4818, name)
			note(d, "Decode with a schema instead: Schema.decodeUnknownEffect(Schema.fromJsonString(User))(text).")
		}
	}
	if inLowerableBody(call) && r.a.runs(call) {
		r.checkRunChannels(call)
	}
}

// checkTryMapping reports EK4806 or EK4804 at the error mapping of
// Effect.try or Effect.tryPromise, the catch of its options object, that
// returns unknown, any, or a global Error.
func (r *ruleCheck) checkTryMapping(call *ast.Node) {
	arguments := call.Arguments()
	if len(arguments) != 1 || !ast.IsObjectLiteralExpression(arguments[0]) {
		return
	}
	var mapping *ast.Node
	for _, property := range arguments[0].AsObjectLiteralExpression().Properties.Nodes {
		if ast.IsPropertyAssignment(property) && ast.IsIdentifier(property.Name()) && property.Name().Text() == "catch" {
			mapping = property.Initializer()
		} else if ast.IsMethodDeclaration(property) && ast.IsIdentifier(property.Name()) && property.Name().Text() == "catch" {
			mapping = property
		}
	}
	if mapping == nil {
		return
	}
	signatures := r.c.GetSignaturesOfType(r.c.GetTypeAtLocation(mapping), checker.SignatureKindCall)
	if len(signatures) != 1 {
		return
	}
	result := r.c.GetReturnTypeOfSignature(signatures[0])
	if result.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		if isDefectBridge(r.c, call) {
			return
		}
		d := report(r.c, mapping, EK4806, r.c.TypeToString(result))
		note(d, "Return an error declaration's instance: Effect.try({ try: () => code, catch: (cause) => new Failed({ cause }) }).")
		return
	}
	if name := globalErrorName(r.c, result.Symbol()); name != "" {
		noteErrorDeclaration(report(r.c, mapping, EK4804, name))
	}
}

// isDefectBridge reports whether an Effect.try operand reaches Effect.orDie:
// no catch reads what its mapping returns, which a defect keeps as thrown.
// Native pipes have the same meaning as nested calls (VIP-23).
func isDefectBridge(c *checker.Checker, operand *ast.Node) bool {
	for operand.Parent != nil && ast.IsParenthesizedExpression(operand.Parent) {
		operand = operand.Parent
	}
	if pipe := pipeOfLeft(operand); pipe != nil {
		// Another use of the topic can retain the original failure channel.
		topics := topicsOf(pipe)
		return len(topics) == 1 && isDefectBridge(c, topics[0])
	}
	parent := operand.Parent
	if parent == nil || !ast.IsCallExpression(parent) || len(parent.Arguments()) == 0 || parent.Arguments()[0] != operand {
		return false
	}
	callee := ast.SkipParentheses(parent.Expression())
	if len(parent.Arguments()) == 1 {
		return isEffectFunction(c, callee, "Effect", "orDie")
	}
	// The preserving bridge EK0403's fix writes keeps the listed classes as
	// typed failures and dies with anything else: Effect.catch(Effect.try(…),
	// (error) => error instanceof C ? Effect.fail(error) : Effect.die(error)).
	// Its handler is the catch that reads the mapping, so it has what failed.
	return len(parent.Arguments()) == 2 && isEffectFunction(c, callee, "Effect", "catch") && handlerDies(c, parent.Arguments()[1])
}

// handlerDies reports whether handler, a function literal, calls Effect.die.
func handlerDies(c *checker.Checker, handler *ast.Node) bool {
	handler = ast.SkipParentheses(handler)
	if !ast.IsFunctionExpressionOrArrowFunction(handler) {
		return false
	}
	dies := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if dies {
			return true
		}
		if ast.IsCallExpression(n) && isEffectFunction(c, ast.SkipParentheses(n.Expression()), "Effect", "die") {
			dies = true
			return true
		}
		return n.ForEachChild(visit)
	}
	handler.ForEachChild(visit)
	return dies
}

// checkRunChannels reports EK4811 when call, which runs, adds any or unknown
// to its function's E or R.
func (r *ruleCheck) checkRunChannels(call *ast.Node) {
	signature := r.c.GetResolvedSignature(call)
	if signature == nil {
		return
	}
	result := r.c.GetReturnTypeOfSignature(signature)
	if !isEffectType(r.c, result) {
		return
	}
	for _, channel := range []struct{ name, property string }{{"E", "_E"}, {"R", "_R"}} {
		if t := channelType(r.c, result, channel.property); t != nil && t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
			d := report(r.c, call, EK4811, messageText(call, "This call"), r.c.TypeToString(t), channel.name)
			note(d, "Give the callee a contract that names its {0}.", core.IfElse(channel.name == "E", "failures", "services"))
			return
		}
	}
}

// checkMergeAll reports EK4807 at each argument of call, a Layer.mergeAll
// call, that needs a service another argument provides.
func (r *ruleCheck) checkMergeAll(call *ast.Node) {
	arguments := call.Arguments()
	provided := make([]*checker.Type, len(arguments))
	needs := make([]*checker.Type, len(arguments))
	for i, argument := range arguments {
		provided[i], _, needs[i] = layerChannels(r.c, r.c.GetTypeAtLocation(argument))
	}
	for i, argument := range arguments {
		for j, provider := range arguments {
			if i == j || needs[i] == nil || provided[j] == nil {
				continue
			}
			var services []string
			for _, t := range needs[i].Distributed() {
				if slices.Contains(provided[j].Distributed(), t) {
					services = append(services, r.c.TypeToString(t))
				}
			}
			if len(services) > 0 {
				d := report(r.c, argument, EK4807, messageText(argument, "This layer"), strings.Join(services, " and "), messageText(provider, "another layer"))
				note(d, "Use Layer.provide or Layer.provideMerge to supply construction dependencies; Layer.mergeAll builds its layers independently.")
				break
			}
		}
	}
}

// checkProvide reports EK4808 when block, a provide block, holds nothing but
// another provide block, and EK4816 for each layer it provides.
func (r *ruleCheck) checkProvide(block *ast.Node) {
	statements := block.Statements()
	if len(statements) == 2 && isProvideBlock(statements[1]) {
		inner := statements[1]
		d := reportAt(r.c, r.file, core.NewTextRange(scanner.SkipTrivia(r.file.Text(), inner.Pos()), provideLayer(inner).End()), EK4808)
		note(d, "Combine independent layers with provide A, B { … }; use Layer.provideMerge(A)(B) when B needs A, retaining both layer outputs. Review evaluation and build order before combining blocks.")
	}
	for _, provider := range providerList(provideLayer(block)) {
		if !isServiceProvider(provider) && isLayerType(r.c, r.c.GetTypeAtLocation(provider)) {
			r.checkProvidedLayer(provider)
		}
	}
}

// providerList returns the providers of a provide block's layer expression:
// the elements of the array that a comma list becomes (D173), or the one
// provider.
func providerList(providers *ast.Node) []*ast.Node {
	if ast.IsArrayLiteralExpression(providers) {
		return providers.AsArrayLiteralExpression().Elements.Nodes
	}
	return []*ast.Node{providers}
}

// isServiceProvider reports whether provider is a provide block's
// Key = value, which the parser writes as a call to $provideService.
func isServiceProvider(provider *ast.Node) bool {
	return ast.IsCallExpression(provider) && ast.IsIdentifier(provider.Expression()) && provider.Expression().Text() == "$provideService"
}

// isLayerType reports whether t is a Layer.
func isLayerType(c *checker.Checker, t *checker.Type) bool {
	provided, _, _ := layerChannels(c, t)
	return provided != nil
}

// checkProvidedLayer reports EK4816 at layer, including in a function named
// main: an entry point is a project policy, not a function-name convention.
func (r *ruleCheck) checkProvidedLayer(layer *ast.Node) {
	note(report(r.c, layer, EK4816, messageText(layer, "This layer")), "Compose layers at the application entry point. If this is an entry point, disable this diagnostic for the site.")
}

// checkOutdated reports EK4813 at access, a name that Effect 3's Effect
// module had and Effect 4's does not, in place of TypeScript's TS2339.
func (r *ruleCheck) checkOutdated(access *ast.Node) {
	name := access.Name()
	if !ast.IsIdentifier(name) {
		return
	}
	change, ok := effect3API[name.Text()]
	if !ok || effectModuleOf(r.c, access.Expression()) != "Effect" || r.c.GetPropertyOfType(r.c.GetTypeAtLocation(access.Expression()), name.Text()) != nil {
		return
	}
	module := scanner.GetTextOfNode(access.Expression())
	if change.renamed != "" {
		d := report(r.c, name, EK4813, module, name.Text(), change.renamed)
		if change.note != "" {
			note(d, change.note)
		}
	} else {
		report(r.c, name, outdatedAPI, module, name.Text())
	}
	cover(r.c, name)
}

// checkInstanceOf reports EK4817 at an instanceof whose right side is a
// schema class.
func (r *ruleCheck) checkInstanceOf(node *ast.Node) {
	right := node.AsBinaryExpression().Right
	if isSchemaValue(r.c, r.c.GetTypeAtLocation(right)) {
		report(r.c, node, EK4817, messageText(right, "the class"))
	}
}

// checkDuplicatePackages reports EK4803 at file's first statement for each
// Effect package that the program loads more than one version of.
func (r *ruleCheck) checkDuplicatePackages() {
	statements := r.file.Statements.Nodes
	if len(statements) == 0 {
		return
	}
	for _, duplicate := range duplicatePackagesOf(r.c) {
		d := report(r.c, statements[0], EK4803, duplicate.name, strconv.Itoa(len(duplicate.versions)))
		for _, version := range duplicate.versions {
			note(d, "{0}@{1} is at {2}.", duplicate.name, version.version, version.directory)
		}
		note(d, "Install one version, for example by overriding it in package.json.")
	}
}

// duplicatePackage is an Effect package that a program loads more than one
// version of.
type duplicatePackage struct {
	name     string
	versions []packageVersion
}

// packageVersion is one version of a package, and the first directory the
// program loads it from.
type packageVersion struct {
	version   string
	directory string
}

type duplicatePackagesKey struct{}

// duplicatePackagesOf returns the Effect packages, effect, @effect/*, and
// vibelang-runtime, that c's program loads more than one version of, as
// Effect's language service counts them. A file belongs to the package of
// the nearest package.json above it. Two copies of one version are not
// reported: a project may install them for tools, and the program's types
// agree.
func duplicatePackagesOf(c *checker.Checker) []duplicatePackage {
	return c.ExtensionState(duplicatePackagesKey{}, func() any {
		program := c.Program()
		versions := map[string][]packageVersion{}
		var names []string
		seen := map[string]bool{}
		for _, file := range program.SourceFiles() {
			directory := program.GetNearestAncestorDirectoryWithPackageJson(file.FileName().Directory())
			if directory == "" || seen[directory.AsString()] {
				continue
			}
			seen[directory.AsString()] = true
			info := program.GetPackageJsonInfo(directory.ResolveFile("package.json"))
			if !info.Exists() {
				continue
			}
			name, _ := info.Contents.Name.GetValue()
			if name != "effect" && name != "vibelang-runtime" && !strings.HasPrefix(name, "@effect/") {
				continue
			}
			version, _ := info.Contents.Version.GetValue()
			if versions[name] == nil {
				names = append(names, name)
			}
			if !slices.ContainsFunc(versions[name], func(v packageVersion) bool { return v.version == version }) {
				versions[name] = append(versions[name], packageVersion{version, directory.AsString()})
			}
		}
		var duplicates []duplicatePackage
		for _, name := range names {
			if len(versions[name]) > 1 {
				duplicates = append(duplicates, duplicatePackage{name, versions[name]})
			}
		}
		return duplicates
	}).([]duplicatePackage)
}

// effectModuleOf returns the name of effect's module that expression names,
// such as Effect, or "".
func effectModuleOf(c *checker.Checker, expression *ast.Node) string {
	symbol := c.GetSymbolAtLocation(expression)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return ""
	}
	for _, declaration := range symbol.Declarations() {
		if ast.IsSourceFile(declaration) {
			return effectModuleOfFile(declaration.AsSourceFile())
		}
	}
	return ""
}

// effectFunctionOf returns the module and name of the effect export that
// callee names, such as Layer and mergeAll for Layer.mergeAll, or "".
func effectFunctionOf(c *checker.Checker, callee *ast.Node) (module string, name string) {
	if ast.IsPropertyAccessExpression(callee) {
		callee = callee.Name()
	}
	if !ast.IsIdentifier(callee) {
		return "", ""
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || len(symbol.Declarations()) == 0 {
		return "", ""
	}
	return effectModuleOfFile(ast.GetSourceFileOfNode(symbol.Declarations()[0])), symbol.Name()
}

// nodeText returns node's source text for a message, or otherwise when the
// text is long or spans lines.
func messageText(node *ast.Node, otherwise string) string {
	text := scanner.GetTextOfNode(node)
	if len(text) > 40 || strings.ContainsAny(text, "\r\n") {
		return otherwise
	}
	return text
}

// runText spells running expression with try (VIP-5): try e for an Effect
// value, try f() for a program named by reference, a function of no
// arguments that returns one, and parentheses around an operand that needs
// them: try (a ?? b).
func (r *ruleCheck) runText(expression *ast.Node) string {
	return runSpelling(r.c, expression)
}

func runSpelling(c *checker.Checker, expression *ast.Node) string {
	text := messageText(expression, "the expression")
	if needsParentheses(expression) {
		text = "(" + text + ")"
	}
	if analyzerFor(c).programOf(c.GetTypeAtLocation(expression)) != nil {
		text += "()"
	}
	return "try " + text
}

// needsParentheses reports whether expression needs parentheses before a
// call's argument list.
func needsParentheses(expression *ast.Node) bool {
	switch expression.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression, ast.KindParenthesizedExpression, ast.KindThisKeyword:
		return false
	}
	return true
}
