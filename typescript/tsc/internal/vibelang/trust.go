package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A call to code that is not Effect needs a declared trust level (design D5,
// D22, D23, D51). Nothing in a plain function's type says whether it throws,
// so each kind of callee has a rule:
//
//	formatName(user)          // plain TypeScript: EK0403 without a boundary
//	parsePortTrusted(text)    // @vibelang trusted, @throws {PortError}: PortError joins E
//	JSON.parse(text)          // a built-in: SyntaxError joins E
//	Option.getOrThrow(o)      // effect's own export: exceptions are defects
//	Effect.try(() => legacyParse(text))   // a boundary: plain calls are allowed inside
//
// The foreign-call gate applies only to code a fiber runs: a module's top level, and the
// plain callbacks it passes to TypeScript functions, are JavaScript, where an
// exception fails the module's import or the caller's callback (D51).

// trustKind is the trust level of a call's callee.
type trustKind uint8

const (
	trustUnknown  trustKind = iota // no declaration to judge, as for a callee of type any
	trustES                        // VibeLang code, or a parameter of a .vibe function
	trustEffect                    // an export of a trusted package (D22, D261)
	trustBuiltin                   // a JavaScript built-in that TypeScript's lib files declare (D5)
	trustTagged                    // a declaration tagged @vibelang trusted (D23)
	trustPlatform                  // a platform package such as @types/node, which EK4402 reports
	trustForeign                   // any other function: EK0403 outside a boundary
)

// trust is what VibeLang knows about calling one callee.
type trust struct {
	declaration *ast.Node // the tagged declaration, retained for D249 migration edits
	kind        trustKind
	failures    []failure // the exceptions that are expected failures, which join E
	promise     bool      // the call returns a Promise
	unreachable string    // a @throws type that names no class, as written
	value       bool      // the callee is a trusted(impl, [Errors]) value, which lists its failures in its type (D514)
	unknown     bool      // a written @throws {unknown} or {any}: an affirmative may-throw contract, unlike no tag (detail 255)
}

// failure is a class whose instances a call throws as expected failures.
type failure struct {
	name   string        // the class's name
	class  *ast.Symbol   // the class, a value the generated code tests with instanceof
	t      *checker.Type // its instances' type, which joins E
	global bool          // a global class such as SyntaxError, which needs no import
}

// trustState is what one checker remembers about trust.
type trustState struct {
	calls      map[*ast.Node]*trust // call -> its callee's trust
	boundaries map[*ast.Node]bool   // lambda -> it is a callback of a boundary
}

type trustStateKey struct{}

func trustOf(c *checker.Checker) *trustState {
	return c.ExtensionState(trustStateKey{}, func() any {
		return &trustState{calls: map[*ast.Node]*trust{}, boundaries: map[*ast.Node]bool{}}
	}).(*trustState)
}

// callTrust returns the trust level of call's callee.
func callTrust(c *checker.Checker, call *ast.Node) *trust {
	s := trustOf(c)
	if t, ok := s.calls[call]; ok {
		return t
	}
	t := computeTrust(c, call)
	s.calls[call] = t
	return t
}

func computeTrust(c *checker.Checker, call *ast.Node) *trust {
	if failures, ok := trustedValueFailures(c, ast.GetInvokedExpression(call)); ok {
		return &trust{kind: trustTagged, failures: failures, value: true}
	}
	decl := signatureDeclaration(c, call)
	if decl == nil {
		if sig := c.GetResolvedSignature(call); sig != nil {
			result := c.GetReturnTypeOfSignature(sig)
			if result.Flags()&checker.TypeFlagsAny != 0 && result.AsIntrinsicType().IntrinsicName() == "error" {
				return &trust{kind: trustES} // TypeScript owns the invalid call.
			}
		}
		// Erased callable types have no signature contract. Even a VibeLang
		// parameter of type any or Function throws unknown (VIP-4).
		return &trust{kind: trustUnknown}
	}
	if isParameterCall(c, call) {
		return &trust{kind: trustES}
	}
	file := ast.GetSourceFileOfNode(decl)
	if isVibeLangFile(file) {
		return &trust{kind: trustES}
	}
	// A const that re-exports a library function with the tag trusts it (D23),
	// so the tag on what the callee names wins over the library's declaration.
	candidates := foreignCallBindingCandidates(c, call, true)
	switch pkg := packageOf(c, file); {
	case isLibFile(c, file):
		return tagged(c, call, candidates, builtinTrust(c, call, decl))
	case isTrustedPackage(c, ast.GetSourceFileOfNode(call), pkg):
		return tagged(c, call, candidates, &trust{kind: trustEffect})
	case isPlatformPackage(pkg):
		return tagged(c, call, candidates, &trust{kind: trustPlatform})
	}
	candidates = append(candidates, decl)

	t := tagged(c, call, candidates, &trust{kind: trustForeign, promise: returnsPromise(c, call)})
	if t.kind == trustForeign && reachedThroughTrustedPackage(c, call, file.IsDeclarationFile) {
		return &trust{kind: trustEffect}
	}
	return t
}

// trustedValueFailures returns the classes that callee, a value of the
// runtime's Trusted<F, Errors>, lists as its expected failures, and false
// when callee is not such a value (D514). trusted(impl, [Errors]) returns one
// plain function, which carries the classes as [$errors]; its type says
// which. Only a name, or a module's member, bound by a const whose type is
// written or whose initializer calls trusted is read, so asking never checks
// an arbitrary expression while its call's trust is being computed.
func trustedValueFailures(c *checker.Checker, callee *ast.Node) ([]failure, bool) {
	symbol := trustedValueSymbol(c, callee)
	if symbol == nil {
		return nil, false
	}
	errors := trustedErrorsProperty(c, c.GetTypeOfSymbol(symbol))
	if errors == nil {
		return nil, false
	}
	list := c.GetTypeOfSymbol(errors)
	if list == nil || !checker.IsTupleType(list) {
		return nil, true
	}
	var failures []failure
	for _, element := range c.GetTypeArguments(list) {
		// A class's static side, or a built-in's constructor interface such
		// as SyntaxErrorConstructor: the instances' type names the class.
		symbol := element.Symbol()
		if constructors := c.GetConstructSignatures(element); len(constructors) > 0 {
			if instance := c.GetReturnTypeOfSignature(constructors[0]).Symbol(); instance != nil {
				symbol = instance
			}
		}
		if symbol == nil {
			continue
		}
		if f, ok := classFailure(c, symbol.Name(), symbol); ok {
			failures = append(failures, f)
		}
	}
	return failures, true
}

// trustedValueSymbol returns the variable that callee names when it may hold
// a trusted value: a const or let declared with a type, as a declaration file
// declares one, or initialized with a call of trusted.
func trustedValueSymbol(c *checker.Checker, callee *ast.Node) *ast.Symbol {
	if callee == nil {
		return nil
	}
	callee = ast.SkipParentheses(callee)
	switch {
	case ast.IsIdentifier(callee):
	case ast.IsPropertyAccessExpression(callee) && ast.IsIdentifier(callee.Expression()) && ast.IsIdentifier(callee.Name()):
		owner := c.GetSymbolAtLocation(callee.Expression())
		if owner == nil || owner.Flags()&(ast.SymbolFlagsAlias|ast.SymbolFlagsModule) == 0 {
			return nil // a member of a value, which this does not read
		}
	default:
		return nil
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsVariable == 0 {
		return nil
	}
	d := symbol.ValueDeclaration()
	if d == nil || !ast.IsVariableDeclaration(d) {
		return nil
	}
	if d.Type() != nil {
		return symbol
	}
	if init := d.Initializer(); init != nil {
		init = ast.SkipParentheses(init)
		if ast.IsCallExpression(init) && ast.IsIdentifier(init.Expression()) && init.Expression().Text() == "trusted" {
			return symbol
		}
	}
	return nil
}

// trustedErrorsProperty returns t's [$errors] property, which the runtime's
// Trusted<F, Errors> declares, or nil.
func trustedErrorsProperty(c *checker.Checker, t *checker.Type) *ast.Symbol {
	if t == nil || t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 {
		return nil
	}
	for _, property := range c.GetPropertiesOfType(t) {
		for _, d := range property.Declarations() {
			name := d.Name()
			if name == nil || !ast.IsComputedPropertyName(name) || !ast.IsIdentifier(name.Expression()) || name.Expression().Text() != "$errors" {
				continue
			}
			if packageOf(c, ast.GetSourceFileOfNode(d)) == "vibelang-runtime" {
				return property
			}
		}
	}
	return nil
}

// reachedThroughTrustedPackage reports whether call's callee is an export of one of
// trusted packages (D22, D261), a member of one, or a function or method of a value
// that a trusted call to one returned (D22), called at once or held in a const.
// A package may re-export another package's functions, as @effect/vitest
// re-exports vitest's assert and expect, so their declarations alone do not
// show that they are Effect's:
//
//	import { assert, expect, vi } from "@effect/vitest"
//	assert.strictEqual(n, 1)   // assert is an export of @effect/vitest
//	expect(n).toBe(1)          // toBe is a method of what expect returned
//	const spy = vi.spyOn(o, "f")
//	spy.mockRestore()          // mockRestore is a method of what spyOn returned
func reachedThroughTrustedPackage(c *checker.Checker, call *ast.Node, followReturned bool) bool {
	callee := ast.SkipParentheses(ast.GetInvokedExpression(call))
	for {
		switch {
		case ast.IsPropertyAccessExpression(callee), ast.IsElementAccessExpression(callee):
			callee = ast.SkipParentheses(callee.Expression())
		case ast.IsCallExpression(callee):
			// A returned value whose own TypeScript source declares its methods
			// keeps the source package's trust; exports and re-exports are trusted.
			return followReturned && callTrust(c, callee).kind == trustEffect
		case ast.IsIdentifier(callee):
			if initializer := constCallInitializer(c, callee); initializer != nil {
				// A const holds what its trusted call returned; a let may not.
				return followReturned && callTrust(c, initializer).kind == trustEffect
			}
			return importedFromTrustedPackage(c, callee)
		default:
			return false
		}
	}
}

// constCallInitializer returns the call that initializes the const name
// refers to, as vi.spyOn(o, "f") in const spy = vi.spyOn(o, "f"), or nil.
func constCallInitializer(c *checker.Checker, name *ast.Node) *ast.Node {
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil {
		return nil
	}
	decl := symbol.ValueDeclaration()
	if decl == nil {
		return nil
	}
	if !ast.IsVariableDeclaration(decl) || !ast.IsVarConst(decl) || decl.Initializer() == nil {
		return nil
	}
	initializer := ast.SkipParentheses(decl.Initializer())
	if !ast.IsCallExpression(initializer) {
		return nil
	}
	return initializer
}

// importedFromTrustedPackage reports whether name is bound by an import from one of
// trusted packages, whichever module declares what the import names.
func importedFromTrustedPackage(c *checker.Checker, name *ast.Node) bool {
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 {
		return false
	}
	for _, decl := range symbol.Declarations() {
		statement := ast.FindAncestorKind(decl, ast.KindImportDeclaration)
		if statement == nil {
			continue
		}
		module := c.ResolveExternalModuleName(statement.ModuleSpecifier(), nil /*importAttributesType*/)
		if module == nil {
			continue
		}
		for _, moduleDecl := range module.Declarations() {
			if file := ast.GetSourceFileOfNode(moduleDecl); file != nil && isTrustedPackage(c, ast.GetSourceFileOfNode(name), packageOf(c, file)) {
				return true
			}
		}
	}
	return false
}

// tagged returns the trust of a declaration among candidates that says what
// it throws, with `@throws {E}` or `@vibelang trusted`, and is declared
// outside lib files and trusted packages, else otherwise. A declaration
// whose only tag is `@throws {unknown}` says what having none says (VIP-4).
func tagged(c *checker.Checker, call *ast.Node, candidates []*ast.Node, otherwise *trust) *trust {
	for _, candidate := range candidates {
		file := ast.GetSourceFileOfNode(candidate)
		if file == nil || isLibFile(c, file) || isTrustedPackage(c, ast.GetSourceFileOfNode(call), packageOf(c, file)) {
			continue
		}
		for _, host := range jsdocHosts(candidate) {
			// A tag belongs to the call signature, never to its type alias
			// (003 Thrown types), as foreignThrowsContract reads it.
			if ast.IsTypeAliasDeclaration(host) {
				break
			}
			throws := hasThrowsTag(host)
			if !hasTrustedTag(host) && !throws {
				continue
			}
			t := &trust{kind: trustTagged, promise: returnsPromise(c, call), declaration: candidate}
			var unknown bool
			t.failures, t.unreachable, unknown = throwsOf(c, host)
			if unknown {
				if !throws {
					return otherwise
				}
				o := *otherwise
				o.unknown = true
				return &o
			}
			return t
		}
	}
	return otherwise
}

// isParameterCall reports whether call calls a parameter of a function in an
// .vibe file. The caller chose the function it passed, so the call is that
// function's business, whatever type declares the parameter.
func isParameterCall(c *checker.Checker, call *ast.Node) bool {
	callee := ast.SkipParentheses(ast.GetInvokedExpression(call))
	if !ast.IsIdentifier(callee) {
		return false
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol == nil {
		return false
	}
	decl := symbol.ValueDeclaration()
	for decl != nil && ast.IsBindingElement(decl) {
		decl = decl.Parent.Parent
	}
	return decl != nil && decl.Kind == ast.KindParameter && isVibeLangFile(ast.GetSourceFileOfNode(decl))
}

// isPlatformPackage reports whether name is a package of platform type
// declarations, whose functions are platform APIs (EK4402).
func isPlatformPackage(name string) bool {
	switch name {
	case "@types/node", "@types/bun", "bun-types", "@types/deno", "undici-types":
		return true
	}
	return false
}

// returnsPromise reports whether call returns a Promise, which VibeLang
// code waits on with Effect.tryPromise.
func returnsPromise(c *checker.Checker, call *ast.Node) bool {
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	symbol := c.GetReturnTypeOfSignature(signature).Symbol()
	if symbol == nil || (symbol.Name() != "Promise" && symbol.Name() != "PromiseLike") {
		return false
	}
	return isGlobalOf(symbol, func(file *ast.SourceFile) bool { return isLibFile(c, file) })
}

// jsdocHosts returns decl and the nodes above it that can carry decl's JSDoc:
// for an arrow function a const initializes, the variable declaration and
// its statement; for a function type a property has, the property.
func jsdocHosts(decl *ast.Node) []*ast.Node {
	var hosts []*ast.Node
	for n := decl; n != nil; n = n.Parent {
		hosts = append(hosts, n)
		switch n.Kind {
		case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindFunctionType, ast.KindParenthesizedExpression,
			ast.KindParenthesizedType, ast.KindAsExpression, ast.KindSatisfiesExpression,
			ast.KindVariableDeclaration, ast.KindVariableDeclarationList:
			continue
		}
		return hosts
	}
	return hosts
}

// hasTrustedTag reports whether node's JSDoc says `@vibelang trusted`.
func hasTrustedTag(node *ast.Node) bool {
	for _, jsdoc := range node.JSDoc(nil) {
		for _, tag := range jsdocTags(jsdoc) {
			if tag.TagName() != nil && tag.TagName().Text() == "vibelang" && strings.HasPrefix(strings.TrimSpace(jsdocComment(tag)), "trusted") {
				return true
			}
		}
	}
	return false
}

func jsdocTags(jsdoc *ast.Node) []*ast.Node {
	if tags := jsdoc.AsJSDoc().Tags; tags != nil {
		return tags.Nodes
	}
	return nil
}

// jsdocComment returns the text of tag's comment.
func jsdocComment(tag *ast.Node) string {
	list := tag.CommentList()
	if list == nil {
		return ""
	}
	var b strings.Builder
	for _, part := range list.Nodes {
		if part.Kind == ast.KindJSDocText {
			b.WriteString(part.Text())
		}
	}
	return b.String()
}

// hasThrowsTag reports whether node's JSDoc has a `@throws {T}` tag.
func hasThrowsTag(node *ast.Node) bool {
	for _, jsdoc := range node.JSDoc(nil) {
		for _, tag := range jsdocTags(jsdoc) {
			if ast.IsJSDocThrowsTag(tag) && tag.AsJSDocThrowsTag().TypeExpression != nil {
				return true
			}
		}
	}
	return false
}

// throwsOf reads the `@throws {T}` tags of host's JSDoc. Each names a class
// in host's scope whose instances are expected failures; `@throws {never}`
// names none, and `@throws {unknown}` says the function may throw anything
// (VIP-4). It returns the failures, the text of the first type that names no
// class, and whether a tag says unknown.
func throwsOf(c *checker.Checker, host *ast.Node) ([]failure, string, bool) {
	var failures []failure
	for _, jsdoc := range host.JSDoc(nil) {
		for _, tag := range jsdocTags(jsdoc) {
			if !ast.IsJSDocThrowsTag(tag) || tag.AsJSDocThrowsTag().TypeExpression == nil {
				continue
			}
			t := tag.AsJSDocThrowsTag().TypeExpression.AsJSDocTypeExpression().Type
			switch {
			case t != nil && t.Kind == ast.KindNeverKeyword:
				continue
			case t != nil && (t.Kind == ast.KindUnknownKeyword || t.Kind == ast.KindAnyKeyword):
				return nil, "", true
			}
			name := ""
			if t != nil && ast.IsTypeReferenceNode(t) && ast.IsIdentifier(t.AsTypeReferenceNode().TypeName) {
				name = t.AsTypeReferenceNode().TypeName.Text()
			}
			f, ok := classFailure(c, name, c.ResolveName(name, host, ast.SymbolFlagsValue, false /*excludeGlobals*/))
			if !ok {
				file := ast.GetSourceFileOfNode(host)
				return nil, file.Text()[t.Pos():t.End()], false
			}
			failures = append(failures, f)
		}
	}
	return failures, "", false
}

// classFailure makes the failure for symbol, a class named name, or reports
// false when symbol is not a class.
func classFailure(c *checker.Checker, name string, symbol *ast.Symbol) (failure, bool) {
	if name == "" || symbol == nil {
		return failure{}, false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol.Flags()&(ast.SymbolFlagsClass|ast.SymbolFlagsInterface) == 0 || symbol.Flags()&ast.SymbolFlagsValue == 0 {
		return failure{}, false
	}
	global := isGlobalOf(symbol, func(file *ast.SourceFile) bool { return isLibFile(c, file) })
	return failure{name: name, class: c.GetMergedSymbol(symbol), t: c.GetDeclaredTypeOfSymbol(symbol), global: global}, true
}

// builtinTrust returns the trust of the built-in that decl, a lib file's
// declaration, declares: the classes VibeLang's annotation of it lists
// (globalThrowsTable) are expected failures, and a built-in the table does
// not annotate throws unknown (VIP-4).
func builtinTrust(c *checker.Checker, call *ast.Node, decl *ast.Node) *trust {
	names, known := globalThrowsOf(globalKey(decl))
	if !known {
		return &trust{kind: trustForeign, promise: returnsPromise(c, call)}
	}
	var failures []failure
	for _, name := range names {
		if f, ok := classFailure(c, name, c.GetGlobalSymbol(name, ast.SymbolFlagsValue, nil /*diagnostic*/)); ok {
			failures = append(failures, f)
		}
	}
	return &trust{kind: trustBuiltin, failures: failures}
}

// boundaryAPIs are the exports of effect's Effect module that are explicit
// boundaries to plain code (D23, D43). Effect.try is declared as try_.
var boundaryAPIs = []string{"try_", "try", "tryPromise", "sync", "promise", "callback"}

// isBoundaryCall reports whether call calls one of Effect's explicit
// boundaries, whose callbacks may call plain TypeScript.
func isBoundaryCall(c *checker.Checker, call *ast.Node) bool {
	return isExportOf(c, call, "effect", "Effect", boundaryAPIs)
}

// isExportOf reports whether the signature call resolves to belongs to an
// export of module in package pkg whose name is one of names.
func isExportOf(c *checker.Checker, call *ast.Node, pkg string, module string, names []string) bool {
	owner := ownerOf(signatureDeclaration(c, call))
	if owner == nil || !slices.Contains(names, declarationName(owner)) {
		return false
	}
	file := ast.GetSourceFileOfNode(owner)
	return moduleOf(file) == module && packageOf(c, file) == pkg
}

// isBoundaryCallback reports whether fn, a function, is passed to a boundary
// such as Effect.try, directly or as a property of its options object.
func isBoundaryCallback(c *checker.Checker, fn *ast.Node) bool {
	s := trustOf(c)
	if inside, ok := s.boundaries[fn]; ok {
		return inside
	}
	call, _ := ownerCall(fn)
	inside := call != nil && ast.IsCallExpression(call) && isBoundaryCall(c, call)
	s.boundaries[fn] = inside
	return inside
}

// outsideFibers reports whether node belongs to native TypeScript code:
// the module, an async function or a plain function. VIP-1 gives argument
// callbacks the same plain body as assigned and returned callbacks, regardless
// of the caller's function kind. Only an explicit Effect activation owns the
// Effect restrictions; passing a plain callback does not change its kind.
func outsideFibers(c *checker.Checker, a *analyzer, node *ast.Node) bool {
	if inHatch(node) {
		return true // a hatch's body is the way back in to TypeScript (D148)
	}
	fn := enclosingFunction(node)
	if fn == nil {
		return true
	}
	if ast.HasSyntacticModifier(fn, ast.ModifierFlagsAsync) {
		return true // its body is TypeScript, and it runs on a Promise (VIP-1)
	}
	if a.isEffect(fn) {
		return false
	}
	return true // every unmarked callback retains its TypeScript body (VIP-1)
}

// inParameterListOf reports whether node stands in a parameter of fn: a
// default, a destructuring default or a computed binding key.
func inParameterListOf(node, fn *ast.Node) bool {
	for n := node.Parent; n != nil && n != fn; n = n.Parent {
		if n.Kind == ast.KindParameter && n.Parent == fn {
			return true
		}
	}
	return false
}

// foreignCallInEffectParameters is EK0401's text for a call whose throwing
// is unknown in an effect function's or producer's parameter list. {0} is
// the callee.
var foreignCallInEffectParameters = EK0401.With("'{0}' may throw, and an effect function's parameter list runs at the call, before its Effect exists, so nothing there may throw. Compute the value in the body, or move the code to a '.ts' file.")

// enclosingFunction returns the function whose body holds node, or nil at
// the module's top level.
func enclosingFunction(node *ast.Node) *ast.Node {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) && n.Body() != nil {
			return n
		}
	}
	return nil
}

func init() {
	fileChecks = append(fileChecks, checkTrust)
}

// promiseCall is EK4401's text for a call that returns a Promise.
var promiseCall = EK4401.With("{0} returns a Promise, and nothing says what its rejections mean.")

// unreachableThrows is EK4401's text for a trusted contract whose @throws
// names something the generated code cannot test with instanceof.
var unreachableThrows = EK4401.With("{0} is trusted to throw {1}, but {1} is not a class this file can import.")

// unimportedThrows is EK4401's text for a @throws class that no module this
// file imports exports.
var unimportedThrows = EK4401.With("{0} is trusted to throw {1}, but no module this file imports exports {1}.")

// checkTrust reports EK0403 for unknown synchronous foreign calls and legacy
// trust diagnostics for Promise or unreachable-class contracts, outside boundaries. Code that no fiber
// runs, the module's top level and the plain callbacks it passes to
// TypeScript functions, is JavaScript (D51).
func checkTrust(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node, boundary bool) bool
	visit = func(node *ast.Node, boundary bool) bool {
		if ast.IsFunctionLike(node) && node.Body() != nil {
			boundary = boundary || isBoundaryCallback(c, node)
		}
		if ast.IsCallExpression(node) && !boundary && (!outsideFibers(c, a, node) || a.inEffectfulPlainHome(node)) {
			checkCall(c, a, file, node)
		}
		if (ast.IsNewExpression(node) || ast.IsTaggedTemplateExpression(node)) && !boundary && (!outsideFibers(c, a, node) || a.inEffectfulPlainHome(node)) {
			checkInvocation(c, a, file, node)
		}
		if hatchOf(node) != "" {
			// A hatch's TypeScript is a boundary (D148); its mapper and inputs are VibeLang (D232).
			for i, argument := range node.Arguments() {
				if visit(argument, boundary || i == 0) {
					return true
				}
			}
			return false
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, boundary) })
	}
	file.AsNode().ForEachChild(func(child *ast.Node) bool { return visit(child, false) })
}

