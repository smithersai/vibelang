package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The declaration file of a .vibe file is ordinary TypeScript, so it must import
// what the source took from the prelude and name its imports by output:
//
//	// main.vibe                               // main.d.ts
//	import { find } from "./users.vibe"        import { Effect } from "effect";
//	export const one: Effect<number> = …     import { find } from "./users.js";
//	                                         export declare const one: Effect.Effect<number>;
//
// Effect's own modules, the prelude's Effect, Layer, Schema and Scope
// included, come from effect, as an Effect TypeScript file imports them, so a
// declaration never names the runtime's aliases of Effect's types.
//
// Declaration emit asks whether each name a declaration writes is visible;
// preludeNameVisible says yes for a prelude name and records it, and
// transformDeclarations imports the recorded names and rewrites specifiers.

// preludeNameVisible lets the declaration file of a .vibe file write a prelude
// name or effect root export that the source wrote, such as Effect in
// Effect<number> or Option in Option.Option<string>.
func preludeNameVisible(c *checker.Checker, entityName *ast.Node, symbol *ast.Symbol) bool {
	first := ast.GetFirstIdentifier(entityName)
	name := first.Text()
	_, isPrelude := preludeModules[name]
	if !isPrelude && !isEffectExportName(name) {
		return false
	}
	file := ast.GetSourceFileOfNode(entityName)
	if !isVibeLangFile(file) {
		return false
	}
	state := preludeStateOf(c)
	if prelude := preludeSymbol(c, state, file, name); prelude != symbol {
		// The type Option, which names Option.Option (D311), imports the
		// module; moduleServiceTypes writes the export's type.
		if symbol == nil || ast.IsQualifiedName(entityName) || moduleAliasTypeOf(c, prelude, name) != symbol {
			return false
		}
	}
	if isServiceShapeFactory(first) {
		// service Name: Type's extends clause, which the service's
		// declarations replace (services_declarations.go), so it imports nothing.
		return true
	}
	if parent := first.Parent; parent != nil && ast.IsQualifiedName(parent) && collisionModules(c)[parent] != "" {
		// Effect.Array.T, which effectCollisionTypes writes as an import
		// type of effect/Array, so it imports nothing.
		return true
	}
	recordTypeUse(state, file, first)
	return true
}

// recordTypeUse records that the declaration file of file writes identifier,
// a prelude name or effect root export, so transformDeclarations imports it.
func recordTypeUse(state *preludeState, file *ast.SourceFile, identifier *ast.Node) {
	if state.typeUses[file] == nil {
		state.typeUses[file] = map[string]bool{}
	}
	state.typeUses[file][identifier.Text()] = true
	state.typeRefs[identifier] = true
}

// lockedCopy copies a map of the checker's state while its lock is held, for
// a transform to read after the lock is released: other files' declaration
// transforms write the state in parallel.
func lockedCopy[K comparable, V any](m map[K]V) map[K]V {
	if m == nil {
		return nil
	}
	copied := make(map[K]V, len(m))
	for k, v := range m {
		copied[k] = v
	}
	return copied
}

