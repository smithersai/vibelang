package vibelang

import (
	"context"
	"path"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// The prelude (design decisions D4 and D48) is the names every .vibe file sees
// without an import: Effect, Schema, Layer, TaggedError, Control, Scope, pipe,
// wire, fork, join, handle, resume, resumeWith, abandon, and Experimental (D313). They are the exports of
// vibelang-runtime, which declares each with the right meanings: Effect
// is the namespace and the type Effect<A, E, R>, Scope the namespace and the
// type Scope.Scope.
//
// The program resolves vibelang-runtime from every .vibe file as an
// implicit import, and the checker resolves a prelude name that no scope
// declares to the runtime's export, before it searches the global scope. So a
// local declaration or import shadows a prelude name, and .ts files never see
// the prelude. The emitted JavaScript imports each prelude name the file uses
// as a value: the Effect modules from effect, the rest from the runtime.
//
// The names the parser writes for its forms, such as the $is of a match or
// the TaggedError an error extends, are intrinsics
// (ast.NodeFlagsVibeLangIntrinsic): they mean the prelude's export whatever
// the file declares, so no source binding can capture them. Where a source
// binding of another meaning is in scope, the lowering reaches the export
// through an import of its own (recordIntrinsic, intrinsicReference).

// runtimeModule is the package that holds the prelude and the helpers that
// generated code calls.
const runtimeModule = "vibelang-runtime"

// preludeModules maps each prelude name to the module the emitted JavaScript
// imports it from. A name from an effect module is imported as that module's
// namespace (import * as Effect from "effect/Effect").
var preludeModules = map[string]string{
	"Effect":      "effect/Effect",
	"Layer":       "effect/Layer",
	"Schema":      "effect/Schema",
	"Scope":       "effect/Scope",
	"TaggedError": runtimeModule,
	// What VibeLang adds where Effect lacks an API (D313): Experimental.FileSystem, Experimental.Crypto.
	"Experimental": runtimeModule,
	// An error that extends another, which the parser writes (D278, parser/vibelang_errors.go).
	"$errorSubclass": runtimeModule,
	"$ErrorArgs":     runtimeModule,
	// How a schema error joins its family, which the parser writes (D304).
	"$schemaErrorFamily": runtimeModule,
	"$schemaErrorMember": runtimeModule,
	"Control":            runtimeModule,
	"pipe":               runtimeModule,
	"wire":               runtimeModule,
	"fork":               runtimeModule,
	"handle":             runtimeModule,
	"resume":             runtimeModule,
	"resumeWith":         runtimeModule,
	"abandon":            runtimeModule,
	// The boundary hatches and the runners that lead back in (D148, hatches.go).
	"sync":     runtimeModule,
	"callback": runtimeModule,
	// try e, which the parser writes as $try(e) (VIP-5, try.go).
	"$try": runtimeModule,
	// The type of callback's resume parameter. Inputs keep callback's type
	// arguments from being written, so the parameter's annotation names them.
	"Resume":      runtimeModule,
	"runPromise":  runtimeModule,
	"runFork":     runtimeModule,
	"runSync":     runtimeModule,
	"runCallback": runtimeModule,
	// The test of a typed catch clause, which the parser writes (D131, catches.go).
	"$isFailure": runtimeModule,
	// A catch expression, which the parser writes (D236, catch_expressions.go).
	"$catchExpression": runtimeModule,
	// What a handle statement's clause binds, which the parser writes for the
	// checker and the lowering removes (D132, handles.go).
	"$clause": runtimeModule,
	// The fiber forms (D166-D170, fibers.go): the parser writes await, select,
	// and for concurrent as calls of these; detach and forkIn are fork's variants.
	"$await": runtimeModule,
	"$join":  runtimeModule,
	// join(x), the keyword join x with a parenthesized operand (D391, D432).
	"join":    runtimeModule,
	"$select": runtimeModule,
	// The await operations (D196): await.all, await.allSettled, await.race, await.any.
	"$tryAll":          runtimeModule,
	"$tryRace":         runtimeModule,
	"$tryAny":          runtimeModule,
	"$tryAllSettled":   runtimeModule,
	"$awaitAll":        runtimeModule,
	"$awaitAllSettled": runtimeModule,
	"$awaitRace":       runtimeModule,
	"$awaitAny":        runtimeModule,
	"$forConcurrent":   runtimeModule,
	"detach":           runtimeModule,
	"forkIn":           runtimeModule,
	// A provide block's Key = value provider, which the parser writes (D173, provide.go).
	"$provideService": runtimeModule,
	// The extends clause the parser writes for service Name: Type (D281,
	// services.go). The lowering replaces it, so it is never a use.
	"$service": runtimeModule,
	// The primitives with their own syntax (D176-D180, primitives.go): the bare
	// functions, the functions an interruption block calls, and the names the
	// parser writes for a catch clause typed Cause, finally (exit), and the
	// interruption blocks' markers.
	"interrupt":             runtimeModule,
	"yieldNow":              runtimeModule,
	"uninterruptible":       runtimeModule,
	"restore":               runtimeModule,
	"interruptible":         runtimeModule,
	"$failureOf":            runtimeModule,
	"$noFailure":            runtimeModule,
	"$exit":                 runtimeModule,
	"$uninterruptibleBlock": runtimeModule,
	"$restoreBlock":         runtimeModule,
	"$interruptibleBlock":   runtimeModule,
	// Pattern matching (D206-D225, match.go): the parser writes match and is
	// with these helpers; customMatcher is the proposal's Symbol.customMatcher.
	"$is":           runtimeModule,
	"$extract":      runtimeModule,
	"$rest":         runtimeModule,
	"$noMatch":      runtimeModule,
	"$patternError": runtimeModule,
	"customMatcher": runtimeModule,
}

// implicitRuntimeImport makes a .vibe file that may use the prelude resolve the
// runtime, one that may use an export of effect's root (effectroot.go)
// resolve effect, and one that may use a subpath module (effectsubpath.go)
// resolve that module's package, such as effect/http, so their
// declarations are in the program. A file with an unannotated function
// resolves effect too: such a function is an Effect function (D500), and its
// type needs effect's Effect interface. A file with none of these compiles
// exactly as TypeScript would. So does a file whose functions are Effects only by what
// they do (mayLowerToEffect): one that throws, a producer, and one that
// declares `using`.
func implicitRuntimeImport(file *ast.SourceFile) []string {
	if !isVibeLangFile(file) {
		return nil
	}
	prelude, root, barrels := mayUsePrelude(file)
	effect, runtime := mayLowerToEffect(file)
	entry := entryCandidate(file) != nil
	var modules []string
	if prelude || entry || runtime || declaresService(file) {
		modules = append(modules, runtimeModule)
	}
	if root || effect || mayDeclareEffectFunction(file) || file.HasIdentifier("Effect") {
		modules = append(modules, effectRootModule)
	}
	modules = append(modules, barrels...)
	if entry {
		// An entry module runs main with NodeRuntime when the package resolves,
		// and provides main the bundles of the platform it names (entry.go).
		modules = append(modules, entryModules(file)...)
	}
	return modules
}

// declaresService reports whether file declares a service, whose identifier
// carries the runtime's ServiceBrand (D361). It reads syntax, before binding.
func declaresService(file *ast.SourceFile) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindModuleDeclaration:
			return false
		case ast.IsClassDeclaration(node) && shapeKindOf(node) == serviceClass:
			return true
		}
		return node.ForEachChild(visit)
	}
	return file.AsNode().ForEachChild(visit)
}

