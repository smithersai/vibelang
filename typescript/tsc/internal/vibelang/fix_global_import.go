package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4842 (D475): an import of one of Effect's modules under the name of a
// JavaScript global. VibeLang keeps the global's name for the global (D310),
// so its documents import such a module under another name:
//
//	import { Array, Option } from "effect"       import { Array as Arr, Option } from "effect"
//	Array.take(values, 2)                        Arr.take(values, 2)
//
//	import * as String from "effect/String"      import * as Str from "effect/String"
//
// The names are JavaScript's own globals that Effect's root also exports as
// modules: Array, String, Number, Boolean, Function, Symbol, BigInt and
// RegExp. The import shadowed the global in the whole file, so every
// reference to it means Effect's module, and the fix renames the binding and
// each of those references, written as a shorthand property { Array } too,
// to Arr, Str, Num, Bool, Fn, Sym, Big or Regex, or to EffectArray and its
// siblings when the file already uses the short name. A reference that is
// not the import's, such as the type Array<T>, which the module does not
// declare, already meant the global and is left. The warning stands only
// where the rename keeps the module's declaration file: no export of the
// file, as export { Array } or export default Array, names the binding, no
// type is written with it, as Array.NonEmptyReadonlyArray<T>, which a
// declaration file prints as written, and the type of nothing the file
// exports mentions a declaration of the module, which the declaration file
// would print through the binding's name. A type too large to search counts
// as one that does.

// EK4842 (D475): a module import under a JavaScript global's name. {0} is the name, {1} the import the fix writes.
var EK4842 = message(4842, warningCategory, "{0} imports Effect's {0} module under the name of JavaScript's global {0}, which VibeLang keeps for the global; import the module under another name: {1}.")

// globalModuleAliases names, for each of Effect's modules whose name a
// JavaScript global has, the names the fix tries, in order.
var globalModuleAliases = map[string][]string{
	"Array":    {"Arr", "EffectArray"},
	"String":   {"Str", "EffectString"},
	"Number":   {"Num", "EffectNumber"},
	"Boolean":  {"Bool", "EffectBoolean"},
	"Function": {"Fn", "EffectFunction"},
	"Symbol":   {"Sym", "EffectSymbol"},
	"BigInt":   {"Big", "EffectBigInt"},
	"RegExp":   {"Regex", "EffectRegExp"},
}

func init() {
	registry[EK4842.Code] = EK4842
	tsFormMessages = append(tsFormMessages, EK4842)
	tsFormRules[EK4842.Code] = &tsFormRule{
		message: EK4842,
		find:    findGlobalModuleImports,
	}
}

// isImportBindingName reports whether node is the name an import specifier
// or a namespace import binds.
func isImportBindingName(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Parent != nil && (ast.IsImportSpecifier(node.Parent) || ast.IsNamespaceImport(node.Parent)) && node.Parent.Name() == node
}

// findGlobalModuleImports reports EK4842 at each import of file that binds
// one of Effect's modules under a JavaScript global's name.
func findGlobalModuleImports(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || statement.AsImportDeclaration().ImportClause == nil {
			continue
		}
		bindings := statement.AsImportDeclaration().ImportClause.AsImportClause().NamedBindings
		var names []*ast.Node
		switch {
		case bindings == nil:
		case ast.IsNamespaceImport(bindings):
			names = append(names, bindings.Name())
		case ast.IsNamedImports(bindings):
			for _, specifier := range bindings.AsNamedImports().Elements.Nodes {
				names = append(names, specifier.Name())
			}
		}
		for _, name := range names {
			if _, ok := globalModuleAliases[name.Text()]; !ok {
				continue
			}
			if rewrite := globalImportRewrite(c, file, name); rewrite.fixable() {
				report(name, rewrite, name.Text(), rewrite.description)
			}
		}
	}
}