func checkCall(c *checker.Checker, a *analyzer, file *ast.SourceFile, call *ast.Node) {
	if unwrappedPromiseInvocation(c, call) {
		return
	}
	effectfulPlain := false
	if fn := enclosingFunction(call); fn != nil && !a.runsAsEffect(fn) {
		if !a.isEffectfulPlainHome(fn, call) {
			return // D282: a plain function's calls of TypeScript code are JavaScript calls
		}
		effectfulPlain = true
	}
	if ast.IsSuperCall(call) || ast.IsImportCall(call) || a.performs(call) || isPlatformCallee(c, call) || returnsEffectful(c, call) {
		return
	}
	t := callTrust(c, call)
	callee := call.Expression()
	name := nodeText(file, callee)
	if effectfulPlain {
		// Chapter 3 (Plain code never throws): a plain function whose return
		// type is wholly effectful is stricter, and any thrown type other than
		// never is EK0401. A written contract is the plain-code pass's.
		if _, written := foreignThrowsContract(c, call); !written && (t.kind == trustForeign || t.kind == trustUnknown) && !t.promise && !t.value && a.knownThrows(call) == nil {
			report(c, callee, unknownThrowInEffectful, name)
		}
		return
	}
	// Chapter 1 (Static rules) and chapter 3 (Code outside the generator):
	// an effect function's parameter list, a class field initializer and a
	// static block are not effect code. A call whose throwing is unknown
	// stays an ordinary call in a field initializer or static block; in an
	// effect function's or producer's parameter list its thrown type,
	// unknown, is not never, so it is EK0401 there rather than EK0403.
	switch home := a.plainHomeOf(call); {
	case home == nil:
	case home.Kind == ast.KindPropertyDeclaration && home.Initializer() != nil && ast.IsNodeDescendantOf(call, home.Initializer()),
		home.Kind == ast.KindClassStaticBlockDeclaration:
		return // a computed name or decorator keeps its enclosing context
	case ast.IsFunctionLike(home) && (isMarkedEffect(home) || isProducer(home)) && inParameterListOf(call, home):
		// Known throws are already owned by the plain-code pass. The
		// stricter parameter check adds only previously unknown throwing.
		if t.kind == trustForeign && !t.promise && a.knownThrows(call) == nil {
			d := report(c, callee, foreignCallInEffectParameters, name)
			note(d, "Compute the value in the body with {0}.", boundaryCall(c, file, "try", call, ""))
		}
		return
	}
	// @throws is a contract, not an implicit bridge. Keep explicit trusted
	// values on their existing runtime contract; ordinary foreign signatures
	// need Effect.try even when the thrown class is reachable.
	if !t.value && !t.promise {
		if bound, written := foreignThrowsContract(c, call); written {
			if bound != "" {
				report(c, callee, foreignThrowingCall, name, bound)
			}
			return
		}
	}
	if t.kind == trustTagged && !t.value && len(t.failures) > 0 && a.legacyTrustUsesTag(call) {
		reportLegacyTrust(c, callee, t)
	}
	switch {
	case (t.kind == trustForeign || t.kind == trustTagged) && t.promise:
		d := report(c, callee, promiseCall, name)
		note(d, "Wait for it with {0}, or name its failure: {1}.", boundaryCall(c, file, "tryPromise", call, ""), boundaryCall(c, file, "tryPromise", call, "(error) => …"))
	case t.kind == trustBuiltin && len(t.failures) > 0:
		var names []string
		for _, failure := range t.failures {
			names = append(names, failure.name)
		}
		report(c, callee, foreignThrowingCall, name, strings.Join(names, " | "))
	case t.kind == trustForeign || t.kind == trustUnknown:
		// VIP-4: unknown is a thrown contract. Keep the legacy trust
		// diagnostics for Promise and unreachable-class contracts.
		d := report(c, callee, EK0403)
		note(d, "Call it through {0}, or {1}.", boundaryCall(c, file, "try", call, ""), trustedNote(c, file, call))
	case t.kind == trustTagged && t.unreachable != "":
		d := report(c, callee, unreachableThrows, name, t.unreachable)
		note(d, "Name an exported class in @throws.")
	case t.kind == trustTagged:
		for _, f := range t.failures {
			if _, _, ok := reachClass(c, file, f); !ok {
				d := report(c, callee, unimportedThrows, name, f.name)
				note(d, "Export {0} from the module this file imports {1} from.", f.name, name)
				break
			}
		}
	}
}

