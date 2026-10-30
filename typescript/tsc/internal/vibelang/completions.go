package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// preludeCompletions offers the prelude names (prelude.go), effect's root
// exports (effectroot.go), and its subpath modules (effectsubpath.go) in
// every scope of a .vibe file, so completions list Effect, Layer,
// TaggedError, pipe, Console, Stream, and the rest without an import. The
// file's own declarations and imports shadow them, as they do in
// resolvePreludeName. A file that uses no prelude name yet does not import
// the runtime, so its list comes from the runtime that another .vibe file of
// the program imports; once the file uses a name, it imports the runtime
// itself. Likewise a subpath module is offered once a file of the program
// loads its package, such as effect/http for HttpRouter: the program has
// no declarations of a package no file loads.
func preludeCompletions(c *checker.Checker, location *ast.Node, meaning ast.SymbolFlags) []*ast.Symbol {
	file := ast.GetSourceFileOfNode(location)
	if !isVibeLangFile(file) {
		return nil
	}
	var symbols []*ast.Symbol
	state := preludeStateOf(c)
	if module := orProgramModule(c, runtimeModuleSymbol(c, state, file), runtimeModule); module != nil {
		for name := range preludeModules {
			if strings.HasPrefix(name, "$") || implicitEffectModuleDisabled(c, file, name) {
				continue // written by the compiler, not by people
			}
			if symbol := c.TryGetMemberInModuleExports(name, module); symbol != nil && hasMeaning(c, symbol, meaning) {
				symbols = append(symbols, symbol)
			}
		}
	}
	if module := orProgramModule(c, effectRootModuleSymbol(c, state, file), effectRootModule); module != nil {
		for name := range effectRootNames {
			if isBuiltinGlobal(c, name) || implicitEffectModuleDisabled(c, file, name) {
				continue
			}
			if symbol := c.TryGetMemberInModuleExports(name, module); symbol != nil && hasMeaning(c, symbol, meaning) {
				symbols = append(symbols, symbol)
			}
		}
		if effect := c.TryGetMemberInModuleExports("Effect", module); effect != nil {
			if effect.Flags()&ast.SymbolFlagsAlias != 0 {
				effect = c.GetAliasedSymbol(effect)
			}
			for name := range effectFunctionNames {
				if symbol := c.TryGetMemberInModuleExports(name, effect); symbol != nil && hasMeaning(c, symbol, meaning) {
					symbols = append(symbols, symbol)
				}
			}
		}
	}
	barrels := map[string]*ast.Symbol{}
	for name, subpath := range effectSubpathNames {
		if implicitEffectModuleDisabled(c, file, name) {
			continue
		}
		module, ok := barrels[subpath.barrel]
		if !ok {
			cache := state.barrels[subpath.barrel]
			if cache == nil {
				cache = map[*ast.SourceFile]*ast.Symbol{}
				state.barrels[subpath.barrel] = cache
			}
			module = orProgramModule(c, resolvedModuleSymbol(c, cache, file, subpath.barrel), subpath.barrel)
			barrels[subpath.barrel] = module
		}
		if module == nil || isBuiltinGlobal(c, name) {
			continue
		}
		if symbol := c.TryGetMemberInModuleExports(name, module); symbol != nil && hasMeaning(c, symbol, meaning) {
			symbols = append(symbols, symbol)
		}
	}
	return symbols
}

// orProgramModule returns module, the module a file resolves, or when the
// file does not resolve it yet, the module named name that another file of
// the program resolves.
func orProgramModule(c *checker.Checker, module *ast.Symbol, name string) *ast.Symbol {
	if module != nil {
		return module
	}
	return programModuleSymbol(c, name)
}

type programModuleKey struct{ name string }

type programModule struct{ module *ast.Symbol }

// programModuleSymbol returns the module named name that some file of the
// program imports, or nil when none does.
func programModuleSymbol(c *checker.Checker, name string) *ast.Symbol {
	return c.ExtensionState(programModuleKey{name}, func() any {
		program := c.Program()
		for _, resolutions := range program.GetResolvedModules() {
			for key, resolved := range resolutions {
				if key.Name != name || !resolved.IsResolved() {
					continue
				}
				if moduleFile := program.GetSourceFileForResolvedModule(resolved); moduleFile != nil {
					return &programModule{module: c.GetSymbolOfDeclaration(moduleFile.AsNode())}
				}
			}
		}
		return &programModule{}
	}).(*programModule).module
}

// serviceMemberCompletions lists a service's members after `Users.` in a .vibe
// function body. A call there reads the member from the service, not from
// the Context key that the class compiles to (design D41), so the key's own
// members, such as of, pipe, and use, would be the wrong list.
func serviceMemberCompletions(c *checker.Checker, left *ast.Node, t *checker.Type) *checker.Type {
	// After FileSystem., the module's exports, its export's members, and, in
	// a function body, its service's members (D311).
	if module := moduleOfExpression(c, left, c.GetApparentType(t)); module != nil {
		types := []*checker.Type{t}
		if export := moduleAliasOf(c, module, expressionName(left)); export != nil && export.Flags()&ast.SymbolFlagsValue != 0 {
			exportType := c.GetTypeOfSymbol(export)
			types = append(types, c.GetApparentType(exportType))
			if _, shape := serviceOfKey(c, exportType); shape != nil && inLowerableBody(left) {
				types = append(types, shape)
			}
		}
		return c.GetIntersectionType(types)
	}
	if !inLowerableBody(left) {
		return t
	}
	if _, shape := serviceOfKey(c, c.GetApparentType(t)); shape != nil {
		return shape
	}
	return t
}