// globalImportRewrite plans EK4842's fix for the import binding name.
func globalImportRewrite(c *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	module := name.Text()
	aliases, ok := globalModuleAliases[module]
	if !ok || !isImportBindingName(name) || effectModuleOf(c, name) != module {
		return nil
	}
	binding := name.Parent
	var clause *ast.Node
	if ast.IsImportSpecifier(binding) {
		if binding.AsImportSpecifier().PropertyName != nil || binding.AsImportSpecifier().IsTypeOnly {
			return nil
		}
		clause = binding.Parent.Parent
	} else {
		clause = binding.Parent
	}
	if !ast.IsImportClause(clause) || clause.AsImportClause().IsTypeOnly() {
		return nil
	}
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil {
		return nil
	}
	target := c.GetAliasedSymbol(symbol) // a qualified name in a type resolves to the module itself
	used := map[string]bool{}
	var references, shorthands []*ast.Node
	refused := false
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if refused {
			return true
		}
		if ast.IsIdentifier(node) {
			used[node.Text()] = true
			if node != name && node.Text() == module {
				parent := node.Parent
				switch {
				case ast.IsShorthandPropertyAssignment(parent) && parent.Name() == node:
					if c.GetShorthandAssignmentValueSymbol(parent) == symbol {
						shorthands = append(shorthands, node)
					}
				case c.GetSymbolAtLocation(node) == symbol || c.GetSymbolAtLocation(node) == target:
					if ast.IsExportSpecifier(parent) || ast.IsExportAssignment(parent) || inTypeNode(node) {
						refused = true // the declaration file names the binding, or may print the written type
					}
					references = append(references, node)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if refused {
		return nil
	}
	alias := ""
	for _, candidate := range aliases {
		if !used[candidate] && c.ResolveName(candidate, file.Statements.Nodes[0], ast.SymbolFlagsAll, false) == nil {
			alias = candidate
			break
		}
	}
	if alias == "" || exportsMentionModule(c, file, target) {
		return nil
	}
	var edits []sourceEdit
	if ast.IsImportSpecifier(binding) {
		edits = append(edits, sourceEdit{nodeStart(file, name), name.End(), module + " as " + alias})
	} else {
		edits = append(edits, sourceEdit{nodeStart(file, name), name.End(), alias})
	}
	for _, reference := range references {
		edits = append(edits, sourceEdit{nodeStart(file, reference), reference.End(), alias})
	}
	for _, shorthand := range shorthands {
		edits = append(edits, sourceEdit{nodeStart(file, shorthand), shorthand.End(), module + ": " + alias})
	}
	description := "import { " + module + " as " + alias + " }"
	if ast.IsNamespaceImport(binding) {
		description = "import * as " + alias
	}
	return &formRewrite{edits: edits, description: description}
}

// exportsMentionModule reports whether the type of anything file exports
// mentions a declaration of module, which the file's declaration file would
// print through the import's name.
func exportsMentionModule(c *checker.Checker, file *ast.SourceFile, module *ast.Symbol) bool {
	if module == nil {
		return true
	}
	var moduleFiles []*ast.SourceFile
	for _, declaration := range module.Declarations() {
		if ast.IsSourceFile(declaration) {
			moduleFiles = append(moduleFiles, declaration.AsSourceFile())
		}
	}
	fileSymbol := file.AsNode().Symbol()
	if fileSymbol == nil {
		return false // a script exports nothing
	}
	w := &typeMentions{c: c, files: moduleFiles, seen: map[*checker.Type]bool{}, budget: 20000, local: file}
	for _, export := range c.GetExportsOfModule(fileSymbol) {
		symbol := export
		if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == module || w.declaredIn(symbol) {
			return true
		}
		if symbol.Flags()&ast.SymbolFlagsValue != 0 && w.mentions(c.GetTypeOfSymbol(symbol)) {
			return true
		}
		if symbol.Flags()&(ast.SymbolFlagsTypeAlias|ast.SymbolFlagsInterface|ast.SymbolFlagsClass|ast.SymbolFlagsEnum) != 0 && w.mentions(c.GetDeclaredTypeOfSymbol(symbol)) {
			return true
		}
	}
	return w.budget < 0
}

// typeMentions searches types for a declaration of files.
type typeMentions struct {
	c      *checker.Checker
	files  []*ast.SourceFile
	local  *ast.SourceFile
	seen   map[*checker.Type]bool
	budget int
}

// declaredIn reports whether symbol has a declaration in one of w.files.
func (w *typeMentions) declaredIn(symbol *ast.Symbol) bool {
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(declaration)
		for _, f := range w.files {
			if file == f {
				return true
			}
		}
	}
	return false
}

// declaredLocally reports whether symbol has a declaration in w.local, whose
// declaration file prints its members.
func (w *typeMentions) declaredLocally(symbol *ast.Symbol) bool {
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		if ast.GetSourceFileOfNode(declaration) == w.local {
			return true
		}
	}
	return false
}

// mentions reports whether t, or a type a declaration file would print with
// it, names a declaration of w.files. It reports true once the search has
// visited more types than its budget.
func (w *typeMentions) mentions(t *checker.Type) bool {
	if t == nil || w.seen[t] {
		return false
	}
	w.seen[t] = true
	if w.budget--; w.budget < 0 {
		return true
	}
	if alias := t.Alias(); alias != nil {
		if w.declaredIn(alias.Symbol()) {
			return true
		}
		for _, argument := range alias.TypeArguments() {
			if w.mentions(argument) {
				return true
			}
		}
	}
	if w.declaredIn(t.Symbol()) {
		return true
	}
	flags := t.Flags()
	if flags&checker.TypeFlagsUnionOrIntersection != 0 {
		for _, member := range t.Types() {
			if w.mentions(member) {
				return true
			}
		}
	}
	if flags&checker.TypeFlagsObject == 0 {
		return false
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		for _, argument := range w.c.GetTypeArguments(t) {
			if w.mentions(argument) {
				return true
			}
		}
	}
	if t.ObjectFlags()&(checker.ObjectFlagsAnonymous|checker.ObjectFlagsMapped) == 0 && !w.declaredLocally(t.Symbol()) {
		return false // a named type the declaration file prints by its name
	}
	if t.ObjectFlags()&checker.ObjectFlagsClassOrInterface != 0 {
		for _, base := range w.c.GetBaseTypes(t) {
			if w.mentions(base) {
				return true
			}
		}
	}
	for _, property := range w.c.GetPropertiesOfType(t) {
		if w.mentions(w.c.GetTypeOfSymbol(property)) {
			return true
		}
	}
	for _, kind := range []checker.SignatureKind{checker.SignatureKindCall, checker.SignatureKindConstruct} {
		for _, signature := range w.c.GetSignaturesOfType(t, kind) {
			for _, parameter := range signature.TypeParameters() {
				if w.mentions(w.c.GetConstraintOfTypeParameter(parameter)) {
					return true
				}
			}
			for _, parameter := range signature.Parameters() {
				if w.mentions(w.c.GetTypeOfSymbol(parameter)) {
					return true
				}
			}
			if w.mentions(w.c.GetReturnTypeOfSignature(signature)) {
				return true
			}
		}
	}
	for _, info := range w.c.GetIndexInfosOfType(t) {
		if w.mentions(info.KeyType()) || w.mentions(info.ValueType()) {
			return true
		}
	}
	return false
}