// mayUsePrelude reports whether file has an identifier with a prelude name,
// and one with the name of an effect root export, that no top-level
// declaration or import of file declares, and returns the packages of the
// subpath modules whose names it has, sorted. It runs before binding, so it
// reads names from the syntax, and a property named pipe or an inner
// declaration counts as a use, which only loads a module. A subpath package
// can be large, such as effect/cluster's 40 modules, so a member name, such as
// the Message of x.Message, never loads one.
func mayUsePrelude(file *ast.SourceFile) (prelude bool, root bool, barrels []string) {
	declared := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		forEachTopLevelName(statement, func(name string) { declared[name] = true })
	}
	loaded := map[string]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			name := node.Text()
			if declared[name] && node.Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
				return false
			}
			if _, ok := preludeModules[name]; ok {
				prelude = true
			} else if _, ok := effectRootNames[name]; ok || effectFunctionNames[name] {
				root = true
			} else if subpath, ok := effectSubpathNames[name]; ok && !loaded[subpath.barrel] && !isMemberNameOf(node) {
				loaded[subpath.barrel] = true
				barrels = append(barrels, subpath.barrel)
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	slices.Sort(barrels)
	return prelude, root, barrels
}

// isMemberNameOf reports whether identifier names a member, as the name of a
// property access, a qualified name, or a property or method declaration
// does, so that no scope resolves it.
func isMemberNameOf(identifier *ast.Node) bool {
	parent := identifier.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsPropertyAccessExpression(parent), ast.IsQualifiedName(parent):
		return parent.Name() == identifier
	case ast.IsPropertyAssignment(parent), ast.IsPropertySignatureDeclaration(parent), ast.IsPropertyDeclaration(parent),
		ast.IsMethodDeclaration(parent), ast.IsMethodSignatureDeclaration(parent), ast.IsGetAccessorDeclaration(parent),
		ast.IsSetAccessorDeclaration(parent), ast.IsEnumMember(parent):
		return parent.Name() == identifier
	}
	return false
}

