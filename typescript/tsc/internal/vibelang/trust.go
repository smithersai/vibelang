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
//	formatName(user)          // plain TypeScript: EK4401 without a boundary
//	parsePortTrusted(text)    // @vibelang trusted, @throws {PortError}: PortError joins E
//	JSON.parse(text)          // a built-in: SyntaxError joins E
//	Option.getOrThrow(o)      // effect's own export: exceptions are defects
//	Effect.try(() => legacyParse(text))   // a boundary: plain calls are allowed inside
//
// EK4401 applies only to code a fiber runs: a module's top level, and the
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
	trustForeign                   // any other function: EK4401 outside a boundary
)

// trust is what VibeLang knows about calling one callee.
type trust struct {
	declaration *ast.Node // the tagged declaration, retained for D249 migration edits
	kind        trustKind
	failures    []failure // the exceptions that are expected failures, which join E
	promise     bool      // the call returns a Promise
	unreachable string    // a @throws type that names no class, as written
	value       bool      // the callee is a trusted(impl, [Errors]) value, which lists its failures in its type (D514)
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
	if isParameterCall(c, call) {
		return &trust{kind: trustES}
	}
	decl := signatureDeclaration(c, call)
	if decl == nil {
		return &trust{kind: trustUnknown}
	}
	file := ast.GetSourceFileOfNode(decl)
	if isVibeLangFile(file) {
		return &trust{kind: trustES}
	}
	if listedInManifest(c, file) {
		return &trust{kind: trustEffect} // compiled from VibeLang (D500, manifest.go)
	}
	// A const that re-exports a library function with the tag trusts it (D23),
	// so the tag on what the callee names wins over the library's declaration.
	var candidates []*ast.Node
	if symbol := calleeSymbol(c, call); symbol != nil {
		candidates = append(candidates, symbol.Declarations()...)
	}
	switch pkg := packageOf(c, file); {
	case isLibFile(c, file):
		return tagged(c, call, candidates, &trust{kind: trustBuiltin, failures: builtinFailures(c, decl)})
	case isTrustedPackage(c, ast.GetSourceFileOfNode(call), pkg):
		return tagged(c, call, candidates, &trust{kind: trustEffect})
	case isPlatformPackage(pkg):
		return tagged(c, call, candidates, &trust{kind: trustPlatform})
	}
	candidates = append(candidates, decl)
	if symbol := decl.Symbol(); symbol != nil {
		candidates = append(candidates, symbol.Declarations()...) // the other overloads
	}
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

// tagged returns the trust of a declaration among candidates that is tagged
// `@vibelang trusted` and declared outside lib files and trusted
// packages, else otherwise.
func tagged(c *checker.Checker, call *ast.Node, candidates []*ast.Node, otherwise *trust) *trust {
	for _, candidate := range candidates {
		file := ast.GetSourceFileOfNode(candidate)
		if file == nil || isLibFile(c, file) || isTrustedPackage(c, ast.GetSourceFileOfNode(call), packageOf(c, file)) {
			continue
		}
		for _, host := range jsdocHosts(candidate) {
			if hasTrustedTag(host) {
				t := &trust{kind: trustTagged, promise: returnsPromise(c, call), declaration: candidate}
				t.failures, t.unreachable = throwsOf(c, host)
				return t
			}
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

// throwsOf reads the `@throws {T}` tags of host's JSDoc. Each names a class
// in host's scope whose instances are expected failures. It returns the
// failures, and the text of the first type that names no class.
func throwsOf(c *checker.Checker, host *ast.Node) ([]failure, string) {
	var failures []failure
	for _, jsdoc := range host.JSDoc(nil) {
		for _, tag := range jsdocTags(jsdoc) {
			if !ast.IsJSDocThrowsTag(tag) || tag.AsJSDocThrowsTag().TypeExpression == nil {
				continue
			}
			t := tag.AsJSDocThrowsTag().TypeExpression.AsJSDocTypeExpression().Type
			name := ""
			if t != nil && ast.IsTypeReferenceNode(t) && ast.IsIdentifier(t.AsTypeReferenceNode().TypeName) {
				name = t.AsTypeReferenceNode().TypeName.Text()
			}
			f, ok := classFailure(c, name, c.ResolveName(name, host, ast.SymbolFlagsValue, false /*excludeGlobals*/))
			if !ok {
				file := ast.GetSourceFileOfNode(host)
				return nil, file.Text()[t.Pos():t.End()]
			}
			failures = append(failures, f)
		}
	}
	return failures, ""
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

// builtinContracts lists the JavaScript built-ins whose exceptions are
// expected failures (D5): each parses text from outside the program. Every
// other built-in is trusted, and its exceptions are defects. Keys are
// "Container.member", or "member" for a global function.
var builtinContracts = map[string]string{
	"JSON.parse":         "SyntaxError",
	"decodeURI":          "URIError",
	"decodeURIComponent": "URIError",
}

// builtinFailures returns the expected failures of the built-in that decl, a
// lib file's declaration, declares.
func builtinFailures(c *checker.Checker, decl *ast.Node) []failure {
	owner := ownerOf(decl)
	if owner == nil {
		return nil
	}
	key := declarationName(owner)
	if container := containerName(owner); container != "" {
		key = container + "." + key
	}
	name, ok := builtinContracts[key]
	if !ok {
		return nil
	}
	if f, ok := classFailure(c, name, c.GetGlobalSymbol(name, ast.SymbolFlagsValue, nil /*diagnostic*/)); ok {
		return []failure{f}
	}
	return nil
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

// outsideFibers reports whether node is code that no fiber runs: at the
// module's top level, or in a plain callback that such a place passes to a
// TypeScript function, such as a describe body or a route handler. A runner
// may be called there (D38), and a plain call there is an ordinary JavaScript
// call, as at the top level (D51).
func outsideFibers(c *checker.Checker, a *analyzer, node *ast.Node) bool {
	if inHatch(node) {
		return true // a hatch's body is the way back in to TypeScript (D148)
	}
	fn := enclosingFunction(node)
	if fn == nil {
		return true
	}
	if !isLambda(fn) || a.isEffect(fn) {
		return false
	}
	call, _ := ownerCall(fn)
	if call == nil || !ast.IsCallExpression(call) || callTrust(c, call).kind == trustES {
		return false
	}
	return outsideFibers(c, a, call)
}

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

// checkTrust reports EK4401 for each call in code that a fiber runs whose
// callee has no trust level and that no boundary encloses. Code that no fiber
// runs, the module's top level and the plain callbacks it passes to
// TypeScript functions, is JavaScript (D51).
func checkTrust(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node, boundary bool) bool
	visit = func(node *ast.Node, boundary bool) bool {
		if ast.IsFunctionLike(node) && node.Body() != nil {
			boundary = boundary || isBoundaryCallback(c, node)
		}
		if ast.IsCallExpression(node) && !boundary && !outsideFibers(c, a, node) {
			checkCall(c, a, file, node)
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
	if fn := enclosingFunction(call); fn != nil && !a.isSplittable(fn) && !a.isEffect(fn) {
		return // D282: a plain function's calls of TypeScript code are JavaScript calls
	}
	if ast.IsSuperCall(call) || ast.IsImportCall(call) || a.performs(call) || isEffectValueCall(c, call) || isPlatformCallee(c, call) {
		return
	}
	t := callTrust(c, call)
	callee := call.Expression()
	name := nodeText(file, callee)
	if t.kind == trustTagged && !t.value && len(t.failures) > 0 && a.legacyTrustUsesTag(call) {
		reportLegacyTrust(c, callee, t)
	}
	switch {
	case (t.kind == trustForeign || t.kind == trustTagged) && t.promise:
		d := report(c, callee, promiseCall, name)
		note(d, "Wait for it with {0}, or name its failure: {1}.", boundaryCall(c, file, "tryPromise", call, ""), boundaryCall(c, file, "tryPromise", call, "(error) => …"))
	case t.kind == trustForeign:
		d := report(c, callee, EK4401, name)
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

// trustedNote is EK4401's other fix: declare the function's failures with
// trusted(impl, [Errors]) (D249), whose listed classes are expected failures
// and any other exception a defect; for another package's function, trusting
// the whole package with the vibelang setting trustedPackages (D261) also
// does. A method needs a function around it first.
func trustedNote(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	declaration := signatureDeclaration(c, call)
	callee := ast.SkipParentheses(call.Expression())
	wrap := "wrap it in a function and declare that function's failures with trusted(impl, [Errors]), imported from \"vibelang-runtime\""
	if declaration != nil && !ast.IsMethodDeclaration(declaration) && declaration.Kind != ast.KindMethodSignature && ast.IsEntityNameExpression(callee) {
		impl := nodeText(file, callee)
		value := impl[strings.LastIndex(impl, ".")+1:] + "Trusted"
		wrap = "declare its failures once, const " + value + " = trusted(" + impl + ", [Errors]) with trusted imported from \"vibelang-runtime\", and call " + value
	}
	if declaration != nil && packageOf(c, ast.GetSourceFileOfNode(declaration)) != packageOf(c, file) {
		return "list its package in the vibelang setting trustedPackages, or " + wrap
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