// transformDeclarations returns the transform for the declaration file of a
// .vibe file, or nil for any other file.
func transformDeclarations(resolver printer.EmitResolver, sourceFile *ast.SourceFile) func(*ast.SourceFile) *ast.SourceFile {
	r, ok := resolver.(*checker.EmitResolver)
	if !ok || !isVibeLangFile(sourceFile) {
		return nil
	}
	return func(declarations *ast.SourceFile) *ast.SourceFile {
		rewriter := &specifierRewriter{sourceDirectory: tspath.GetDirectoryPath(string(sourceFile.FileName()))}
		keys := &computedKeyRewriter{keys: map[string]computedKey{}, bound: map[string]bool{}}
		r.WithChecker(func(c *checker.Checker) {
			if namespace := preludeSymbol(c, preludeStateOf(c), sourceFile, "Effect"); namespace != nil {
				if effect := effectInterfaceOfModule(c, namespace); effect != nil {
					rewriter.effectPath = effectModulePath(c, effect)
				}
			}
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				// An inferred arrow may load Effect only through its callee,
				// without any prelude import in this source file.
				if rewriter.effectPath == "" {
					rewriter.effectPath = effectFunctionPath(c, n)
				}
				if ast.IsComputedPropertyName(n) {
					keys.add(c, sourceFile, n.Expression())
				}
				return n.ForEachChild(visit)
			}
			sourceFile.AsNode().ForEachChild(visit)
		})
		rewriter.NewTransformer(rewriter.visit, resolver.EmitContext())
		declarations = rewriter.TransformSourceFile(declarations)
		var collisions map[*ast.Node]string
		r.WithChecker(func(c *checker.Checker) {
			state := preludeStateOf(c)
			aliases := &runtimeAliasTypes{record: func(identifier *ast.Node) { recordTypeUse(state, sourceFile, identifier) }}
			aliases.NewTransformer(aliases.visit, resolver.EmitContext())
			declarations = aliases.TransformSourceFile(declarations)
			collisions = lockedCopy(collisionModules(c))
		})
		if len(collisions) > 0 {
			types := &effectCollisionTypes{modules: collisions}
			types.NewTransformer(types.visit, resolver.EmitContext())
			declarations = types.TransformSourceFile(declarations)
		}
		members := &sourcePropertyModifiers{}
		members.NewTransformer(members.visit, resolver.EmitContext())
		declarations = members.TransformSourceFile(declarations)
		if len(keys.keys) > 0 {
			for _, statement := range declarations.Statements.Nodes {
				forEachTopLevelName(statement, func(name string) { keys.bound[name] = true })
			}
			keys.NewTransformer(keys.visit, resolver.EmitContext())
			declarations = keys.TransformSourceFile(declarations)
		}

		var names []string
		ambientTypes := map[string]bool{}
		var refs, serviceTypes map[*ast.Node]bool
		var moduleImports map[string]*ast.Node
		r.WithChecker(func(c *checker.Checker) {
			state := preludeStateOf(c)
			// S19-1: nodebuilder can recycle a written return annotation on an
			// arrow without asking entity visibility. Inspect only references
			// retained in the declaration, and resolve their original source
			// identifiers so local names and explicit imports still shadow the
			// prelude. D67 keeps the written contract; S17-1's specifier rewrite
			// above still handles inferred and linked dependency types.
			//
			// The node builder also copies a library's own type node into an
			// inferred type, such as SchemaAST.ParseOptions from effect's
			// Schema.d.ts for Schema.decodeUnknownEffect(…), when the .vibe
			// file writes its first name (preludeNameUnwritten), without
			// asking entity visibility either.
			bound := map[string]bool{}
			for _, statement := range declarations.Statements.Nodes {
				forEachTopLevelName(statement, func(name string) { bound[name] = true })
			}
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if name := typeEntityName(n); name != nil {
					if first := resolver.EmitContext().MostOriginal(ast.GetFirstIdentifier(name)); state.moduleNames[first] {
						recordTypeUse(state, sourceFile, first) // preludeModuleName's Option of Option.Option<string>
					}
					original := resolver.EmitContext().MostOriginal(n)
					if written := typeEntityName(original); written != nil && original.Kind == n.Kind && !ast.NodeIsSynthesized(original) {
						first := ast.GetFirstIdentifier(written)
						if file := ast.GetSourceFileOfNode(original); file == sourceFile {
							preludeNameVisible(c, first, c.GetSymbolAtLocation(first))
						} else if file != nil && file != declarations && !bound[first.Text()] {
							recordLibraryTypeUse(c, state, sourceFile, first)
						}
					}
				}
				return n.ForEachChild(visit)
			}
			declarations.AsNode().ForEachChild(visit)
			for _, identifier := range keys.written {
				recordTypeUse(state, sourceFile, identifier)
			}
			for name := range state.typeUses[sourceFile] {
				names = append(names, name)
				ambientTypes[name] = isBuiltinGlobalType(c, name)
			}
			// The checker's maps grow while other files emit in parallel, so
			// the transforms below read copies taken under the checker's lock.
			refs = lockedCopy(state.typeRefs)
			serviceTypes = lockedCopy(moduleServiceStateOf(c).typeNames)
			moduleImports = lockedCopy(moduleServiceStateOf(c).imports[sourceFile])
		})
		// The type Option is written Option.Option (D311), and the type Prompt,
		// which the file imports, keeps its import.
		types := &moduleServiceTypes{names: serviceTypes}
		types.NewTransformer(types.visit, resolver.EmitContext())
		declarations = types.TransformSourceFile(declarations)
		// The prelude's types Effect<A, E, R> and Scope are Effect.Effect and
		// Scope.Scope, which effect declares.
		aliasTypes := &preludeAliasTypes{refs: refs}
		aliasTypes.NewTransformer(aliasTypes.visit, resolver.EmitContext())
		declarations = aliasTypes.TransformSourceFile(declarations)
		slots := &emptySlots{}
		slots.NewTransformer(slots.visit, resolver.EmitContext())
		declarations = slots.TransformSourceFile(declarations)
		if added := moduleImportDeclarations(resolver.EmitContext().Factory, moduleImports, declarations); len(added) > 0 {
			statements := resolver.EmitContext().Factory.NewNodeList(append(added, declarations.Statements.Nodes...))
			statements.Loc = declarations.Statements.Loc
			declarations = resolver.EmitContext().Factory.UpdateSourceFile(declarations, statements, declarations.EndOfFileToken).AsSourceFile()
		}
		if len(names) == 0 {
			return declarations
		}
		slices.Sort(names)
		declarations = sourceNamespaceImports(resolver.EmitContext(), sourceFile, declarations, names)
		// A file that imports Effect from effect and writes Effect<…> keeps
		// its import, so the prelude's Effect needs another local name.
		aliases, imported := preludeAliases(declarations, names, ambientTypes)
		if len(aliases) > 0 {
			renamer := &preludeRenamer{aliases: aliases, refs: refs}
			renamer.NewTransformer(renamer.visit, resolver.EmitContext())
			declarations = renamer.TransformSourceFile(declarations)
		}
		// import { Effect, Option, Scope } from "effect"
		// import { HttpRouter } from "effect/http"
		// import { Experimental } from "vibelang-runtime"
		//
		// Not import type: a declaration file names its imports as the
		// Effect TypeScript it stands for does, and in a declaration file every
		// import is a type. A name joins an import of its module that the
		// file keeps, `import { Array } from "effect"`, where Effect
		// TypeScript would have imported it too.
		f := resolver.EmitContext().Factory
		kept := keptNamedImports(declarations)
		var imports []*ast.Node
		for _, module := range declarationModules(names) {
			var specifiers []*ast.Node
			for _, name := range names {
				if declarationModuleOf(name) != module || imported[name] {
					continue
				}
				if alias, ok := aliases[name]; ok {
					specifiers = append(specifiers, f.NewImportSpecifier(false /*isTypeOnly*/, f.NewIdentifier(name), f.NewIdentifier(alias)))
					continue
				}
				specifiers = append(specifiers, f.NewImportSpecifier(false /*isTypeOnly*/, nil /*propertyName*/, f.NewIdentifier(name)))
			}
			if len(specifiers) == 0 {
				continue
			}
			if at, ok := kept[module]; ok {
				declarations = joinImport(f, declarations, at, specifiers)
				continue
			}
			clause := f.NewImportClause(ast.KindUnknown, nil /*name*/, f.NewNamedImports(f.NewNodeList(specifiers)))
			imports = append(imports, f.NewImportDeclaration(nil /*modifiers*/, clause, f.NewStringLiteral(module, ast.TokenFlagsNone), nil /*attributes*/))
		}
		// The list keeps the source range, so the printer still emits the
		// comments before the file's first statement, such as its header, first.
		statements := f.NewNodeList(append(imports, declarations.Statements.Nodes...))
		statements.Loc = declarations.Statements.Loc
		return f.UpdateSourceFile(declarations, statements, declarations.EndOfFileToken).AsSourceFile()
	}
}