// mayDeclareEffectFunction reports whether file declares a function that
// may be an Effect function whatever its body does (D500): a function
// declaration, function expression, arrow function, or method with a body
// and no return type annotation that is neither async nor a generator. Its
// type needs effect's Effect interface. A function annotated with A!E!R names
// effect's Effect, so mayUsePrelude already loads effect for it, and one
// annotated with a plain type keeps that type. A module block's body is
// TypeScript.
func mayDeclareEffectFunction(file *ast.SourceFile) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindModuleDeclaration:
			return false
		case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
			if node.Body() != nil && node.Type() == nil && ast.GetFunctionFlags(node)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) == 0 {
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	return file.AsNode().ForEachChild(visit)
}

// mayLowerToEffect reports whether file has a function that may compile to an
// Effect though it names no prelude or effect root export: one with a throw
// (D282), one that calls a built-in whose failures are expected (D101), such
// as JSON.parse, a producer, a function* without a JavaScript iterator
// annotation, or one that declares `using`. The last two also call the
// runtime's helpers. Their types name effect's Effect, so the program needs
// effect's declarations: without them, a function that only throws, or only
// parses JSON, was declared plain while its JavaScript returned an Effect. A
// module declaration's body is TypeScript (D283), so it is not read.
func mayLowerToEffect(file *ast.SourceFile) (effect bool, runtime bool) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindModuleDeclaration:
			return false
		case node.Kind == ast.KindThrowStatement, namesParsingBuiltin(node):
			effect = true
		case node.Kind == ast.KindVariableDeclarationList && isUsingList(node),
			(node.Kind == ast.KindFunctionDeclaration || node.Kind == ast.KindFunctionExpression) && node.Body() != nil &&
				ast.GetFunctionFlags(node)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) == ast.FunctionFlagsGenerator &&
				!vibelangmapper.HasJavaScriptIteratorReturn(node):
			effect, runtime = true, true
		}
		if effect && runtime {
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return effect, runtime
}

// namesParsingBuiltin reports whether node names a built-in whose failures
// are expected (globalThrowsTable, D101): decodeURI, decodeURIComponent, or
// JSON.parse, globalThis.JSON.parse included. It reads syntax, before binding,
// so a local of the same name counts too, which only loads a module.
func namesParsingBuiltin(node *ast.Node) bool {
	switch {
	case ast.IsIdentifier(node):
		return parsingBuiltinNames[node.Text()]
	case ast.IsPropertyAccessExpression(node):
		object := node.Expression()
		if ast.IsPropertyAccessExpression(object) {
			object = object.Name()
		}
		if !ast.IsIdentifier(object) || !ast.IsIdentifier(node.Name()) {
			return false
		}
		return parsingBuiltinNames[object.Text()+"."+node.Name().Text()]
	}
	return false
}

