package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// A module's name also names its export of the same name (design decision
// D311). Effect names many modules after their main export: the module
// Option exports the type Option.Option, the module FileSystem the service
// key FileSystem.FileSystem. In a .vibe file, the module's name stands for
// that export wherever the module has no meaning of its own, a deliberate
// change from TypeScript:
//
//	Option<number>                    Option.Option<number>                        a type
//	FileSystem.readFileString(path)   FileSystem.FileSystem.readFileString(path)   a service member call (D41, D90)
//	FileSystem()                      FileSystem.FileSystem()                      a service's implementation
//	FileSystem.of(implementation)     FileSystem.FileSystem.of(implementation)     a member of the export
//
// The module's exports win, so Option.some, FileSystem.layerNoop, and
// Path.layer keep their meaning, and Option.Option<number> still compiles. A
// service member call reads the service's member, as D41 does for a key; any
// other member the module lacks is read from the export. The rule holds for
// every Effect module the file reaches by its own name: through the prelude
// (D146, D310), as a module of a namespace the prelude supplies
// (Experimental.FileSystem), or through an import from effect or an @effect
// package (import { Prompt } from "effect/ai", import { Clipboard } from
// "@effect/platform-browser"). It reads the declarations, not a list.
//
// The lowering writes the export where the source wrote the module, and a
// declaration file writes the type Option as Option.Option, which stock
// TypeScript reads.

func init() {
	checker.RegisterQualifiedNameResolutionHook(resolveModuleAliasType)
	checker.RegisterMissingPropertyHook(moduleAliasProperty)
}

// moduleAliasState is what one checker remembers about D311.
type moduleAliasState struct {
	keys      map[*ast.Node]*ast.Symbol                // expressions asked about, and the service key each names, or nil
	typeNames map[*ast.Node]bool                       // identifiers that write a module's name as its export's type
	accesses  map[*ast.Node]string                     // property accesses M.member read through M's export, by the export's name
	imports   map[*ast.SourceFile]map[string]*ast.Node // imports of Effect modules whose types a file writes by the module's name, by name
}

type moduleAliasStateKey struct{}

func moduleServiceStateOf(c *checker.Checker) *moduleAliasState {
	return c.ExtensionState(moduleAliasStateKey{}, func() any {
		return &moduleAliasState{keys: map[*ast.Node]*ast.Symbol{}, typeNames: map[*ast.Node]bool{}, accesses: map[*ast.Node]string{}, imports: map[*ast.SourceFile]map[string]*ast.Node{}}
	}).(*moduleAliasState)
}

// moduleAliasOf returns the export of module named name, the export a
// module's name names under D311, or nil. module may be an alias of the
// module.
func moduleAliasOf(c *checker.Checker, module *ast.Symbol, name string) *ast.Symbol {
	if module != nil && module.Flags()&ast.SymbolFlagsAlias != 0 {
		module = c.GetAliasedSymbol(module)
	}
	if module == nil || module.Flags()&ast.SymbolFlagsValueModule == 0 {
		return nil
	}
	export := c.TryGetMemberInModuleExports(name, module)
	if export != nil && export.Flags()&ast.SymbolFlagsAlias != 0 {
		export = c.GetAliasedSymbol(export)
	}
	return export
}

// moduleServiceKeyOf returns the export of module named name when it is a
// Context key with a type of its own, the service a module's name names, or
// nil.
func moduleServiceKeyOf(c *checker.Checker, module *ast.Symbol, name string) *ast.Symbol {
	key := moduleAliasOf(c, module, name)
	if key == nil || key.Flags()&ast.SymbolFlagsValue == 0 || key.Flags()&ast.SymbolFlagsType == 0 {
		return nil
	}
	if _, shape := serviceOfKey(c, c.GetTypeOfSymbol(key)); shape == nil {
		return nil
	}
	return key
}

