package vibelang

import (
	"maps"
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
//
// A module use is gated by what it resolves to, not by its spelling: any
// member access, qualified name, element access or destructured property that
// resolves to one of the gated members of the runtime's Experimental namespace,
// whether reached through the prelude name, an alias of it or the runtime
// barrel's export, and any import, re-export, dynamic import() or import type
// whose specifier is a gated subpath literal. The same holds for the runtime
// root's durable helpers ($task, $workflow, $handoff) that the declarations
// lower to, an import specifier that resolves to a gated export through any
// chain of re-exports, and an export * of the experimental barrel. A local
// binding named Experimental is the user's own, and VIP-33's core members
// resolve elsewhere.

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
	"Patterns":       "VIP-73",
}

// gatedHelpers are the runtime root's exports that task and workflow
// declarations lower to (VIP-55).
var gatedHelpers = []string{"$task", "$workflow", "$handoff"}

// gatedTarget is what a resolved gated symbol is called in EK3013.
type gatedTarget struct{ use, proposal string }

// gatedName reports whether name can step to a gated target.
func gatedName(name string) bool {
	return gatedModules[name] != "" || slices.Contains(gatedHelpers, name)
}

// experimentalOn reports whether the project that owns file opts in to
// feature (core.VibeExperimentalFeatures).
func experimentalOn(c *checker.Checker, file *ast.SourceFile, feature string) bool {
	options := optionsFor(c, file)
	return options != nil && options.VibeLang != nil && slices.Contains(options.VibeLang.Experimental, feature)
}

// builtinsOn is experimentalOn for the built-in set, VIPs 55 to 73.
func builtinsOn(c *checker.Checker, file *ast.SourceFile) bool {
	return experimentalOn(c, file, core.VibeExperimentalBuiltins)
}