// forEachTopLevelName calls fn with each name that statement, a statement at
// a module's top level, declares or imports.
func forEachTopLevelName(statement *ast.Node, fn func(name string)) {
	switch statement.Kind {
	case ast.KindImportDeclaration:
		clause := statement.AsImportDeclaration().ImportClause
		if clause == nil {
			return
		}
		if name := clause.Name(); name != nil {
			fn(name.Text())
		}
		if bindings := clause.AsImportClause().NamedBindings; bindings != nil {
			if ast.IsNamespaceImport(bindings) {
				fn(bindings.Name().Text())
			} else {
				for _, specifier := range bindings.AsNamedImports().Elements.Nodes {
					fn(specifier.Name().Text())
				}
			}
		}
	case ast.KindVariableStatement:
		for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			forEachBindingName(declaration.Name(), fn)
		}
	case ast.KindImportEqualsDeclaration, ast.KindFunctionDeclaration, ast.KindClassDeclaration, ast.KindEnumDeclaration,
		ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindModuleDeclaration:
		if name := statement.Name(); name != nil && ast.IsIdentifier(name) {
			fn(name.Text())
		}
	}
}

// forEachBindingName calls fn with each identifier that name, a binding name
// or pattern, binds.
func forEachBindingName(name *ast.Node, fn func(name string)) {
	switch {
	case name == nil:
	case ast.IsIdentifier(name):
		fn(name.Text())
	case ast.IsBindingPattern(name):
		for _, element := range name.AsBindingPattern().Elements.Nodes {
			forEachBindingName(element.Name(), fn)
		}
	}
}

// preludeState is what one checker remembers about the prelude.
type preludeState struct {
	modules     map[*ast.SourceFile]*ast.Symbol            // the runtime module each .vibe file resolves
	roots       map[*ast.SourceFile]*ast.Symbol            // the effect root module each .vibe file resolves
	barrels     map[string]map[*ast.SourceFile]*ast.Symbol // each subpath package each .vibe file resolves, by name
	uses        map[*ast.SourceFile]map[string]bool        // prelude names each .vibe file uses as values
	typeUses    map[*ast.SourceFile]map[string]bool        // prelude names each .vibe file's declaration file writes (declarations.go)
	typeRefs    map[*ast.Node]bool                         // the identifiers that write those names
	scopes      map[*ast.SourceFile]map[*ast.Symbol]string // the modules each .vibe file names, by name (preludeModuleName)
	written     map[*ast.SourceFile]map[string]bool        // the prelude names a declaration of each .vibe file may write
	moduleNames map[*ast.Node]bool                         // the identifiers preludeModuleName made

	// intrinsics are the intrinsics that a source binding of another meaning
	// would capture, which the lowering reaches through its own import
	// (recordIntrinsic).
	intrinsics map[*ast.Node]bool
}

type preludeStateKey struct{}

func preludeStateOf(c *checker.Checker) *preludeState {
	return c.ExtensionState(preludeStateKey{}, func() any {
		return &preludeState{
			modules:     map[*ast.SourceFile]*ast.Symbol{},
			roots:       map[*ast.SourceFile]*ast.Symbol{},
			barrels:     map[string]map[*ast.SourceFile]*ast.Symbol{},
			uses:        map[*ast.SourceFile]map[string]bool{},
			typeUses:    map[*ast.SourceFile]map[string]bool{},
			typeRefs:    map[*ast.Node]bool{},
			scopes:      map[*ast.SourceFile]map[*ast.Symbol]string{},
			written:     map[*ast.SourceFile]map[string]bool{},
			moduleNames: map[*ast.Node]bool{},
		}
	}).(*preludeState)
}

// implicitEffectModuleDisabled is the VIP-14 switch for names supplied by
// root and subpath exports. Runtime helpers remain language support.
func implicitEffectModuleDisabled(c *checker.Checker, file *ast.SourceFile, name string) bool {
	options := optionsFor(c, file)
	module := isEffectExportName(name) || strings.HasPrefix(preludeModules[name], "effect/") || name == "pipe"
	return module && options != nil && options.VibeLang != nil &&
		options.VibeLang.EffectModules == core.TSFalse
}