// checkInvocation is checkCall for a new expression or a tagged template.
// Chapter 3 (Calls in effect code): a call, new expression, tagged template
// or class evaluation whose thrown type is not never is EK0403 in effect
// code; a written contract names its classes, and an untagged foreign callee
// throws unknown.
func checkInvocation(c *checker.Checker, a *analyzer, file *ast.SourceFile, node *ast.Node) {
	if unwrappedPromiseInvocation(c, node) {
		return
	}
	effectfulPlain := false
	if fn := enclosingFunction(node); fn != nil && !a.runsAsEffect(fn) {
		if !a.isEffectfulPlainHome(fn, node) {
			return
		}
		effectfulPlain = true
	}
	if a.performs(node) || returnsEffectful(c, node) || isPlatformInvocation(c, node) {
		return
	}
	// A constructor no class declares has no signature to carry a tag, so
	// it stays untracked, as before; so does a lib constructor or tag the
	// shipped table does not list.
	decl := signatureDeclaration(c, node)
	if decl == nil && ast.IsNewExpression(node) {
		return
	}
	t := callTrust(c, node)
	if decl != nil && isLibFile(c, ast.GetSourceFileOfNode(decl)) && t.kind == trustForeign {
		return
	}
	callee := ast.GetInvokedExpression(node)
	name := nodeText(file, callee)
	bound, written := foreignThrowsContract(c, node)
	unknown := (t.kind == trustForeign || t.kind == trustUnknown) && !t.promise && !t.value
	if effectfulPlain {
		if !written && unknown && a.knownThrows(node) == nil {
			report(c, node, unknownThrowInEffectful, name)
		}
		return
	}
	switch home := a.plainHomeOf(node); {
	case home == nil:
	case home.Kind == ast.KindPropertyDeclaration && home.Initializer() != nil && ast.IsNodeDescendantOf(node, home.Initializer()),
		home.Kind == ast.KindClassStaticBlockDeclaration:
		return
	case ast.IsFunctionLike(home) && (isMarkedEffect(home) || isProducer(home)) && inParameterListOf(node, home):
		if t.kind == trustForeign && !t.promise && a.knownThrows(node) == nil {
			report(c, node, foreignCallInEffectParameters, name)
		}
		return
	}
	if written && !t.value && !t.promise {
		if bound != "" {
			report(c, node, foreignThrowingCall, name, bound)
		}
		return
	}
	switch {
	case unknown:
		d := report(c, node, EK0403)
		note(d, "Run it through {0}.", wrappedCall("try", nodeText(file, node), ""))
	case t.kind == trustBuiltin && len(t.failures) > 0:
		var names []string
		for _, failure := range t.failures {
			names = append(names, failure.name)
		}
		report(c, node, foreignThrowingCall, name, strings.Join(names, " | "))
	}
}