// namespaceImportOfModule returns M when statement is import * as M from the
// module that holds the prelude's M, "effect/Context" for Context, and "" for
// any other statement.
func namespaceImportOfModule(statement *ast.Node) string {
	if !ast.IsImportDeclaration(statement) || statement.ImportClause() == nil || !ast.IsStringLiteral(statement.ModuleSpecifier()) {
		return ""
	}
	clause := statement.ImportClause().AsImportClause()
	if clause.NamedBindings == nil || !ast.IsNamespaceImport(clause.NamedBindings) {
		return ""
	}
	name := clause.NamedBindings.Name().Text()
	if preludeModulePath(name) != statement.ModuleSpecifier().Text() {
		return ""
	}
	return name
}

// sourceNamespaceImports returns declarations with each import of source,
// import * as M from "effect/M", that binds a name of names and that
// declaration emit dropped because no declaration the source wrote names it:
// a service's base writes Context after that emit, and a contract writes
// Effect only in its output. The file then imports the module as the Effect
// TypeScript it stands for does (D501), in the source's order.
func sourceNamespaceImports(ec *printer.EmitContext, source *ast.SourceFile, declarations *ast.SourceFile, names []string) *ast.SourceFile {
	f := ec.Factory
	statements := slices.Clone(declarations.Statements.Nodes)
	changed := false
	for _, statement := range source.Statements.Nodes {
		name := namespaceImportOfModule(statement)
		if name == "" || !slices.Contains(names, name) || slices.ContainsFunc(statements, func(kept *ast.Node) bool { return namespaceImportOfModule(kept) == name }) {
			continue
		}
		at := 0
		for i, kept := range statements {
			if ast.IsImportDeclaration(kept) && ec.MostOriginal(kept).Pos() < statement.Pos() {
				at = i + 1
			}
		}
		clause := f.NewImportClause(statement.ImportClause().AsImportClause().PhaseModifier, nil /*name*/, f.NewNamespaceImport(f.NewIdentifier(name)))
		statements = slices.Insert(statements, at, f.NewImportDeclaration(nil /*modifiers*/, clause, f.NewStringLiteral(statement.ModuleSpecifier().Text(), ast.TokenFlagsNone), nil /*attributes*/))
		changed = true
	}
	if !changed {
		return declarations
	}
	list := f.NewNodeList(statements)
	list.Loc = declarations.Statements.Loc
	return f.UpdateSourceFile(declarations, list, declarations.EndOfFileToken).AsSourceFile()
}

// keptNamedImports returns the index in declarations' statements of the first
// import of each module that the declaration file keeps with named imports
// only, `import { Array } from "effect"`, by module.
func keptNamedImports(declarations *ast.SourceFile) map[string]int {
	kept := map[string]int{}
	for i, statement := range declarations.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || !ast.IsStringLiteral(statement.ModuleSpecifier()) {
			continue
		}
		clause := statement.AsImportDeclaration().ImportClause
		if clause == nil || clause.Name() != nil || clause.AsImportClause().PhaseModifier != ast.KindUnknown {
			continue
		}
		if bindings := clause.AsImportClause().NamedBindings; bindings == nil || !ast.IsNamedImports(bindings) {
			continue
		}
		if _, ok := kept[statement.ModuleSpecifier().Text()]; !ok {
			kept[statement.ModuleSpecifier().Text()] = i
		}
	}
	return kept
}

// joinImport returns declarations with specifiers added to the named imports
// of its statement at index at, each before the first one whose name sorts
// after it, so the import keeps its order.
func joinImport(f *printer.NodeFactory, declarations *ast.SourceFile, at int, specifiers []*ast.Node) *ast.SourceFile {
	statement := declarations.Statements.Nodes[at].AsImportDeclaration()
	clause := statement.ImportClause.AsImportClause()
	named := clause.NamedBindings.AsNamedImports()
	elements := slices.Clone(named.Elements.Nodes)
	for _, specifier := range specifiers {
		i := slices.IndexFunc(elements, func(e *ast.Node) bool { return e.Name().Text() > specifier.Name().Text() })
		if i < 0 {
			i = len(elements)
		}
		elements = slices.Insert(elements, i, specifier)
	}
	list := f.NewNodeList(elements)
	list.Loc = named.Elements.Loc
	bindings := f.UpdateNamedImports(named, list)
	updated := f.UpdateImportDeclaration(statement, statement.Modifiers(), f.UpdateImportClause(clause, clause.PhaseModifier, clause.Name(), bindings), statement.ModuleSpecifier, statement.Attributes)
	nodes := slices.Clone(declarations.Statements.Nodes)
	nodes[at] = updated
	statements := f.NewNodeList(nodes)
	statements.Loc = declarations.Statements.Loc
	return f.UpdateSourceFile(declarations, statements, declarations.EndOfFileToken).AsSourceFile()
}

// preludeModuleName names module in the declaration file of file, a .vibe
// file, when the node builder would write a type from it as an import type
// because no import of file binds it. A module the source reaches through a
// name it writes, a prelude name, an effect root export or a subpath module,
// is named by that name, as in Effect TypeScript that imports the module:
//
//	// options.vibe                                         // options.d.ts
//	export const fromString =                               import { Option } from "effect";
//	  Option.liftPredicate((s: string) => s.length > 0)     export declare const fromString: (b: string) => Option.Option<string>;
//
// rather than import("effect/Option").Option<string>. The Effect module is in
// scope whether or not the source writes Effect, since a function is an
// Effect by what it does, and Effect TypeScript that declares one imports
// Effect. transformDeclarations imports each name that the declaration file
// keeps.
func preludeModuleName(c *checker.Checker, file *ast.SourceFile, module *ast.Symbol, newIdentifier func(string) *ast.Node) *ast.Node {
	if !isVibeLangFile(file) {
		return nil
	}
	state := preludeStateOf(c)
	name, ok := modulesInScope(c, state, file)[c.GetMergedSymbol(module)]
	if !ok {
		return nil
	}
	identifier := newIdentifier(name)
	state.moduleNames[identifier] = true
	return identifier
}