// isPreludeName reports whether name is a name the prelude may supply: a
// runtime prelude name, an effect root export, an unprefixed Effect function,
// or a subpath module.
func isPreludeName(name string) bool {
	if _, ok := preludeModules[name]; ok {
		return true
	}
	if _, ok := effectRootNames[name]; ok {
		return true
	}
	_, ok := effectSubpathNames[name]
	return ok || effectFunctionNames[name]
}

// resolvePreludeName resolves name, which no scope around location declares,
// when location is in a .vibe file: a prelude name to the runtime's export,
// and the name of an effect root export or subpath module to that export
// unless an ECMAScript value has the name, in each case when the export has the
// meaning the checker asks for.
func resolvePreludeName(c *checker.Checker, location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol {
	if meaning&ast.SymbolFlagsType != 0 && meaning&ast.SymbolFlagsVariable == 0 {
		// import { Prompt } from "effect/ai": the type Prompt is Prompt.Prompt (D311).
		if file := ast.GetSourceFileOfNode(location); isVibeLangFile(file) {
			if export := importedModuleType(c, file, location, name); export != nil {
				return export
			}
		}
	}
	if !isPreludeName(name) {
		return nil
	}
	// VIP-14 resolves each meaning independently: ambient types survive
	// even when an Effect namespace takes the same spelling as a value.
	if meaning&ast.SymbolFlagsType == ast.SymbolFlagsType && meaning&ast.SymbolFlagsVariable == 0 && c.GlobalSymbol(name, ast.SymbolFlagsType) != nil {
		return nil
	}
	file := ast.GetSourceFileOfNode(location)
	if !isVibeLangFile(file) {
		return nil
	}
	// Internal queries and parser intrinsics still reach compiler support;
	// this switch controls actual unqualified names written in source.
	if ast.IsIdentifier(location) && location.Text() == name &&
		location.Flags&(ast.NodeFlagsVibeLangIntrinsic|ast.NodeFlagsReparsed) == 0 &&
		implicitEffectModuleDisabled(c, file, name) {
		return nil
	}
	state := preludeStateOf(c)
	symbol := preludeSymbol(c, state, file, name)
	if symbol != nil && meaning&ast.SymbolFlagsType != 0 && !hasMeaning(c, symbol, meaning) && !shadowed(location, name) {
		// The type Option is Option.Option (D311), unless the file declares
		// Option in another meaning, as const Order = Schema.Struct(…) does.
		if export := moduleAliasType(c, location, symbol, name); export != nil {
			return export
		}
	}
	if symbol == nil || !hasMeaning(c, symbol, meaning) {
		return nil
	}
	if isValueReference(location, name, meaning) && !isLoweredHatchCallee(location) && !isClauseCallee(location) && !isRemovedPrimitiveMarker(location) && !isServiceShapeFactory(location) {
		if location.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 {
			recordIntrinsic(c, state, file, location, name, meaning, symbol)
		} else {
			recordPreludeUse(state, file, name)
		}
	}
	return symbol
}

// recordIntrinsic records how the emitted JavaScript reaches symbol, the
// prelude export that location, an intrinsic named name, means. The name
// written where location stands binds what source code there would bind:
// the prelude's import when no scope declares name, which is recorded as a
// use; or a source binding, including an import of the same export. Source
// aliases are not marked referenced by intrinsic resolution and may be elided,
// so the lowering reaches symbol through its own import (intrinsicReference).
// An interface's heritage, such as a schema's
// Schema.Schema.Type, is erased, so it needs neither.
func recordIntrinsic(c *checker.Checker, state *preludeState, file *ast.SourceFile, location *ast.Node, name string, meaning ast.SymbolFlags, symbol *ast.Symbol) {
	if ast.FindAncestor(location, ast.IsInterfaceDeclaration) != nil {
		return
	}
	lexical := c.ResolveLexicalName(name, location.Parent, meaning)
	switch {
	case lexical == symbol:
		recordPreludeUse(state, file, name)
	default:
		if state.intrinsics == nil {
			state.intrinsics = map[*ast.Node]bool{}
		}
		state.intrinsics[location] = true
	}
}

// aliasTarget returns the symbol that symbol, an alias or not, stands for.
func aliasTarget(c *checker.Checker, symbol *ast.Symbol) *ast.Symbol {
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		if target := c.GetAliasedSymbol(symbol); target != nil {
			return target
		}
	}
	return symbol
}

