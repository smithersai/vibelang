package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The prelude settles a name that Effect and JavaScript or the DOM share
// (D310, D311), and a program that means the other one fails with an error
// about the meaning it got. These notes name that meaning and the way to the
// other one; what a name resolves to does not change:
//
//	function send(m: Message)   // TS2709: Message is Effect's module effect/cluster/Message
//	function run(c: Command)    // TS2707: Command is Effect's module effect/cli/Command
//	new Worker("./worker.js")   // TS2351: and the DOM's Worker is globalThis.Worker in a hatch
//	w.postMessage("x")          // TS2339: w's Worker is Effect's; alias the DOM's in a .ts file
//	Number.sum(1, 2)            // TS2339: Number is JavaScript's; import Effect's under another name
//
// A prelude name whose package the file does not resolve is not in scope, and
// its error names the package to install:
//
//	const n: number!! = …       // TS2503 without vibelang-runtime: Effect comes from it
func init() { checker.RegisterDiagnosticsFilterHook(explainPreludeCollisions) }

// missingNameCodes are the errors a name that no scope declares draws: Cannot
// find name (TS2304), the same with a suggestion (TS2552), and Cannot find
// namespace (TS2503). Each names the name as its first argument.
var missingNameCodes = map[int32]bool{2304: true, 2552: true, 2503: true}

// preludeModuleTypeCodes are the errors a type reference draws when its name
// means an Effect module the program did not mean: a namespace as a type
// (TS2709), a generic type without its type arguments (TS2314, TS2707), or a
// type that is not generic (TS2315).
var preludeModuleTypeCodes = map[int32]bool{2709: true, 2314: true, 2707: true, 2315: true}

// preludeModuleValueCodes are the errors new M(…) and M(…) draw when M is an
// Effect module: not constructable (TS2351) and not callable (TS2349).
var preludeModuleValueCodes = map[int32]bool{2351: true, 2349: true}

func explainPreludeCollisions(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || diagnosticAlreadyExplained(c, file, d) {
			continue
		}
		if missingNameCodes[d.Code()] && len(d.MessageArgs()) != 0 {
			if explained := explainMissingPreludePackage(c, file, d, d.MessageArgs()[0]); explained != d {
				all[i] = explained
				continue
			}
		}
		token := astnav.GetTokenAtPosition(file, d.Pos())
		if token == nil || !ast.IsIdentifier(token) || token.Parent == nil || inHatch(token) {
			continue
		}
		parent := token.Parent
		switch {
		case preludeModuleTypeCodes[d.Code()] && ast.IsTypeReferenceNode(parent) && parent.AsTypeReferenceNode().TypeName == token:
			all[i] = explainPreludeModule(c, file, d, token, false)
		case preludeModuleValueCodes[d.Code()] && (ast.IsNewExpression(parent) || ast.IsCallExpression(parent)) && parent.Expression() == token:
			all[i] = explainPreludeModule(c, file, d, token, true)
		case d.Code() == 2339 && ast.IsPropertyAccessExpression(parent) && parent.Name() == token:
			all[i] = explainMissingMember(c, file, d, parent)
		}
	}
	return all
}

// explainMissingPreludePackage adds to d, an error that name is not in scope,
// the package that supplies name when name is a prelude name and file does not
// resolve that package, which happens when it is not installed. The error
// arises wherever the prelude is written, including a contract such as
// number!!, whose Effect namespace the source never spells, and the names the
// parser writes for a form, such as an error declaration's TaggedError. It
// returns d unchanged otherwise.
func explainMissingPreludePackage(c *checker.Checker, file *ast.SourceFile, d *ast.Diagnostic, name string) *ast.Diagnostic {
	if !isPreludeName(name) {
		return d
	}
	state := preludeStateOf(c)
	if _, ok := preludeModules[name]; ok {
		if runtimeModuleSymbol(c, state, file) != nil {
			return d
		}
		if strings.HasPrefix(name, "$") {
			return note(d.Clone(), "The form here compiles to {0} from {1}, and this file does not resolve {1}. Install {1} at the version of vibelang.", name, runtimeModule)
		}
		return note(d.Clone(), "{0} is in scope in a .vibe file without an import, from {1}, and this file does not resolve {1}. Install {1} at the version of vibelang.", name, runtimeModule)
	}
	if effectRootModuleSymbol(c, state, file) != nil {
		return d
	}
	return note(d.Clone(), "{0} is in scope in a .vibe file without an import, from {1}, and this file does not resolve {1}. Install {1} at the version {2} pins.", name, effectRootModule, runtimeModule)
}