// preludeNameUnwritten reports whether name, the first name of a type node that
// declaration emit copies into the declaration file of file, resolves to
// symbol only through the prelude and file never writes it. Effect TypeScript
// would not import such a name, so the declaration writes what TypeScript
// writes: import("effect/SchemaAST").ParseOptions, not SchemaAST.ParseOptions.
func preludeNameUnwritten(c *checker.Checker, file *ast.SourceFile, name string, symbol *ast.Symbol) bool {
	if !isVibeLangFile(file) || !isPreludeName(name) {
		return false
	}
	state := preludeStateOf(c)
	if writtenPreludeNames(c, state, file)[name] {
		return false
	}
	prelude := preludeSymbol(c, state, file, name)
	if prelude == nil {
		return false
	}
	return resolvedAlias(c, prelude) == resolvedAlias(c, symbol) || moduleAliasTypeOf(c, prelude, name) == symbol
}

// writtenPreludeNames returns the prelude names that a declaration of file may
// write: each one file writes, and Effect where file has an Effect form, whose
// Effect TypeScript imports it. The schema, error and data forms write theirs
// as intrinsics, as an A!E!R annotation and try write theirs.
func writtenPreludeNames(c *checker.Checker, state *preludeState, file *ast.SourceFile) map[string]bool {
	if written, ok := state.written[file]; ok {
		return written
	}
	written := map[string]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			if !isMemberNameOf(node) && isPreludeName(node.Text()) {
				written[node.Text()] = true
				if isEffectGlobal(c, state, file, node) {
					written["Effect"] = true
				}
			}
			return false
		}
		if !written["Effect"] && effectFunctionPath(c, node) != "" {
			written["Effect"] = true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	state.written[file] = written
	return written
}

// isEffectGlobal reports whether identifier, in file, is a bare Effect
// function, hatch or runner of the prelude, not a local of the same name:
// sleep is Effect.sleep in Effect TypeScript.
func isEffectGlobal(c *checker.Checker, state *preludeState, file *ast.SourceFile, identifier *ast.Node) bool {
	name := identifier.Text()
	if !effectFunctionNames[name] && !hatchNames[name] && !slices.Contains(effectRootRunners, name) {
		return false
	}
	prelude := preludeSymbol(c, state, file, name)
	return prelude != nil && resolvedAlias(c, c.GetSymbolAtLocation(identifier)) == resolvedAlias(c, prelude)
}

// effectFunctionPath returns the path of the module that defines Effect when
// node is a function that returns an Effect, an Effect function or one that
// makes an Effect, or "".
func effectFunctionPath(c *checker.Checker, node *ast.Node) string {
	if !isLowerable(node) || node.Body() == nil {
		return ""
	}
	for _, signature := range c.GetSignaturesOfType(c.GetTypeAtLocation(node), checker.SignatureKindCall) {
		if path := effectModulePath(c, c.GetReturnTypeOfSignature(signature)); path != "" {
			return path
		}
	}
	return ""
}

// modulesInScope returns the modules the declaration file of file may name,
// by their names: each one writtenPreludeNames gives that file does not
// declare.
func modulesInScope(c *checker.Checker, state *preludeState, file *ast.SourceFile) map[*ast.Symbol]string {
	if scope, ok := state.scopes[file]; ok {
		return scope
	}
	declared := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		forEachTopLevelName(statement, func(name string) { declared[name] = true })
	}
	written := writtenPreludeNames(c, state, file)
	names := make([]string, 0, len(written))
	for name := range written {
		names = append(names, name)
	}
	slices.Sort(names)
	scope := map[*ast.Symbol]string{}
	for _, name := range names {
		if declared[name] {
			continue
		}
		symbol := preludeSymbol(c, state, file, name)
		if module, ok := preludeModules[name]; ok && strings.HasPrefix(module, effectRootModule+"/") && symbol == nil {
			symbol = effectExportSymbol(c, state, file, name) // a file that loads effect but not the runtime
		}
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil || ast.GetDeclarationOfKind(symbol, ast.KindSourceFile) == nil {
			continue // not a module, such as TaggedError or sleep
		}
		if module := c.GetMergedSymbol(symbol); scope[module] == "" {
			scope[module] = name
		}
	}
	state.scopes[file] = scope
	return scope
}

// declarationModuleOf returns the module a declaration file imports name,
// a prelude name, effect root export, or subpath module, from: effect's root
// for one of Effect's modules, the runtime for the rest of the prelude, or the
// subpath module's package.
func declarationModuleOf(name string) string {
	if module, isPrelude := preludeModules[name]; isPrelude {
		if strings.HasPrefix(module, effectRootModule+"/") {
			return effectRootModule
		}
		return runtimeModule
	}
	if subpath, ok := effectSubpathNames[name]; ok {
		return subpath.barrel
	}
	return effectRootModule
}

// declarationModules returns the modules a declaration file imports names
// from, in the order its imports stand: effect's root, the subpath packages
// sorted, then the runtime.
func declarationModules(names []string) []string {
	seen := map[string]bool{}
	var modules []string
	for _, name := range names {
		if module := declarationModuleOf(name); !seen[module] {
			seen[module] = true
			modules = append(modules, module)
		}
	}
	rank := func(module string) int {
		switch module {
		case effectRootModule:
			return 0
		case runtimeModule:
			return 2
		}
		return 1
	}
	slices.SortFunc(modules, func(a, b string) int {
		if rank(a) != rank(b) {
			return rank(a) - rank(b)
		}
		return strings.Compare(a, b)
	})
	return modules
}

// typeEntityName returns the name that n, a type reference such as
// Effect<number> or a type query such as typeof Schema.Json.Type, writes;
// or nil.
func typeEntityName(n *ast.Node) *ast.Node {
	switch {
	case ast.IsTypeReferenceNode(n):
		return n.AsTypeReferenceNode().TypeName
	case ast.IsTypeQueryNode(n):
		return n.AsTypeQueryNode().ExprName
	}
	return nil
}