// preludeSpellingCandidates offers the prelude's names and effect's root
// exports, which no symbol table of a .vibe file lists, to TypeScript's "Did
// you mean" suggestion for a value there: Consle.log suggests Console, which
// is one edit away, not the global console (TS2552). Names the parser
// writes, which start with $, are not offered.
func preludeSpellingCandidates(c *checker.Checker, location *ast.Node, meaning ast.SymbolFlags) []*ast.Symbol {
	file := ast.GetSourceFileOfNode(location)
	if meaning&ast.SymbolFlagsValue == 0 || !isVibeLangFile(file) {
		return nil
	}
	state := preludeStateOf(c)
	var candidates []*ast.Symbol
	offer := func(name string) {
		if !strings.HasPrefix(name, "$") && !implicitEffectModuleDisabled(c, file, name) {
			if symbol := preludeSymbol(c, state, file, name); symbol != nil {
				candidates = append(candidates, symbol)
			}
		}
	}
	for name := range preludeModules {
		offer(name)
	}
	for name := range effectRootNames {
		offer(name)
	}
	for name := range effectFunctionNames {
		offer(name)
	}
	for name := range effectSubpathNames {
		offer(name)
	}
	return candidates
}

// recordPreludeUse records that file uses name, a prelude name or effect root
// export, as a value, so the lowering imports it.
func recordPreludeUse(state *preludeState, file *ast.SourceFile, name string) {
	if state.uses[file] == nil {
		state.uses[file] = map[string]bool{}
	}
	state.uses[file][name] = true
}

// preludeSymbol returns the export that name, a prelude name or the name of an
// effect root export or subpath module, refers to in file, or nil when its
// module is not installed or file does not resolve it, or, for an effect
// export, ECMAScript defines a global value with the name.
func preludeSymbol(c *checker.Checker, state *preludeState, file *ast.SourceFile, name string) *ast.Symbol {
	if len(effectSubpathShared[name]) > 0 {
		return nil
	}
	if _, ok := preludeModules[name]; ok {
		if module := runtimeModuleSymbol(c, state, file); module != nil {
			return c.TryGetMemberInModuleExports(name, module)
		}
		return nil
	}
	if isBuiltinGlobal(c, name) {
		return nil
	}
	return effectExportSymbol(c, state, file, name)
}

// effectExportSymbol returns the export of effect that name, an effect root
// export, an unprefixed Effect function or a subpath module, refers to in
// file, whether or not a JavaScript global takes the name, or nil when its
// module is not installed or file does not resolve it.
func effectExportSymbol(c *checker.Checker, state *preludeState, file *ast.SourceFile, name string) *ast.Symbol {
	if subpath, ok := effectSubpathNames[name]; ok {
		cache := state.barrels[subpath.barrel]
		if cache == nil {
			cache = map[*ast.SourceFile]*ast.Symbol{}
			state.barrels[subpath.barrel] = cache
		}
		if module := resolvedModuleSymbol(c, cache, file, subpath.barrel); module != nil {
			return c.TryGetMemberInModuleExports(name, module)
		}
		return nil
	}
	module := effectRootModuleSymbol(c, state, file)
	if module == nil {
		return nil
	}
	if effectFunctionNames[name] {
		// A function of the Effect module, reached through the root's Effect.
		effect := c.TryGetMemberInModuleExports("Effect", module)
		if effect == nil {
			return nil
		}
		if effect.Flags()&ast.SymbolFlagsAlias != 0 {
			effect = c.GetAliasedSymbol(effect)
		}
		return c.TryGetMemberInModuleExports(name, effect)
	}
	return c.TryGetMemberInModuleExports(name, module)
}

// isLoweredHatchCallee reports whether location names the callee of a sync
// hatch, which the lowering replaces with Effect's function, so the emitted
// JavaScript needs no import of it.
func isLoweredHatchCallee(location *ast.Node) bool {
	parent := location.Parent
	return parent != nil && ast.IsCallExpression(parent) && parent.Expression() == location && location.Text() == "sync"
}

