package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A name that is not in scope gets TypeScript's "Did you mean" (TS2552). In
// .vibe code the platform globals that EK4402 removes from scope are never
// that suggestion: Process would suggest process, which EK4402 then bans.
// A name of an experimental service (D313) that is not in scope, such as
// Process, gets a note naming Experimental.Process instead.
//
//	Process.hostname()   // TS2304, showing the service key, run and provider
func init() {
	checker.RegisterSpellingSuggestionFilterHook(suggestsNoPlatformGlobal)
	checker.RegisterDiagnosticsFilterHook(explainExperimentalName)
}

// suggestsNoPlatformGlobal is the checker's spelling suggestion filter: in
// .vibe code outside a hatch or a module block, where EK4402 applies, a
// banned host binding is never suggested, whether listed or declaration-derived.
// Embedded module bodies have their own TypeScript source files; ordinary
// namespaces stay VibeLang.
// A declaration of the program's own with such a name may be.
func suggestsNoPlatformGlobal(c *checker.Checker, location *ast.Node, candidate *ast.Symbol) bool {
	name := candidate.Name()
	if _, ok := platformGlobals[name]; !ok && !isUnlistedHostGlobal(c, candidate) {
		return true
	}
	if !isVibeLangFile(ast.GetSourceFileOfNode(location)) || inHatch(location) || isErasedPlatformSpellingReference(location) {
		return true
	}
	return !isPlatformGlobalBinding(c, candidate)
}

// inModuleBlock reports whether node is in a module declaration's body,
// which is TypeScript (D283).
func inModuleBlock(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if n.Kind == ast.KindModuleDeclaration {
			return true
		}
	}
	return false
}

// isErasedPlatformSpellingReference includes a type name's namespace qualifiers.
// Class extends expressions remain values after following their member names.
func isErasedPlatformSpellingReference(node *ast.Node) bool {
	if ast.IsPartOfTypeQuery(node) {
		return true
	}
	for node.Parent != nil && (ast.IsQualifiedName(node.Parent) || ast.IsPropertyAccessExpression(node.Parent)) {
		node = node.Parent
	}
	return ast.IsPartOfTypeNode(node) || ast.IsPartOfTypeOnlyImportOrExportDeclaration(node)
}

// explainExperimentalName adds a note to TS2304 and TS2552 at a name that
// one of VibeLang's experimental services has (D313), which is in scope only
// as a member of Experimental. Its example uses the same checked service
// lookup and provider guidance as the platform diagnostic, not a service-member
// shorthand that the module does not export.
func explainExperimentalName(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || (d.Code() != 2304 && d.Code() != 2552) {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || !ast.IsIdentifier(name) || isMemberNameOf(name) || inHatch(name) {
			continue
		}
		key := "Experimental" + name.Text()
		if platformServices[key] == nil {
			continue
		}
		all[i] = note(d.Clone(), "{0} is VibeLang's experimental {0} module, available as Experimental.{0}.", name.Text())
		notePlatformAPI(all[i], platformAPI{service: key})
	}
	return all
}