// resolvedAlias returns the symbol that symbol aliases, or symbol.
func resolvedAlias(c *checker.Checker, symbol *ast.Symbol) *ast.Symbol {
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		return c.GetAliasedSymbol(symbol)
	}
	return symbol
}

// recordLibraryTypeUse records that the declaration file of file writes
// identifier, the first name of a type node the node builder copied from a
// library's declarations, when it names the symbol that the prelude name or
// effect root export of the same name does from file.
func recordLibraryTypeUse(c *checker.Checker, state *preludeState, file *ast.SourceFile, identifier *ast.Node) {
	name := identifier.Text()
	_, isPrelude := preludeModules[name]
	if !isPrelude && !isEffectExportName(name) {
		return
	}
	prelude := preludeSymbol(c, state, file, name)
	got := resolvedAlias(c, c.GetSymbolAtLocation(identifier))
	if want := resolvedAlias(c, prelude); want != nil && want == got {
		recordTypeUse(state, file, identifier)
	} else if got != nil && got == moduleAliasTypeOf(c, prelude, name) && ast.IsTypeReferenceNode(identifier.Parent) {
		// effect's own Option, the type, which the declaration file writes
		// through the module the prelude names (D311).
		recordTypeUse(state, file, identifier)
		moduleServiceStateOf(c).typeNames[identifier] = true
	}
}

// effectModulePath identifies Effect's defining module by its interface symbol,
// so declaration import rewriting never guesses from a package-path suffix.
func effectModulePath(c *checker.Checker, t *checker.Type) string {
	if symbol := effectInterfaceSymbol(c, t); symbol != nil {
		for _, declaration := range symbol.Declarations() {
			return tspath.RemoveFileExtension(string(ast.GetSourceFileOfNode(declaration).FileName()))
		}
	}
	return ""
}

// preludeAliases returns a free local name for each prelude name in names
// that a declaration, import or ambient global type already binds, and
// the names an import of declarations already imports, under the same name,
// from the module declaration emit would import them from, which need no
// import of their own: the Effect of `import { Effect } from "effect"` and
// the Context of `import * as Context from "effect/Context"`.
func preludeAliases(declarations *ast.SourceFile, names []string, ambientTypes map[string]bool) (map[string]string, map[string]bool) {
	bound := map[string]bool{}
	imported := map[string]bool{}
	for _, statement := range declarations.Statements.Nodes {
		forEachTopLevelName(statement, func(name string) { bound[name] = true })
		if ast.IsImportDeclaration(statement) {
			if name := namespaceImportOfModule(statement); name != "" {
				imported[name] = true
			}
			for _, name := range namesImportedAsThemselves(statement) {
				if declarationModuleOf(name) == statement.ModuleSpecifier().Text() {
					imported[name] = true
				}
			}
		}
	}
	used := map[string]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			used[node.Text()] = true
		}
		return node.ForEachChild(visit)
	}
	declarations.AsNode().ForEachChild(visit)
	aliases := map[string]string{}
	for _, name := range names {
		if (!bound[name] && !ambientTypes[name]) || imported[name] {
			continue
		}
		for i := 1; ; i++ {
			if alias := name + "_" + strconv.Itoa(i); !bound[alias] && !used[alias] {
				aliases[name] = alias
				used[alias] = true
				break
			}
		}
	}
	return aliases, imported
}

// namesImportedAsThemselves returns the names that statement, an import
// declaration, imports under their own names: Effect in
// import { Effect } from "effect", not E in import { Effect as E }.
func namesImportedAsThemselves(statement *ast.Node) []string {
	clause := statement.AsImportDeclaration().ImportClause
	if clause == nil || clause.AsImportClause().NamedBindings == nil || !ast.IsNamedImports(clause.AsImportClause().NamedBindings) {
		return nil
	}
	var names []string
	for _, specifier := range clause.AsImportClause().NamedBindings.AsNamedImports().Elements.Nodes {
		if property := specifier.PropertyName(); property == nil || property.Text() == specifier.Name().Text() {
			names = append(names, specifier.Name().Text())
		}
	}
	return names
}

// moduleServiceTypes writes a type that names a module's service by the
// module's name (D311) as the key's type, which TypeScript reads:
//
//	// main.vibe                               // main.d.ts
//	export const read = (fs: FileSystem) => …   import type { FileSystem } from "effect";
//	                                            export declare const read: (fs: FileSystem.FileSystem) => …
//
// It runs before preludeRenamer, which may rename the module's name.
type moduleServiceTypes struct {
	transformers.Transformer
	names map[*ast.Node]bool // the identifiers that write a module's name as its service's type
}

func (tx *moduleServiceTypes) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	if ast.IsTypeReferenceNode(node) {
		name := node.AsTypeReferenceNode().TypeName
		last := name
		if ast.IsQualifiedName(last) {
			last = last.AsQualifiedName().Right
		}
		if ast.IsIdentifier(last) && tx.names[tx.EmitContext().MostOriginal(last)] {
			f := tx.Factory()
			reference := node.AsTypeReferenceNode()
			return f.UpdateTypeReferenceNode(reference, f.NewQualifiedName(name, f.NewIdentifier(last.Text())), reference.TypeArguments)
		}
	}
	return node
}

// sourcePropertyModifiers keeps the modifiers written on ordinary source
// properties and index signatures (Chapter 1, Declaration output). The parser's
// D134 readonly default is a checker rule, not a modifier in the source's public
// TypeScript declaration. Explicit readonly and compiler-generated members keep
// their modifiers. In particular, data payloads retain their documented
// Data.TaggedEnum declaration form, and inferred Schema types are untouched.
type sourcePropertyModifiers struct {
	transformers.Transformer
}