// isBuiltinGlobal gives ECMAScript globals precedence over Effect's module
// names (VIP-14). Platform globals lose in value and namespace positions;
// their ambient types keep their meanings in resolvePreludeName.
func isBuiltinGlobal(c *checker.Checker, name string) bool {
	symbol := c.GlobalSymbol(name, ast.SymbolFlagsValue)
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		if file := ast.GetSourceFileOfNode(declaration); file != nil && strings.HasPrefix(path.Base(string(file.FileName())), "lib.es") {
			return true
		}
	}
	return false
}

// isValueReference reports whether resolving name at location, with
// meaning, is a reference in the source that the emitted JavaScript keeps:
// an identifier with that name, outside every type. Checks that resolve a
// name for their own purposes, such as the namespace Effect at a function,
// pass another location and are not uses.
func isValueReference(location *ast.Node, name string, meaning ast.SymbolFlags) bool {
	return meaning&ast.SymbolFlagsValue != 0 && ast.IsIdentifier(location) && location.Text() == name && !inTypeNode(location)
}

// inTypeNode reports whether node is inside a type, such as the Scope of
// Scope.Scope in a type reference or the X of typeof X. A name there is erased
// from the emitted JavaScript, so it needs no import.
func inTypeNode(node *ast.Node) bool {
	for n := node; n != nil; n = n.Parent {
		if n.Kind >= ast.KindFirstTypeNode && n.Kind <= ast.KindLastTypeNode {
			return true
		}
	}
	return false
}

// hasMeaning reports whether symbol, or the symbol it aliases, has meaning,
// as the checker's own scope lookup requires.
func hasMeaning(c *checker.Checker, symbol *ast.Symbol, meaning ast.SymbolFlags) bool {
	if symbol.Flags()&meaning != 0 {
		return true
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		if target := c.GetAliasedSymbol(symbol); target != nil && target.Flags()&meaning != 0 {
			return true
		}
	}
	return false
}

// runtimeModuleSymbol returns the symbol of the runtime module that file
// resolves, or nil when the runtime is not installed.
func runtimeModuleSymbol(c *checker.Checker, state *preludeState, file *ast.SourceFile) *ast.Symbol {
	return resolvedModuleSymbol(c, state.modules, file, runtimeModule)
}

// effectRootModuleSymbol returns the symbol of the effect root module that
// file resolves, or nil when effect is not installed.
func effectRootModuleSymbol(c *checker.Checker, state *preludeState, file *ast.SourceFile) *ast.Symbol {
	return resolvedModuleSymbol(c, state.roots, file, effectRootModule)
}

// resolvedModuleSymbol returns the symbol of the module named name that file
// resolves in the current program. Cache successful resolutions only; a miss
// during an editor update must not poison later lookups.
func resolvedModuleSymbol(c *checker.Checker, cache map[*ast.SourceFile]*ast.Symbol, file *ast.SourceFile, name string) *ast.Symbol {
	if module := cache[file]; module != nil {
		return module
	}
	var module *ast.Symbol
	program := c.Program()
	for key, resolved := range program.GetResolvedModules()[file.PathKey()] {
		if key.Name == name && resolved.IsResolved() {
			if moduleFile := program.GetSourceFileForResolvedModule(resolved); moduleFile != nil {
				module = c.GetSymbolOfDeclaration(moduleFile.AsNode())
				break
			}
		}
	}
	if module != nil {
		cache[file] = module
	}
	return module
}