// isPlatformInvocation is isPlatformCallee for any invocation.
func isPlatformInvocation(c *checker.Checker, node *ast.Node) bool {
	root := ast.SkipParentheses(ast.GetInvokedExpression(node))
	for ast.IsPropertyAccessExpression(root) || ast.IsElementAccessExpression(root) {
		root = ast.SkipParentheses(root.Expression())
	}
	_, ok := platformReference(c, root)
	return ok
}

// unknownThrowInEffectful is EK0401's text for a call whose throwing is
// unknown in a plain function whose return type is wholly effectful.
var unknownThrowInEffectful = EK0401.With("'{0}' may throw, and a function that returns an Effect, a Stream or a Layer never throws: its failures belong in that value. Make the function 'effect' and run the call with 'try Effect.try(() => …)', declare the callee's '@throws', or move the code to a '.ts' file.")

// inEffectfulPlainHome reports whether call, outside a hatch and an async
// function, runs where isEffectfulPlainHome holds for its enclosing function.
func (a *analyzer) inEffectfulPlainHome(call *ast.Node) bool {
	fn := enclosingFunction(call)
	return fn != nil && !inHatch(call) && !ast.HasSyntacticModifier(fn, ast.ModifierFlagsAsync) && !a.isEffect(fn) && a.isEffectfulPlainHome(fn, call)
}