func (tx *sourcePropertyModifiers) visit(node *ast.Node) *ast.Node {
	original := tx.EmitContext().MostOriginal(node)
	if parser.IsDataDeclaration(original) {
		return node
	}
	node = tx.Visitor().VisitEachChild(node)
	f := tx.Factory()
	modifiers, dropped := withoutImplicitReadonly(f, node, original)
	if !dropped {
		return node
	}
	switch node.Kind {
	case ast.KindPropertySignature:
		m := node.AsPropertySignatureDeclaration()
		return f.UpdatePropertySignatureDeclaration(m, modifiers, m.Name(), m.PostfixToken, m.Type, m.Initializer)
	case ast.KindIndexSignature:
		m := node.AsIndexSignatureDeclaration()
		return f.UpdateIndexSignatureDeclaration(m, modifiers, m.Parameters, m.Type)
	}
	return node
}

// withoutImplicitReadonly returns member's modifiers without readonly, and
// true, when original, the source member it was emitted from, has the
// readonly modifier the parser gave it, which the source does not write.
// A synthesized member (such as data's WithGenerics helper) is not a source
// property, and keeps its generated modifiers.
func withoutImplicitReadonly(f *printer.NodeFactory, member *ast.Node, original *ast.Node) (*ast.ModifierList, bool) {
	if member.Kind != ast.KindPropertySignature && member.Kind != ast.KindIndexSignature ||
		original == nil || original.Kind != ast.KindPropertySignature && original.Kind != ast.KindIndexSignature ||
		original.Flags&ast.NodeFlagsReparsed != 0 || original.Modifiers() == nil ||
		!slices.ContainsFunc(original.Modifiers().Nodes, func(m *ast.Node) bool {
			return m.Kind == ast.KindReadonlyKeyword && m.Flags&ast.NodeFlagsReparsed != 0
		}) {
		return nil, false
	}
	// Error payload signatures are generated in the class heritage, but
	// retain the source field's range for diagnostics rather than Reparsed.
	// They and data payloads follow their Effect counterparts, not ordinary
	// interface/type-literal declaration modifiers.
	for parent := original.Parent; parent != nil; parent = parent.Parent {
		if parser.IsDataDeclaration(parent) {
			return nil, false
		}
		if parent.Kind == ast.KindHeritageClause {
			if form, _ := errorFormOf(parent.Parent); form != errorFormNone {
				return nil, false
			}
		}
	}
	modifiers := member.Modifiers()
	if modifiers == nil {
		return nil, false
	}
	var kept []*ast.Node
	for _, modifier := range modifiers.Nodes {
		if modifier.Kind != ast.KindReadonlyKeyword {
			kept = append(kept, modifier)
		}
	}
	if len(kept) == len(modifiers.Nodes) {
		return nil, false
	}
	if len(kept) == 0 {
		return nil, true
	}
	list := f.NewModifierList(kept)
	list.Loc = modifiers.Loc
	return list, true
}

// emptySlots writes an Effect type that the source writes in the ! form as
// Effect TypeScript writes it, without the empty slots at its end, which the
// parser fills with never:
//
//	// main.vibe                              // main.d.ts
//	export type Count = () => number!!        export type Count = () => Effect.Effect<number>;
//	export type Find = (id: string) => User!NotFound!
//	                                          export type Find = (id: string) => Effect.Effect<User, NotFound>;
//	export function find(id: string): User!NotFound { … }
//	                                          export declare function find(id: string): Effect.Effect<User, NotFound>;
//
// The last is a function's return annotation that leaves its dependencies
// out, so its body supplies them: when they come to never, the declaration
// leaves them out too. Effect's E and R default to never, so each type is
// the one the source declares. A slot the source fills, never included,
// stays. Parentheses that group a ! form, (A!E!R) | X, go with it.
type emptySlots struct {
	transformers.Transformer
}

func (tx *emptySlots) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	original := tx.EmitContext().MostOriginal(node)
	switch {
	case ast.IsParenthesizedTypeNode(node) && ast.IsTypeReferenceNode(node.AsParenthesizedTypeNode().Type) && isBangType(tx.EmitContext().MostOriginal(node.AsParenthesizedTypeNode().Type)):
		// (A!E!R) | X: the parentheses group the ! form, which the
		// declaration writes as Effect.Effect<A, E, R>, a reference that no
		// type position needs them around, as the TypeScript writes it.
		return node.AsParenthesizedTypeNode().Type
	case ast.IsTypeReferenceNode(node) && isBangType(original) && len(original.TypeArguments()) == 3:
		keep := 3
		for keep > 1 && isEmptySlot(original.TypeArguments()[keep-1]) {
			keep--
		}
		return tx.withArguments(node, keep)
	case ast.IsFunctionDeclaration(node) || ast.IsMethodDeclaration(node):
		if node.Type() != nil && ast.IsFunctionLike(original) && infersOmittedDependencies(original) {
			return tx.withReturnType(node, tx.withoutNeverDependencies(node.Type()))
		}
	case ast.IsVariableDeclaration(node):
		if t := node.Type(); t != nil && ast.IsFunctionTypeNode(t) && t.Type() != nil && ast.IsVariableDeclaration(original) {
			if fn := original.Initializer(); fn != nil && (ast.IsArrowFunction(fn) || ast.IsFunctionExpression(fn)) && infersOmittedDependencies(fn) {
				if returned := tx.withoutNeverDependencies(t.Type()); returned != t.Type() {
					f := tx.Factory()
					fnType := t.AsFunctionTypeNode()
					declaration := node.AsVariableDeclaration()
					return f.UpdateVariableDeclaration(declaration, declaration.Name(), declaration.ExclamationToken,
						f.UpdateFunctionTypeNode(fnType, fnType.TypeParameters, fnType.Parameters, returned), declaration.Initializer)
				}
			}
		}
	}
	return node
}

// withArguments returns reference, an Effect type with three type arguments,
// with only its first keep.
func (tx *emptySlots) withArguments(reference *ast.Node, keep int) *ast.Node {
	arguments := reference.AsTypeReferenceNode().TypeArguments
	if keep >= 3 || arguments == nil || len(arguments.Nodes) != 3 {
		return reference
	}
	f := tx.Factory()
	list := f.NewNodeList(arguments.Nodes[:keep])
	list.Loc = arguments.Loc
	return f.UpdateTypeReferenceNode(reference.AsTypeReferenceNode(), reference.AsTypeReferenceNode().TypeName, list)
}