// moduleAliasTypeOf returns the export of module named name when it has a
// type, the type a module's name names, or nil. Bare ambient types take
// precedence in resolvePreludeName; qualified and imported modules retain
// their own type exports.
func moduleAliasTypeOf(c *checker.Checker, module *ast.Symbol, name string) *ast.Symbol {
	export := moduleAliasOf(c, module, name)
	if export == nil || export.Flags()&ast.SymbolFlagsType == 0 {
		return nil
	}
	return export
}

// isBuiltinGlobalType reports whether any ambient declaration supplies a
// global type named name. VIP-14 preserves ambient types independently of
// the Effect namespace chosen for the value or namespace meaning.
func isBuiltinGlobalType(c *checker.Checker, name string) bool {
	return c.GlobalSymbol(name, ast.SymbolFlagsType) != nil
}

// firstIdentifier returns the identifier that name, an identifier, property
// access, or qualified name, starts with, or nil.
func firstIdentifier(name *ast.Node) *ast.Node {
	for {
		switch {
		case ast.IsPropertyAccessExpression(name):
			name = name.Expression()
		case ast.IsQualifiedName(name):
			name = name.AsQualifiedName().Left
		case ast.IsIdentifier(name):
			return name
		default:
			return nil
		}
	}
}

// moduleAliasReached reports whether name, an identifier, property access,
// or qualified name in a .vibe file, starts with a name that reaches an
// Effect module by its own name, with meaning: a name the prelude supplies,
// which no scope around it shadows, or an import from effect or one of its
// modules.
func moduleAliasReached(c *checker.Checker, name *ast.Node, meaning ast.SymbolFlags) bool {
	first := firstIdentifier(name)
	if first == nil {
		return false
	}
	file := ast.GetSourceFileOfNode(first)
	if !isVibeLangFile(file) {
		return false
	}
	symbol := c.ResolveName(first.Text(), first, meaning, false /*excludeGlobals*/)
	if symbol == nil {
		return false
	}
	if isPreludeName(first.Text()) && symbol == preludeSymbol(c, preludeStateOf(c), file, first.Text()) {
		return true
	}
	return isEffectImport(symbol)
}

// isEffectImport reports whether symbol is a binding that an import from
// effect, one of its modules, or one of Effect's @effect packages declares.
func isEffectImport(symbol *ast.Symbol) bool {
	if symbol.Flags()&ast.SymbolFlagsAlias == 0 {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		for node := declaration; node != nil; node = node.Parent {
			if ast.IsImportDeclaration(node) {
				specifier := node.ModuleSpecifier()
				return specifier != nil && ast.IsStringLiteral(specifier) && (specifier.Text() == "effect" || strings.HasPrefix(specifier.Text(), "effect/") || strings.HasPrefix(specifier.Text(), "@effect/"))
			}
		}
	}
	return false
}

// expressionName returns the name that expression, an identifier or a
// property access, ends with, or "".
func expressionName(expression *ast.Node) string {
	switch {
	case ast.IsIdentifier(expression):
		return expression.Text()
	case ast.IsPropertyAccessExpression(expression) && ast.IsIdentifier(expression.Name()):
		return expression.Name().Text()
	}
	return ""
}

// moduleOfExpression returns the module that expression, whose type is t,
// refers to, when expression names it by its own name and reaches it as
// D311 asks, or nil.
func moduleOfExpression(c *checker.Checker, expression *ast.Node, t *checker.Type) *ast.Symbol {
	if t == nil || t.Symbol() == nil || t.Symbol().Flags()&ast.SymbolFlagsValueModule == 0 || expressionName(expression) == "" {
		return nil
	}
	if !moduleAliasReached(c, expression, ast.SymbolFlagsValue) {
		return nil
	}
	return t.Symbol()
}

