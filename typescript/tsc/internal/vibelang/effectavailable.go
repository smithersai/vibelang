package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

const supportedEffectVersion = "4.1.0"

func init() { fileChecks = append(fileChecks, checkEffectAvailable) }

// checkEffectAvailable reports EK1011 at each function of file that compiles
// to an Effect when no Effect type is in reach to type it, because effect is
// not installed where the program resolves it, or its declarations are unsupported.
// Such a function's JavaScript imports effect, and without the Effect type its type and declaration were
// the plain ones, with no diagnostic. A function annotated with an Effect
// contract already reports the missing name (TS2503). A plain function keeps
// its plain behavior either way: only its Effect wrapper for TypeScript
// callers needs effect, and it is not reported.
func checkEffectAvailable(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	if a.programEffectInterface() != nil {
		return
	}
	version := resolvedEffectVersion(c, file)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isLowerable(node) && node.Type() == nil && a.isEffect(node) && a.effectTypeOf(node, c.GetUnknownType()) == nil {
			d := report(c, functionNameNode(node), EK1011, functionDisplayName(node))
			if version != "" {
				note(d, "This file resolves effect@{0}, but its declarations are unsupported. VibeLang requires effect@{1}; install it with: npm install effect@{1}.", version, supportedEffectVersion)
			} else {
				note(d, "Install effect where this file can resolve it: the JavaScript VibeLang writes for {0} imports it.", functionDisplayName(node))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// resolvedEffectVersion reads the package identity from this file's normal
// module resolution, including its implicit prelude import. This is diagnostic
// context only: Effect 4's declaration discovery and type checking stay unchanged.
func resolvedEffectVersion(c *checker.Checker, file *ast.SourceFile) string {
	for key, resolved := range c.Program().GetResolvedModules()[file.PathKey()] {
		if key.Name == effectRootModule && resolved.IsResolved() {
			return resolved.PackageId.Version
		}
	}
	return ""
}

// functionNameNode returns the name of fn, or of the variable whose
// initializer fn is, or fn itself.
func functionNameNode(fn *ast.Node) *ast.Node {
	if name := fn.Name(); name != nil {
		return name
	}
	if parent := fn.Parent; parent != nil && parent.Kind == ast.KindVariableDeclaration && parent.Name() != nil {
		return parent.Name()
	}
	return fn
}