// withoutNeverDependencies returns t, an inferred Effect type, without its
// dependencies when they are never.
func (tx *emptySlots) withoutNeverDependencies(t *ast.Node) *ast.Node {
	if !ast.IsTypeReferenceNode(t) || len(t.TypeArguments()) != 3 || t.TypeArguments()[2].Kind != ast.KindNeverKeyword {
		return t
	}
	name := t.AsTypeReferenceNode().TypeName
	if !ast.IsQualifiedName(name) || name.AsQualifiedName().Right.Text() != "Effect" {
		return t
	}
	return tx.withArguments(t, 2)
}

// withReturnType returns fn, a function or method declaration, with
// returnType for its return type.
func (tx *emptySlots) withReturnType(fn *ast.Node, returnType *ast.Node) *ast.Node {
	if returnType == fn.Type() {
		return fn
	}
	f := tx.Factory()
	if ast.IsFunctionDeclaration(fn) {
		d := fn.AsFunctionDeclaration()
		return f.UpdateFunctionDeclaration(d, d.Modifiers(), d.AsteriskToken, d.Name(), d.TypeParameters, d.Parameters, returnType, d.FullSignature, d.Body)
	}
	d := fn.AsMethodDeclaration()
	return f.UpdateMethodDeclaration(d, d.Modifiers(), d.AsteriskToken, d.Name(), d.PostfixToken, d.TypeParameters, d.Parameters, returnType, d.FullSignature, d.Body)
}

// isEmptySlot reports whether slot, a type argument of a ! form, is the never
// the parser wrote for a slot the source leaves empty.
func isEmptySlot(slot *ast.Node) bool {
	return slot.Kind == ast.KindNeverKeyword && slot.Flags&ast.NodeFlagsReparsed != 0
}

// infersOmittedDependencies reports whether fn's return annotation is a !
// form that leaves its dependencies out for the body to supply, A!E.
func infersOmittedDependencies(fn *ast.Node) bool {
	t := fn.Type()
	if t == nil || !isBangType(t) || len(t.TypeArguments()) != 3 {
		return false
	}
	dependencies := t.TypeArguments()[2]
	return dependencies.Kind == ast.KindInferType && dependencies.Flags&ast.NodeFlagsReparsed != 0
}

// preludeTypeAliases are the prelude names whose type the runtime declares as
// an alias of a type of the effect module of the same name.
var preludeTypeAliases = map[string]bool{"Effect": true, "Scope": true}

// preludeAliasTypes writes the prelude's type Effect<A, E, R>, and its type
// Scope, as the effect module's own type, as Effect TypeScript writes them:
//
//	// main.vibe                                        // main.d.ts
//	export type Scoped = Effect<number, never, Scope>   import { Effect, Scope } from "effect";
//	                                                    export type Scoped = Effect.Effect<number, never, Scope.Scope>;
//
// It runs before preludeRenamer, which may rename the module's name.
type preludeAliasTypes struct {
	transformers.Transformer
	refs map[*ast.Node]bool // the identifiers that write a prelude name
}

func (tx *preludeAliasTypes) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	if ast.IsTypeReferenceNode(node) {
		reference := node.AsTypeReferenceNode()
		if name := reference.TypeName; ast.IsIdentifier(name) && preludeTypeAliases[name.Text()] && tx.refs[tx.EmitContext().MostOriginal(name)] {
			f := tx.Factory()
			return f.UpdateTypeReferenceNode(reference, f.NewQualifiedName(name, f.NewIdentifier(name.Text())), reference.TypeArguments)
		}
	}
	return node
}

// runtimeAliasTypes writes a type that the checker inferred through the
// runtime's alias of an effect type, such as identity<Effect<number>>'s,
// import("vibelang-runtime").Effect<number, never, never>, as the prelude's
// Effect<number, never, never>, which preludeAliasTypes then writes
// Effect.Effect and transformDeclarations imports from effect, so the
// declaration names no runtime alias (Chapter 27, declaration rule 4).
type runtimeAliasTypes struct {
	transformers.Transformer
	record func(identifier *ast.Node) // records a prelude name the declaration file writes
}

func (tx *runtimeAliasTypes) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	if node.Kind != ast.KindImportType {
		return node
	}
	t := node.AsImportTypeNode()
	if t.IsTypeOf || t.Argument == nil || !ast.IsLiteralTypeNode(t.Argument) || t.Qualifier == nil || !ast.IsIdentifier(t.Qualifier) || !preludeTypeAliases[t.Qualifier.Text()] {
		return node
	}
	if literal := t.Argument.AsLiteralTypeNode().Literal; !ast.IsStringLiteral(literal) || literal.Text() != runtimeModule {
		return node
	}
	name := tx.Factory().NewIdentifier(t.Qualifier.Text())
	tx.record(name)
	return tx.Factory().NewTypeReferenceNode(name, t.TypeArguments)
}

// preludeRenamer gives the identifiers that write a prelude name the alias
// the declaration file imports it under.
type preludeRenamer struct {
	transformers.Transformer
	aliases map[string]string
	refs    map[*ast.Node]bool // the identifiers that preludeNameVisible allowed
}

func (tx *preludeRenamer) visit(node *ast.Node) *ast.Node {
	if ast.IsIdentifier(node) {
		if alias, ok := tx.aliases[node.Text()]; ok && tx.refs[tx.EmitContext().MostOriginal(node)] {
			return tx.Factory().NewIdentifier(alias)
		}
		return node
	}
	return tx.Visitor().VisitEachChild(node)
}

// specifierRewriter makes a declaration file name modules by output: the
// specifier of an import or export declaration, and the argument of an
// import type that the checker wrote for an inferred type, such as
// import("./users.vibe").NotFound. Effect's physical path is named by its
// public module even when a symlink led the checker outside node_modules.
type specifierRewriter struct {
	transformers.Transformer
	sourceDirectory string
	effectPath      string // extensionless path of the resolved Effect interface's module
}