// isEffectfulPlainHome reports whether call runs in fn, a plain function or
// method whose return type, written or inferred, is wholly effectful: in its
// body or its parameter list, outside a try block with a catch clause and
// outside a literal whose throws belong to the call it is passed to. A plain
// catch handler is plain code of its own: an unannotated call there stays an
// ordinary call.
func (a *analyzer) isEffectfulPlainHome(fn *ast.Node, call *ast.Node) bool {
	if !ast.IsFunctionLike(fn) || fn.Body() == nil || isMarkedEffect(fn) || isProducer(fn) || isCatchHandlerOf(fn) || inCatchingTry(call) {
		return false
	}
	if a.plainHomeOf(call) != fn || a.throwsBelongToCall(fn, call) {
		return false
	}
	signature := a.checker.GetSignatureFromDeclaration(fn)
	return signature != nil && isEffectfulType(a.checker, a.checker.GetReturnTypeOfSignature(signature))
}

// returnsEffectful reports whether call's callee returns wholly an Effect, a
// Stream or a Layer. Such a function can't throw: its failures are its
// Effect's error channel, so a call of it is never throw-tracked, whether the
// call runs the Effect or passes it on (VIP-4, amended 2026-10-29; decided
// detail 36). A generic signature is classified before type-argument
// substitution, a type parameter by its constraint (VIP-4, amended 2026-10-30).
func returnsEffectful(c *checker.Checker, call *ast.Node) bool {
	sig := c.GetResolvedSignature(call)
	if sig == nil {
		return false
	}
	for sig.Target() != nil {
		sig = sig.Target()
	}
	result := c.GetReturnTypeOfSignature(sig)
	if ast.IsOptionalChain(call) {
		// f?.() calls f only when it is there; the checker's call-chain
		// signature adds undefined to what f returns.
		result = c.GetNonNullableType(result)
	}
	return isEffectfulType(c, result)
}