// explainPreludeModule adds to d, an error at name, a type reference or the
// callee of new or a call, that name is the Effect module the prelude
// supplies, when it is, and for a name the DOM declares too, how to reach the
// DOM's. It returns d unchanged otherwise.
func explainPreludeModule(c *checker.Checker, file *ast.SourceFile, d *ast.Diagnostic, name *ast.Node, value bool) *ast.Diagnostic {
	text := name.Text()
	module := preludeModulePath(text)
	if module == "" || !isEffectExportName(text) {
		return d // the runtime's Effect, Layer, Schema and Scope are no surprise
	}
	symbol := preludeSymbol(c, preludeStateOf(c), file, text)
	if symbol == nil || c.ResolveName(text, name, ast.SymbolFlagsValue|ast.SymbolFlagsType|ast.SymbolFlagsNamespace, false /*excludeGlobals*/) != symbol {
		return d // a declaration or an import of the file's own
	}
	d = note(d.Clone(), "{0} is Effect's {0} module ({1}), in scope without an import. To use your own {0}, declare or import it.", text, module)
	switch {
	case value && domGlobal(c, text, ast.SymbolFlagsValue) != nil:
		note(d, "For the DOM's {0}, write globalThis.{0} inside a hatch or a module block.", text)
	case !value && domGlobal(c, text, ast.SymbolFlagsType) != nil:
		note(d, "For the DOM's {0} type, alias it in a .ts file, as in export type Dom{0} = {0}, and import the alias.", text)
	}
	return d
}

// explainMissingMember adds to d, TS2339 at access, M.member, a note when
// the member is on the other meaning of a shared name: M is JavaScript's or
// the web's global, which wins over Effect's module of that name, and that
// module exports member (Number.sum, Array.make); or M's type is Effect's
// type of a name the DOM declares too, whose DOM type has member
// (w.postMessage on Effect's Worker). It returns d unchanged otherwise.
func explainMissingMember(c *checker.Checker, file *ast.SourceFile, d *ast.Diagnostic, access *ast.Node) *ast.Diagnostic {
	member := access.Name().Text()
	receiver := access.Expression()
	if ast.IsIdentifier(receiver) {
		text := receiver.Text()
		global := c.GlobalSymbol(text, ast.SymbolFlagsValue)
		if global != nil && preludeModulePath(text) != "" && isBuiltinGlobal(c, text) && c.ResolveName(text, receiver, ast.SymbolFlagsValue, false /*excludeGlobals*/) == global {
			module := effectExportSymbol(c, preludeStateOf(c), file, text)
			if module != nil && module.Flags()&ast.SymbolFlagsAlias != 0 {
				module = c.GetAliasedSymbol(module)
			}
			if module != nil && module.Flags()&ast.SymbolFlagsValueModule != 0 && c.TryGetMemberInModuleExports(member, module) != nil {
				owner := "JavaScript's"
				if sharedWebGlobals[text] {
					owner = "the web's"
				}
				return note(d.Clone(), "{0} is {1} {0} here, which wins over Effect's {0} module ({2}). To call Effect's {0}.{3}, import the module under another name: import { {0} as Effect{0} } from \"{4}\".", text, owner, preludeModulePath(text), member, preludePackageOf(text))
			}
		}
	}
	t := c.GetApparentType(c.GetTypeAtLocation(receiver))
	symbol := t.Symbol()
	if symbol == nil || !declaredInEffect(symbol) {
		return d
	}
	text := symbol.Name()
	module := preludeModulePath(text)
	dom := domGlobal(c, text, ast.SymbolFlagsType)
	if module == "" || dom == nil || c.GetPropertyOfType(c.GetDeclaredTypeOfSymbol(dom), member) == nil {
		return d
	}
	return note(d.Clone(), "{0} is Effect's {1} type ({2}): in a .vibe file the bare type name {1} means Effect's. The DOM's {1} has {3}; to use it, alias the DOM's type in a .ts file, as in export type Dom{1} = {1}, and import the alias.", c.TypeToString(t), text, module, member)
}

// domGlobal returns the global symbol named name with meaning when the DOM's
// or a web worker's lib file declares it, or nil.
func domGlobal(c *checker.Checker, name string, meaning ast.SymbolFlags) *ast.Symbol {
	symbol := c.GlobalSymbol(name, meaning)
	if symbol == nil {
		return nil
	}
	for _, declaration := range symbol.Declarations() {
		if file := ast.GetSourceFileOfNode(declaration); file != nil {
			if base := path.Base(string(file.FileName())); strings.HasPrefix(base, "lib.dom") || strings.HasPrefix(base, "lib.webworker") {
				return symbol
			}
		}
	}
	return nil
}

// declaredInEffect reports whether one of symbol's declarations is in the
// effect package.
func declaredInEffect(symbol *ast.Symbol) bool {
	for _, declaration := range symbol.Declarations() {
		if file := ast.GetSourceFileOfNode(declaration); file != nil && strings.Contains(string(file.FileName()), "/node_modules/effect/") {
			return true
		}
	}
	return false
}