// moduleServiceKey returns the service key that expression, whose type is
// t, names under D311: expression refers to an Effect module it reaches by
// the module's name, and the module's export of that name is a Context key.
// It returns nil otherwise.
func moduleServiceKey(c *checker.Checker, expression *ast.Node, t *checker.Type) *ast.Symbol {
	state := moduleServiceStateOf(c)
	if key, ok := state.keys[expression]; ok {
		return key
	}
	var key *ast.Symbol
	if module := moduleOfExpression(c, expression, t); module != nil {
		key = moduleServiceKeyOf(c, module, expressionName(expression))
	}
	state.keys[expression] = key
	return key
}

// moduleServiceMember returns the identifier and the shape of the service
// that node, a property access M.member, calls under D311: receiver is the
// type of M, a module whose name names a service, and the module exports no
// member. The module's exports win.
func moduleServiceMember(c *checker.Checker, node *ast.Node, receiver *checker.Type) (identifier *checker.Type, shape *checker.Type) {
	if receiver == nil || c.GetPropertyOfType(receiver, node.Name().Text()) != nil {
		return nil, nil
	}
	key := moduleServiceKey(c, node.Expression(), receiver)
	if key == nil {
		return nil, nil
	}
	return serviceOfKey(c, c.GetTypeOfSymbol(key))
}

// moduleAliasProperty is the checker's missing property hook: M.member, where
// M is an Effect module that exports no member, reads member from M's export
// of M's own name (D311), as Snowflake.length would read
// Snowflake.Snowflake.length. It records the access, so the lowering writes
// the export.
func moduleAliasProperty(c *checker.Checker, node *ast.Node, receiver *checker.Type, name string) *ast.Symbol {
	if !isVibeLangFile(ast.GetSourceFileOfNode(node)) {
		return nil
	}
	module := moduleOfExpression(c, node.Expression(), receiver)
	if module == nil {
		return nil
	}
	export := moduleAliasOf(c, module, expressionName(node.Expression()))
	if export == nil || export.Flags()&ast.SymbolFlagsValue == 0 {
		return nil
	}
	property := c.GetPropertyOfType(c.GetApparentType(c.GetTypeOfSymbol(export)), name)
	if property != nil {
		moduleServiceStateOf(c).accesses[node] = export.Name()
	}
	return property
}

// moduleServiceKeyName returns the name of the key that expression stands
// for under D311, which the lowering adds after it (FileSystem becomes
// FileSystem.FileSystem), or "".
func moduleServiceKeyName(c *checker.Checker, expression *ast.Node) string {
	if key := moduleServiceKey(c, expression, c.GetTypeAtLocation(expression)); key != nil {
		return key.Name()
	}
	return ""
}

// serviceKeyTypeAt returns the type of the Context key that expression, the
// S of a service member call S.member(…) or the p of p(), stands for: the
// key's own type, or under D311 the type of the key a module's name names.
func serviceKeyTypeAt(c *checker.Checker, expression *ast.Node) *checker.Type {
	t := c.GetApparentType(c.GetTypeAtLocation(expression))
	if key := moduleServiceKey(c, expression, t); key != nil {
		return c.GetTypeOfSymbol(key)
	}
	return t
}

// resolveModuleAliasType is the checker's qualified name resolution hook: in
// a type in a .vibe file, X.M, where X reaches an Effect module or
// namespace as D311 asks and M is a module that exports a type named M, is
// that type, as M alone is (resolvePreludeName). Experimental.FileSystem is
// the experimental FileSystem service.
func resolveModuleAliasType(c *checker.Checker, name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	if meaning&ast.SymbolFlagsType == 0 || !ast.IsIdentifier(right) || !isVibeLangFile(ast.GetSourceFileOfNode(name)) {
		return nil
	}
	if namespace.Flags()&ast.SymbolFlagsAlias != 0 {
		namespace = c.GetAliasedSymbol(namespace)
	}
	if namespace == nil || namespace.Flags()&ast.SymbolFlagsValueModule == 0 {
		return nil
	}
	export := moduleAliasTypeOf(c, c.TryGetMemberInModuleExports(right.Text(), namespace), right.Text())
	if export == nil {
		return nil
	}
	var left *ast.Node
	switch {
	case ast.IsQualifiedName(name):
		left = name.AsQualifiedName().Left
	case ast.IsPropertyAccessExpression(name):
		left = name.Expression()
	default:
		return nil
	}
	if !moduleAliasReached(c, left, ast.SymbolFlagsNamespace) {
		return nil
	}
	moduleServiceStateOf(c).typeNames[right] = true
	return export
}

