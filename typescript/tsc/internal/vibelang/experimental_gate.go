package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// The experimental gate (VIP-30, clarified 2026-11-11). What is built from an
// open proposal compiles only in a project whose config names the proposal's
// feature in vibe.experimental. The parse never changes, so the formatter and
// the language server read the same tree with or without the opt-in; the
// gate is this one checker diagnostic, reported once per file at the first
// gated use. Without the opt-in the durable checks (EK5502 to EK5509 and the
// boundary EK2109) do not run, so a well-formed file gets EK3013 alone.

// EK3013: experimental code without its opt-in. {0} is the use, {1} the open
// proposal, {2} the feature name.
var EK3013 = message(3013, errorCategory, "{0} comes from the open proposal {1} and is experimental. Opt in with \"vibe\": { \"experimental\": [\"{2}\"] } in tsconfig.json or vibe.config.json.")

func init() {
	registry[EK3013.Code] = EK3013
	fileChecks = append(fileChecks, checkExperimentalGate)
}

// gatedModules are the Experimental.X runtime modules built from the open
// built-in set, with the proposal each comes from. VIP-33's platform modules
// (Experimental.FileSystem, Process, Crypto, …) are core and not listed.
var gatedModules = map[string]string{
	"Durable":        "VIP-60",
	"Human":          "VIP-56",
	"Eval":           "VIP-69",
	"Scorer":         "VIP-69",
	"Memory":         "VIP-66",
	"Fuzz":           "VIP-70",
	"FuzzSimulation": "VIP-70",
	"Test":           "VIP-71",
}

// experimentalOn reports whether the project that owns file opts in to
// feature (core.VibeExperimentalFeatures).
func experimentalOn(c *checker.Checker, file *ast.SourceFile, feature string) bool {
	options := optionsFor(c, file)
	return options != nil && options.VibeLang != nil && slices.Contains(options.VibeLang.Experimental, feature)
}

// builtinsOn is experimentalOn for the built-in set, VIPs 55 to 72.
func builtinsOn(c *checker.Checker, file *ast.SourceFile) bool {
	return experimentalOn(c, file, core.VibeExperimentalBuiltins)
}

func checkExperimentalGate(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || file.IsDeclarationFile || builtinsOn(c, file) {
		return
	}
	var site *ast.Node
	var use, proposal string
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if site != nil {
			return true
		}
		switch {
		case durableKind(node) != "" && len(node.Arguments()) > 0:
			site, use, proposal = node.Arguments()[0], "A `"+durableKind(node)+"` declaration", "VIP-55"
		case ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "Experimental" &&
			ast.IsIdentifier(node.Name()) && gatedModules[node.Name().Text()] != "" && isPreludeExperimental(c, file, node.Expression()):
			site, use, proposal = node, "`Experimental."+node.Name().Text()+"`", gatedModules[node.Name().Text()]
		case ast.IsImportDeclaration(node) || ast.IsExportDeclaration(node):
			if module, name := gatedImport(node); module != "" {
				site, use, proposal = node.ModuleSpecifier(), "`"+name+"` from `"+module+"`", gatedModules[name]
			}
		}
		if site != nil {
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if site != nil {
		report(c, site, EK3013, use, proposal, core.VibeExperimentalBuiltins)
	}
}

// isPreludeExperimental reports whether name is the implicit Experimental
// namespace, not a local or imported binding that shadows it.
func isPreludeExperimental(c *checker.Checker, file *ast.SourceFile, name *ast.Node) bool {
	symbol := c.ResolveName("Experimental", name, ast.SymbolFlagsValue, false /*excludeGlobals*/)
	return symbol != nil && symbol == preludeSymbol(c, preludeStateOf(c), file, "Experimental")
}

// gatedImport returns the runtime specifier and module name when node imports
// or re-exports a gated module: vibelang-runtime/experimental/Durable, or the
// named Durable of vibelang-runtime/experimental.
func gatedImport(node *ast.Node) (string, string) {
	specifier := node.ModuleSpecifier()
	if specifier == nil || !ast.IsStringLiteral(specifier) {
		return "", ""
	}
	module := specifier.Text()
	if rest, ok := strings.CutPrefix(module, "vibelang-runtime/experimental/"); ok && gatedModules[rest] != "" {
		return module, rest
	}
	if module != "vibelang-runtime/experimental" {
		return "", ""
	}
	var named []*ast.Node
	if ast.IsImportDeclaration(node) {
		if clause := node.AsImportDeclaration().ImportClause; clause != nil {
			if bindings := clause.AsImportClause().NamedBindings; bindings != nil && ast.IsNamedImports(bindings) {
				named = bindings.AsNamedImports().Elements.Nodes
			}
		}
	} else if exports := node.AsExportDeclaration().ExportClause; exports != nil && ast.IsNamedExports(exports) {
		named = exports.AsNamedExports().Elements.Nodes
	}
	for _, element := range named {
		name := element.PropertyNameOrName()
		if name != nil && gatedModules[name.Text()] != "" {
			return module, name.Text()
		}
	}
	return "", ""
}