// isEffectfulType reports whether every value of t is an Effect, a Stream or
// a Layer. any, unknown and a union with another member are not. An Effect
// here is chapter 3's test, assignability to Effect<any, any, any>, so an
// Exit, a Config, an error instance or a service key is one too. The Effect
// interface itself counts even when the program has a second copy of effect,
// whose Effect the assignability test would not accept.
func isEffectfulType(c *checker.Checker, t *checker.Type) bool {
	if t != nil && t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		t = c.GetBaseConstraintOfType(t)
	}
	if t == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isEffectfulType(c, member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	if t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 {
		return false
	}
	return isEffectType(c, t) || isEffectOperandType(c, t) || c.GetPropertyOfType(t, streamTypeID) != nil || isLayerType(c, t)
}

// trustedNote is EK0403's other fix: declare the function's failures with
// trusted(impl, [Errors]) (D249), whose listed classes are expected failures
// and any other exception a defect. A method needs a function around it first.
// VIP-4 retires package trust, so the note must not recommend that setting.
func trustedNote(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	declaration := signatureDeclaration(c, call)
	callee := ast.SkipParentheses(call.Expression())
	wrap := "wrap it in a function and declare that function's failures with trusted(impl, [Errors]), imported from \"vibelang-runtime\""
	if declaration != nil && !ast.IsMethodDeclaration(declaration) && declaration.Kind != ast.KindMethodSignature && ast.IsEntityNameExpression(callee) {
		impl := nodeText(file, callee)
		value := impl[strings.LastIndex(impl, ".")+1:] + "Trusted"
		wrap = "declare its failures once, const " + value + " = trusted(" + impl + ", [Errors]) with trusted imported from \"vibelang-runtime\", and call " + value
	}
	return wrap
}