// moduleAliasType returns the type that name, the name of module, a module
// the file reaches, stands for in a type (D311), and records location when
// it is the identifier that writes it, so the declaration file writes the
// export. It returns nil when the module has no type of that name.
func moduleAliasType(c *checker.Checker, location *ast.Node, module *ast.Symbol, name string) *ast.Symbol {
	export := moduleAliasTypeOf(c, module, name)
	if export != nil && ast.IsIdentifier(location) && location.Text() == name {
		moduleServiceStateOf(c).typeNames[location] = true
	}
	return export
}

// importedModuleType returns the type that name stands for at location
// when file imports an Effect module under name, as
// import { Prompt } from "effect/ai" does (D311), or nil. The import
// shadows every global of the name.
func importedModuleType(c *checker.Checker, file *ast.SourceFile, location *ast.Node, name string) *ast.Symbol {
	if _, ok := preludeModules[name]; ok {
		return nil // the prelude's own types, Effect and Scope, keep their meaning (D4, D48)
	}
	local := file.AsNode().Locals()[name]
	if local == nil || !isEffectImport(local) {
		return nil
	}
	export := moduleAliasType(c, location, local, name)
	if export != nil && ast.IsIdentifier(location) && location.Text() == name && len(local.Declarations()) > 0 {
		// The declaration file writes Prompt.Prompt through the import, which
		// TypeScript does not see the type use.
		state := moduleServiceStateOf(c)
		if state.imports[file] == nil {
			state.imports[file] = map[string]*ast.Node{}
		}
		state.imports[file][name] = local.Declarations()[0]
	}
	return export
}

// moduleImportDeclarations returns type-only imports of the Effect modules
// whose types file writes by the module's name through its own imports
// (importedModuleType), for its declaration file, sorted by name, leaving out
// the names declarations already binds.
func moduleImportDeclarations(f *printer.NodeFactory, imports map[string]*ast.Node, declarations *ast.SourceFile) []*ast.Node {
	bound := map[string]bool{}
	for _, statement := range declarations.Statements.Nodes {
		forEachTopLevelName(statement, func(name string) { bound[name] = true })
	}
	var names []string
	for name := range imports {
		if !bound[name] {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	var statements []*ast.Node
	for _, name := range names {
		binding := imports[name]
		var declaration *ast.Node
		for declaration = binding; declaration != nil && !ast.IsImportDeclaration(declaration); declaration = declaration.Parent {
		}
		if declaration == nil {
			continue
		}
		var bindings *ast.Node
		if ast.IsNamespaceImport(binding) {
			bindings = f.NewNamespaceImport(f.NewIdentifier(name))
		} else {
			var property *ast.Node
			if ast.IsImportSpecifier(binding) && binding.PropertyName() != nil {
				property = f.NewIdentifier(binding.PropertyName().Text())
			}
			bindings = f.NewNamedImports(f.NewNodeList([]*ast.Node{f.NewImportSpecifier(false /*isTypeOnly*/, property, f.NewIdentifier(name))}))
		}
		clause := f.NewImportClause(ast.KindUnknown, nil /*name*/, bindings)
		statement := f.NewImportDeclaration(nil /*modifiers*/, clause, f.NewStringLiteral(declaration.ModuleSpecifier().Text(), ast.TokenFlagsNone), nil /*attributes*/)
		statements = append(statements, statement)
	}
	return statements
}