func (tx *specifierRewriter) visit(node *ast.Node) *ast.Node {
	f := tx.Factory()
	switch node.Kind {
	case ast.KindImportDeclaration:
		if platformImport(node) != nil {
			return nil // a platform import loads nothing (D312, entry.go)
		}
		d := node.AsImportDeclaration()
		if specifier, changed := outputSpecifier(f, d.ModuleSpecifier); changed {
			return f.UpdateImportDeclaration(d, d.Modifiers(), d.ImportClause, specifier, d.Attributes)
		}
		return node
	case ast.KindExportDeclaration:
		d := node.AsExportDeclaration()
		if specifier, changed := outputSpecifier(f, d.ModuleSpecifier); changed {
			return f.UpdateExportDeclaration(d, d.Modifiers(), d.IsTypeOnly, d.ExportClause, specifier, d.Attributes)
		}
		return node
	case ast.KindImportType:
		visited := tx.Visitor().VisitEachChild(node).AsImportTypeNode()
		if argument := visited.Argument; argument != nil && ast.IsLiteralTypeNode(argument) {
			literal := argument.AsLiteralTypeNode().Literal
			// Match the resolved interface's file, not a package-path suffix:
			// only that module is known to have the public name effect/Effect.
			if ast.IsStringLiteral(literal) && tx.effectPath != "" && tspath.IsExternalModuleNameRelative(literal.Text()) && tspath.RemoveFileExtension(tspath.ResolvePath(tx.sourceDirectory, literal.Text())) == tx.effectPath {
				specifier := f.NewStringLiteral("effect/Effect", ast.TokenFlagsNone)
				return f.UpdateImportTypeNode(visited, visited.IsTypeOf, f.UpdateLiteralTypeNode(argument.AsLiteralTypeNode(), specifier), visited.Attributes, visited.Qualifier, visited.TypeArguments)
			}
			if specifier, changed := outputSpecifier(f, literal); changed {
				return f.UpdateImportTypeNode(visited, visited.IsTypeOf, f.UpdateLiteralTypeNode(argument.AsLiteralTypeNode(), specifier), visited.Attributes, visited.Qualifier, visited.TypeArguments)
			}
		}
		return visited.AsNode()
	}
	return tx.Visitor().VisitEachChild(node)
}

// outputSpecifier returns a string literal that names the output of the
// source specifier names, and whether it differs from specifier.
func outputSpecifier(f *printer.NodeFactory, specifier *ast.Node) (*ast.Node, bool) {
	if specifier == nil || !ast.IsStringLiteral(specifier) {
		return specifier, false
	}
	text, changed := outputSpecifierText(specifier.Text())
	if !changed {
		return specifier, false
	}
	return f.NewStringLiteral(text, specifier.AsStringLiteral().TokenFlags), true
}

// computedKeyRewriter writes a computed key that the source took from the
// prelude or effect's root as the source wrote it, and records its first name
// for import:
//
//	// main.vibe                               // main.d.ts
//	export const Even = {                        import type { customMatcher } from "vibelang-runtime";
//	  [customMatcher](x: unknown) { … }          export declare const Even: {
//	}                                                [customMatcher](x: unknown): boolean;
//	                                             };
//
// The node builder prints a unique symbol key by its declared name alone,
// [customMatcher] or [NodeInspectSymbol], because no scope it searches holds
// the prelude, and it never asks preludeNameVisible.
type computedKeyRewriter struct {
	transformers.Transformer
	keys    map[string]computedKey // by the declared name of the key's symbol
	bound   map[string]bool        // names the declaration file declares at its top level
	written []*ast.Node            // the first identifier of each key it wrote
}

// computedKey is a key the source writes, such as Inspectable.NodeInspectSymbol.
// Two keys whose symbols share a declared name make it ambiguous.
type computedKey struct {
	expression *ast.Node
	symbol     *ast.Symbol
	ambiguous  bool
}

// add records key, a computed property name's expression in file, when its
// first name resolves to the prelude or effect's root.
func (tx *computedKeyRewriter) add(c *checker.Checker, file *ast.SourceFile, key *ast.Node) {
	if !ast.IsEntityNameExpression(key) {
		return
	}
	first := ast.GetFirstIdentifier(key)
	_, isPrelude := preludeModules[first.Text()]
	if !isPrelude && !isEffectExportName(first.Text()) {
		return
	}
	if prelude := preludeSymbol(c, preludeStateOf(c), file, first.Text()); prelude == nil || c.GetSymbolAtLocation(first) != prelude {
		return
	}
	symbol := c.GetSymbolAtLocation(key)
	if symbol == nil {
		return
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if existing, ok := tx.keys[symbol.Name()]; ok {
		existing.ambiguous = existing.ambiguous || existing.symbol != symbol
		tx.keys[symbol.Name()] = existing
		return
	}
	tx.keys[symbol.Name()] = computedKey{expression: key, symbol: symbol}
}

// visit rewrites a key printed as a bare name that the declaration file does
// not declare, so a local binding with the same name keeps its key.
func (tx *computedKeyRewriter) visit(node *ast.Node) *ast.Node {
	if ast.IsComputedPropertyName(node) {
		name := node.Expression()
		if !ast.IsIdentifier(name) || tx.bound[name.Text()] {
			return node
		}
		if key, ok := tx.keys[name.Text()]; ok && !key.ambiguous {
			return tx.Factory().UpdateComputedPropertyName(node.AsComputedPropertyName(), tx.entityExpression(key.expression))
		}
		return node
	}
	return tx.Visitor().VisitEachChild(node)
}

// entityExpression returns a new copy of key, an identifier or a property
// access of one, and keeps its first identifier in written.
func (tx *computedKeyRewriter) entityExpression(key *ast.Node) *ast.Node {
	f := tx.Factory()
	if ast.IsPropertyAccessExpression(key) {
		return f.NewPropertyAccessExpression(tx.entityExpression(key.Expression()), nil /*questionDotToken*/, f.NewIdentifier(key.Name().Text()), ast.NodeFlagsNone)
	}
	identifier := f.NewIdentifier(key.Text())
	tx.written = append(tx.written, identifier)
	return identifier
}