// reachClass finds how the generated code of file refers to f's class at run
// time: by its global name; by its own name, when file declares it; or as an
// export of a module that file imports. It returns the module specifier, or
// "" for a name in scope, and the name.
func reachClass(c *checker.Checker, file *ast.SourceFile, f failure) (module string, name string, ok bool) {
	if f.global {
		return "", f.name, true
	}
	if decl := f.class.ValueDeclaration(); decl != nil && ast.GetSourceFileOfNode(decl) == file && ast.IsClassDeclaration(decl) && decl.Name() != nil {
		return "", decl.Name().Text(), true
	}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || !ast.IsStringLiteral(statement.ModuleSpecifier()) {
			continue
		}
		module := c.ResolveExternalModuleName(statement.ModuleSpecifier(), nil /*importAttributesType*/)
		if module == nil {
			continue
		}
		for _, export := range c.GetExportsOfModule(module) {
			target := export
			if target.Flags()&ast.SymbolFlagsAlias != 0 {
				target = c.GetAliasedSymbol(target)
			}
			if c.GetMergedSymbol(target) == f.class {
				return statement.ModuleSpecifier().Text(), export.Name(), true
			}
		}
	}
	return "", "", false
}

// legacyTrustUsesTag matches planTrustedCalls' function/body predicate so
// EK4406 only offers a migration where lowering uses the failure contract.
// A plain callback's uncaught call stays plain; a caught D54 call uses the tag.
func (a *analyzer) legacyTrustUsesTag(call *ast.Node) bool {
	fn := enclosingFunction(call)
	if fn == nil || !isLowerable(fn) {
		return false
	}
	effect := a.isEffect(fn) // planFile records these as Effects or programs.
	return a.forEachFailingCall(fn, func(candidate *ast.Node, caught bool) bool {
		return candidate == call && (effect || caught)
	})
}

// reportLegacyTrust names the declaration and its actual contract, because
// methods need a receiver adapter rather than a bare-function quick fix.
func reportLegacyTrust(c *checker.Checker, callee *ast.Node, t *trust) {
	decl := t.declaration
	name := declarationName(decl)
	if name == "" {
		name = declarationName(ownerOf(signatureDeclaration(c, callee.Parent)))
	}
	var classes []string
	for _, f := range t.failures {
		classes = append(classes, f.name)
	}
	fix := "export const " + name + "Trusted = trusted(" + name + ", [" + strings.Join(classes, ", ") + "]) beside the TypeScript declaration and call that value instead"
	if decl != nil && (ast.IsMethodDeclaration(decl) || decl.Kind == ast.KindMethodSignature) {
		if owner := containerName(decl); owner != "" {
			name = owner + "." + name
		}
		fix = "write an adapter beside " + name + " using trusted(impl, [" + strings.Join(classes, ", ") + "]) and call that value instead"
	}
	report(c, callee, EK4406, name, fix)
}