func checkExperimentalGate(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || file.IsDeclarationFile || builtinsOn(c, file) {
		return
	}
	targets := gatedTargets(c, file)
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
		case ast.IsImportDeclaration(node) || ast.IsExportDeclaration(node):
			if module, name := gatedImport(node); module != "" {
				site, use, proposal = node.ModuleSpecifier(), "`"+name+"` from `"+module+"`", gatedModules[name]
			}
		case ast.IsImportCall(node) && len(node.Arguments()) > 0 && ast.IsStringLiteralLike(node.Arguments()[0]):
			if specifier := node.Arguments()[0]; gatedSubpath(specifier.Text()) != "" {
				name := gatedSubpath(specifier.Text())
				site, use, proposal = specifier, "`"+name+"` from `"+specifier.Text()+"`", gatedModules[name]
			}
		case ast.IsLiteralImportTypeNode(node):
			if specifier := node.AsImportTypeNode().Argument.AsLiteralTypeNode().Literal; gatedSubpath(specifier.Text()) != "" {
				name := gatedSubpath(specifier.Text())
				site, use, proposal = specifier, "`"+name+"` from `"+specifier.Text()+"`", gatedModules[name]
			}
		case ast.IsImportSpecifier(node) && node.Symbol() != nil:
			if target, ok := lookupGated(c, targets, node.Symbol()); ok {
				site, use, proposal = node, target.use, target.proposal
			}
		default:
			if target, ok := gatedReference(c, targets, node); ok {
				site, use, proposal = node, target.use, target.proposal
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

// gatedTargets returns the gated runtime exports file can reach, each resolved
// through its aliases: the gated members of the Experimental namespace and the
// durable helpers, from the prelude and from every resolution of the runtime's
// root, its experimental barrel and its gated subpaths in the program, so a
// file that reaches them only through another module's re-export is covered.
func gatedTargets(c *checker.Checker, file *ast.SourceFile) map[*ast.Symbol]gatedTarget {
	shared := c.ExtensionState(gateStateKey{}, func() any { return programGatedTargets(c) }).(map[*ast.Symbol]gatedTarget)
	targets := maps.Clone(shared)
	state := preludeStateOf(c)
	if namespace := preludeSymbol(c, state, file, "Experimental"); namespace != nil {
		addNamespaceTargets(c, targets, c.SkipAlias(namespace))
	}
	if module := runtimeModuleSymbol(c, state, file); module != nil {
		addRootTargets(c, targets, module)
	}
	return targets
}

type gateStateKey struct{}

// programGatedTargets is gatedTargets' part that every file shares.
func programGatedTargets(c *checker.Checker) map[*ast.Symbol]gatedTarget {
	targets := map[*ast.Symbol]gatedTarget{}
	program := c.Program()
	for _, resolutions := range program.GetResolvedModules() {
		for key, resolved := range resolutions {
			name := key.Name
			subpath := gatedSubpath(name)
			if name != runtimeModule && name != "vibelang-runtime/experimental" && subpath == "" || !resolved.IsResolved() {
				continue
			}
			moduleFile := program.GetSourceFileForResolvedModule(resolved)
			if moduleFile == nil {
				continue
			}
			module := c.GetSymbolOfDeclaration(moduleFile.AsNode())
			if module == nil {
				continue
			}
			switch {
			case subpath != "":
				targets[module] = gatedTarget{"`Experimental." + subpath + "`", gatedModules[subpath]}
			case name == runtimeModule:
				addRootTargets(c, targets, module)
			default:
				addNamespaceTargets(c, targets, module)
			}
		}
	}
	return targets
}

// addNamespaceTargets adds the gated members of namespace, the Experimental
// namespace or the module vibelang-runtime/experimental.
func addNamespaceTargets(c *checker.Checker, targets map[*ast.Symbol]gatedTarget, namespace *ast.Symbol) {
	namespaceType := c.GetTypeOfSymbol(namespace)
	for name, proposal := range gatedModules {
		if member := c.GetPropertyOfType(namespaceType, name); member != nil {
			targets[c.SkipAlias(member)] = gatedTarget{"`Experimental." + name + "`", proposal}
		}
	}
}

// addRootTargets adds the gated exports of module, the runtime's root: the
// members of its Experimental export and its durable helpers.
func addRootTargets(c *checker.Checker, targets map[*ast.Symbol]gatedTarget, module *ast.Symbol) {
	if namespace := c.TryGetMemberInModuleExports("Experimental", module); namespace != nil {
		addNamespaceTargets(c, targets, c.SkipAlias(namespace))
	}
	for _, name := range gatedHelpers {
		if helper := c.TryGetMemberInModuleExports(name, module); helper != nil {
			targets[c.SkipAlias(helper)] = gatedTarget{"`" + name + "` from `vibelang-runtime`", "VIP-55"}
		}
	}
}

// gatedReference returns the gated target when node is a member access,
// qualified name, element access or object binding element that resolves to
// one of targets, and "" otherwise. Each of those steps from a namespace value
// by the member's own name, so a node whose name is not a gated module name is
// never resolved.
func gatedReference(c *checker.Checker, targets map[*ast.Symbol]gatedTarget, node *ast.Node) (gatedTarget, bool) {
	if len(targets) == 0 {
		return gatedTarget{}, false
	}
	var symbol *ast.Symbol
	switch {
	case ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Name()):
		if !gatedName(node.Name().Text()) {
			return gatedTarget{}, false
		}
		symbol = c.GetSymbolAtLocation(node.Name())
	case ast.IsQualifiedName(node):
		if right := node.AsQualifiedName().Right; ast.IsIdentifier(right) && gatedName(right.Text()) {
			symbol = c.GetSymbolAtLocation(right)
		}
	case ast.IsElementAccessExpression(node):
		access := node.AsElementAccessExpression()
		name := ""
		if argument := access.ArgumentExpression; ast.IsStringLiteralLike(argument) {
			name = argument.Text()
		} else if t := c.GetTypeAtLocation(argument); t != nil && t.IsStringLiteral() {
			name, _ = t.AsLiteralType().Value().(string)
		}
		if !gatedName(name) {
			return gatedTarget{}, false
		}
		symbol = c.GetPropertyOfType(c.GetTypeAtLocation(access.Expression), name)
	case ast.IsBindingElement(node) && ast.IsObjectBindingPattern(node.Parent):
		key := node.PropertyName()
		if key == nil {
			key = node.Name()
		}
		if key == nil || !(ast.IsIdentifier(key) || ast.IsStringLiteralLike(key)) || !gatedName(key.Text()) {
			return gatedTarget{}, false
		}
		symbol = c.GetPropertyOfType(c.GetTypeAtLocation(node.Parent), key.Text())
	}
	if symbol == nil {
		return gatedTarget{}, false
	}
	return lookupGated(c, targets, symbol)
}

// lookupGated resolves symbol through its aliases and finds it in targets. A
// module is also found by its declaration file, because one runtime file can
// be bound as more than one module symbol (the prelude's and a subpath's).
func lookupGated(c *checker.Checker, targets map[*ast.Symbol]gatedTarget, symbol *ast.Symbol) (gatedTarget, bool) {
	symbol = c.SkipAlias(symbol)
	if target, ok := targets[symbol]; ok {
		return target, true
	}
	if file := moduleFileName(symbol); file != "" {
		for candidate, target := range targets {
			if moduleFileName(candidate) == file {
				return target, true
			}
		}
	}
	return gatedTarget{}, false
}

// moduleFileName is the file that declares symbol when it is a module, or "".
func moduleFileName(symbol *ast.Symbol) string {
	if symbol == nil {
		return ""
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || !ast.IsSourceFile(declaration) {
		return ""
	}
	return string(declaration.AsSourceFile().FileName())
}

// gatedSubpath returns the gated module a runtime subpath specifier names, as
// Durable for vibelang-runtime/experimental/Durable, or "".
func gatedSubpath(module string) string {
	rest, ok := strings.CutPrefix(module, "vibelang-runtime/experimental/")
	switch {
	case !ok:
		return ""
	case gatedModules[rest] != "":
		return rest
	case strings.HasPrefix(rest, "patterns/"): // one pattern of Patterns (VIP-73)
		return "Patterns"
	}
	return ""
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
	if rest := gatedSubpath(module); rest != "" {
		return module, rest
	}
	if module != "vibelang-runtime/experimental" {
		return "", ""
	}
	if ast.IsExportDeclaration(node) {
		if exports := node.AsExportDeclaration().ExportClause; exports == nil || ast.IsNamespaceExport(exports) {
			return module, "Durable"
		}
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