// preludeUses returns the prelude names that file uses as values, sorted. It
// checks file first, because the checker records uses while it checks.
func preludeUses(c *checker.Checker, file *ast.SourceFile) []string {
	c.GetDiagnostics(context.Background(), file)
	var names []string
	for name := range preludeStateOf(c).uses[file] {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// requireNamedImports returns declaration, an import the lowering adds, as
// it must stand in a file emitted as CommonJS. TypeScript's CommonJS
// transform rewrites each reference to a named import through the checker's
// binding, which the names the lowering writes have none of, so
// `import { TaggedError } from "vibelang-runtime"` would leave TaggedError
// unbound. A named import becomes a destructuring require,
//
//	const { TaggedError, pipe } = require("vibelang-runtime")
//
// which binds the names themselves; a namespace import, which the transform
// writes as a const of its own name, stays as it is.
func requireNamedImports(f *ast.NodeFactory, declaration *ast.Node) *ast.Node {
	clause := declaration.AsImportDeclaration().ImportClause
	if clause == nil || clause.AsImportClause().NamedBindings == nil || !ast.IsNamedImports(clause.AsImportClause().NamedBindings) {
		return declaration
	}
	var elements []*ast.Node
	for _, specifier := range clause.AsImportClause().NamedBindings.Elements() {
		var property *ast.Node
		if name := specifier.PropertyName(); name != nil {
			property = f.NewIdentifier(name.Text())
		}
		elements = append(elements, f.NewBindingElement(nil /*dotDotDotToken*/, property, f.NewIdentifier(specifier.Name().Text()), nil /*initializer*/))
	}
	module := declaration.AsImportDeclaration().ModuleSpecifier.Text()
	require := f.NewCallExpression(f.NewIdentifier("require"), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{f.NewStringLiteral(module, ast.TokenFlagsNone)}), ast.NodeFlagsNone)
	pattern := f.NewBindingPattern(ast.KindObjectBindingPattern, f.NewNodeList(elements))
	list := f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{f.NewVariableDeclaration(pattern, nil /*exclamationToken*/, nil /*typeNode*/, require)}), ast.NodeFlagsConst)
	statement := f.NewVariableStatement(nil /*modifiers*/, list)
	ast.SetParentInChildren(statement)
	return statement
}

// preludeImports returns import declarations for names, the prelude names,
// effect root exports, and subpath modules a file uses as values, sorted:
//
//	import * as Console from "effect/Console"
//	import * as Effect from "effect/Effect"
//	import { flow } from "effect/Function"
//	import * as HttpRouter from "effect/http/HttpRouter"
//	import { TaggedError, pipe } from "vibelang-runtime"
//
// The checker resolved each use to the runtime's or effect's export, so the
// declarations bind the names the emitted code already refers to. A root
// export is imported from its own module, never from effect's root, which
// would load every module, and a subpath module from itself, never from its
// package. They are ES module imports; for a file emitted as CommonJS,
// requireNamedImports rewrites the named ones.
func preludeImports(f *ast.NodeFactory, names []string) []*ast.Node {
	var imports []*ast.Node
	named := map[string][]*ast.Node{} // module -> named import specifiers
	var namedModules []string
	for _, name := range names {
		module, namespace := preludeModules[name], true
		if module == "" && effectFunctionNames[name] {
			module, namespace = "effect/Effect", false
		} else if subpath, ok := effectSubpathNames[name]; module == "" && ok {
			module = subpath.module
		} else if module == "" {
			root := effectRootNames[name]
			module, namespace = root.module, root.namespace
		}
		if module == runtimeModule || !namespace {
			if named[module] == nil {
				namedModules = append(namedModules, module)
			}
			named[module] = append(named[module], f.NewImportSpecifier(false /*isTypeOnly*/, nil /*propertyName*/, f.NewIdentifier(name)))
			continue
		}
		clause := f.NewImportClause(ast.KindUnknown, nil /*name*/, f.NewNamespaceImport(f.NewIdentifier(name)))
		imports = append(imports, f.NewImportDeclaration(nil /*modifiers*/, clause, f.NewStringLiteral(module, ast.TokenFlagsNone), nil /*attributes*/))
	}
	// The runtime's named imports come last, as before effect's root joined.
	slices.SortStableFunc(namedModules, func(a, b string) int {
		if (a == runtimeModule) != (b == runtimeModule) {
			if a == runtimeModule {
				return 1
			}
			return -1
		}
		return strings.Compare(a, b)
	})
	for _, module := range namedModules {
		clause := f.NewImportClause(ast.KindUnknown, nil /*name*/, f.NewNamedImports(f.NewNodeList(named[module])))
		imports = append(imports, f.NewImportDeclaration(nil /*modifiers*/, clause, f.NewStringLiteral(module, ast.TokenFlagsNone), nil /*attributes*/))
	}
	for _, declaration := range imports {
		ast.SetParentInChildren(declaration)
	}
	return imports
}
